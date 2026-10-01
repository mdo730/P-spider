/* eslint-disable react/prop-types */
import {
  ArrowLeftOutlined,
  CheckOutlined,
  DownloadOutlined,
  ExportOutlined,
  HeartFilled,
  HeartOutlined,
  LeftOutlined,
  LinkOutlined,
  LoadingOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Dropdown,
  Empty,
  Image,
  Input,
  Menu,
  MenuProps,
  Pagination,
  Select,
  Spin,
  Tag,
} from 'antd';
import dayjs from 'dayjs';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PageHeader } from '../components/PageHeader';
import { PlatformMedia } from '../platforms';
import MediaType from '../enums/MediaType';
import {
  MOEYO_HPOI_CATEGORY_IDS,
  MoeyoListItem,
  fetchPostDetail,
  fetchPostImages,
  loadCachedSitePosts,
  parseMoeyoProduct,
  refreshSitePosts,
  saveMoeyoMedia,
  saveMoeyoPost,
  setHpoiMatch,
  upsertMetaImageCount,
} from '../services/moeyo';
import { HpoiMatchPanel } from '../components/figmemo/HpoiMatchPanel';
import { getHpoiPostIndex } from '../services/figmemo';
import { HpoiMatch } from '../services/hpoi';
import hpoiIcon from '../assets/platform-icons/hpoi.png';
import moeyoIcon from '../assets/platform-icons/moeyo.png';
import { useMoeyoFavoritesStore } from '../stores/moeyo-favorites';
import { useMoeyoTagsStore } from '../stores/moeyo-tags';
import { useRouteStore } from '../stores/route';
import { useSiteCacheStore } from '../stores/site-cache';
import { ROUTES } from '../constants/routes';
import {
  buildTagIndex,
  normalizeRel,
  scanDirectory,
  tagCoveredSet,
} from '../utils/library';
import { openUrl } from '../utils/shell';
import { handleImageMenuKey, imageMenuItems } from '../utils/image-menu';
import { LocalThumb } from '../components/library/LocalThumb';
import { useTextSelectionMenu } from '../hooks/useTextSelectionMenu';

interface PostDetail {
  title: string;
  contentHtml: string;
  link: string;
}

// 会话级内存缓存：切走再切回 moeyo 时直接用内存列表，避免重复「读缓存→构建→同步标签→渲染」
const ITEMS_TTL = 3 * 60 * 1000;
const REFRESH_INTERVAL = 5 * 60 * 1000;
let itemsCache: MoeyoListItem[] | null = null;
let itemsCacheAt = 0;
/** 该缓存对应的「站点缓存版本」；时间流刷新站点后版本 +1，使这里失效 */
let itemsCacheVersion = -1;
let lastRefreshAt = 0;

/** 列表分页每页条数 */
const PAGE_SIZE = 60;

/**
 * 给正文里**指回 moeyo 文章**的超链接：末尾加一个 moeyo 小图标，并打上 `data-moeyo-id`
 * （供点击时跳转 app 内该文章，而不是开浏览器）。
 */
function decorateMoeyoLinks(html: string, iconUrl: string): string {
  if (!html) return html;
  const re =
    /<a\b([^>]*?)href="(https?:\/\/(?:www\.)?moeyo\.com\/article\/(\d+)[^"]*)"([^>]*)>([\s\S]*?)<\/a>/gi;
  return html.replace(
    re,
    (_m, pre, href, id, post, text) =>
      `<a${pre}href="${href}"${post} data-moeyo-id="${id}">${text}<img src="${iconUrl}" alt="moeyo" style="height:0.9em;width:0.9em;display:inline-block;vertical-align:-0.12em;margin-left:3px" /></a>`,
  );
}

/** 图片名归一：取 basename、去掉小图 `s` 后缀、小写（用于把本地文件匹配到远程图） */
function normImgBase(name: string): string {
  const b = (name || '').split('/').pop() || '';
  return b.replace(/s(\.\w+)$/i, '$1').toLowerCase();
}

type MoeyoSort = 'date-desc' | 'date-asc';

/** 会话级列表 UI 状态：切页 / 切标签页回来时保持原样（筛选、页码、滚动位置） */
interface MoeyoListUi {
  /** 选中的分类标签 id（null=全部） */
  catId: string | null;
  /** 选中的年份标签 id（null=全部） */
  yearId: string | null;
  /** 只看收藏 */
  favOnly: boolean;
  keyword: string;
  sort: MoeyoSort;
  page: number;
  scrollTop: number;
}
const listUiCache: MoeyoListUi = {
  catId: null,
  yearId: null,
  favOnly: false,
  keyword: '',
  sort: 'date-desc',
  page: 1,
  scrollTop: 0,
};

/** 会话级「正在看的文章」缓存：切标签页回来直接恢复（不重拉详情） */
interface OpenArticleCache {
  item: MoeyoListItem;
  detail: PostDetail | null;
  images: PlatformMedia[];
  localImages: { path: string; name: string }[];
  navList: MoeyoListItem[];
}
let openArticleCache: OpenArticleCache | null = null;

/** moeyo：标签树筛选 + 本地文章列表 + 网页式详情 */
export const MoeyoPage: React.FC = () => {
  const { message } = App.useApp();
  const tags = useMoeyoTagsStore((s) => s.tags);
  const index = useMemo(() => buildTagIndex(tags), [tags]);
  const favoriteIds = useMoeyoFavoritesStore((s) => s.ids);
  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  // 导航历史栈长度（>0 = 当前文章由“跳转”进入，右下角显示圆形「返回列表」）
  const historyLen = useRouteStore((s) => s.history.length);

  const [catId, setCatId] = useState<string | null>(listUiCache.catId);
  const [yearId, setYearId] = useState<string | null>(listUiCache.yearId);
  const [favOnly, setFavOnly] = useState(listUiCache.favOnly);
  const [items, setItems] = useState<MoeyoListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState(listUiCache.keyword);
  const [sort, setSort] = useState<MoeyoSort>(listUiCache.sort);
  const [page, setPage] = useState(listUiCache.page);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const listUiMountedRef = useRef(false);

  // 持久化列表 UI 状态（切页/切标签页回来保持原样）
  useEffect(() => {
    listUiCache.catId = catId;
    listUiCache.yearId = yearId;
    listUiCache.favOnly = favOnly;
    listUiCache.keyword = keyword;
    listUiCache.sort = sort;
    listUiCache.page = page;
  }, [catId, yearId, favOnly, keyword, sort, page]);

  // 筛选 / 搜索 / 排序变化 → 回到第 1 页（首次挂载不重置，保留缓存页码）
  useEffect(() => {
    if (!listUiMountedRef.current) {
      listUiMountedRef.current = true;
      return;
    }
    setPage(1);
    listUiCache.scrollTop = 0;
  }, [catId, yearId, favOnly, keyword, sort]);

  // 列表变化时同步到会话缓存，供切回时秒开（仅在有内容时记录，避免把初始空列表当成缓存）
  useEffect(() => {
    if (items.length > 0) {
      itemsCache = items;
      itemsCacheAt = Date.now();
      itemsCacheVersion = useSiteCacheStore.getState().version;
    }
  }, [items]);

  const [selected, setSelected] = useState<MoeyoListItem | null>(null);
  // 与当前文章关联到同一 hpoi 词条的 fig-memo 文章（有则可跳转）
  const [figmemoJump, setFigmemoJump] = useState<{
    postId: string;
    title: string;
  } | null>(null);
  // 进入详情时快照当时的筛选列表顺序，供「上一篇/下一篇」按用户筛选结果跳转
  const [navList, setNavList] = useState<MoeyoListItem[]>([]);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [images, setImages] = useState<PlatformMedia[]>([]);
  const [localImages, setLocalImages] = useState<
    { path: string; name: string }[]
  >([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // 正文图片右键菜单（自定义定位）
  const [bodyImgMenu, setBodyImgMenu] = useState<{
    x: number;
    y: number;
    url: string;
  } | null>(null);

  const relOf = (item: MoeyoListItem) => `moeyo/${item.folderName}`;

  const load = useCallback(
    async (force = false) => {
      // 快速路径：最近构建过就直接用内存列表（切回不卡），仅按间隔后台静默刷新。
      // force=true（点「刷新」）时跳过，强制联网刷新。
      if (
        !force &&
        itemsCache &&
        itemsCache.length > 0 &&
        Date.now() - itemsCacheAt < ITEMS_TTL &&
        itemsCacheVersion === useSiteCacheStore.getState().version
      ) {
        setItems(itemsCache);
        setLoading(false);
        if (Date.now() - lastRefreshAt > REFRESH_INTERVAL) {
          refreshSitePosts()
            .then((next) => {
              lastRefreshAt = Date.now();
              setItems(next);
            })
            .catch(() => undefined);
        }
        return;
      }
      setLoading(true);
      let shown = false;
      // 列表显示与「订阅分类」解耦：始终展示站点全部文章；
      // 订阅（enabledCategories）只决定后台追新时要自动下载哪些分类的新文章。
      // 1) 本地缓存秒开
      try {
        const cached = await loadCachedSitePosts();
        if (cached) {
          setItems(cached);
          setLoading(false);
          shown = true;
        }
      } catch (err) {
        log.error(err);
      }
      // 2) 后台联网刷新
      try {
        setItems(await refreshSitePosts());
        lastRefreshAt = Date.now();
      } catch (err: any) {
        log.error(err);
        if (!shown) message.error(err?.message || '读取文章列表失败');
      } finally {
        setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    load();
  }, [load]);

  const openPost = async (item: MoeyoListItem, list?: MoeyoListItem[]) => {
    if (list) setNavList(list);
    openArticleCache = {
      item,
      detail: null,
      images: [],
      localImages: [],
      navList: list || openArticleCache?.navList || [],
    };
    setSelected(item);
    setDetail(null);
    setImages([]);
    setLocalImages([]);
    setDetailLoading(true);
    try {
      // 同时拉「远程全量图片列表」+「本地已存图片」+「正文」：
      // 以远程列表为准，本地有的用本地（本地可能只存了部分，不能只显示本地）
      const [d, imgs, local] = await Promise.all([
        fetchPostDetail(item.postId),
        fetchPostImages(item.postId).catch(() => [] as PlatformMedia[]),
        (async () => {
          if (!item.exists) return [] as { path: string; name: string }[];
          try {
            const content = await scanDirectory(item.folderPath);
            return content.files
              .filter((f) => f.kind === 'image')
              .map((f) => ({ path: f.path, name: f.name }));
          } catch {
            return [];
          }
        })(),
      ]);
      setDetail(d);
      setImages(imgs);
      setLocalImages(local);
      if (openArticleCache?.item.postId === item.postId) {
        openArticleCache.detail = d;
        openArticleCache.images = imgs;
        openArticleCache.localImages = local;
      }
      // 图片数以远程为准（无远程时用本地），顺手修正旧记录
      const count = imgs.length || local.length;
      if (count > 0 && item.imageCount !== count) {
        setItems((prev) =>
          prev.map((it) =>
            it.postId === item.postId ? { ...it, imageCount: count } : it,
          ),
        );
        upsertMetaImageCount(
          {
            postId: item.postId,
            title: item.title,
            date: item.date,
            link: item.link,
            categories: item.categories,
          },
          count,
        ).catch(() => undefined);
      }
    } catch (err: any) {
      log.error(err);
      message.error(err?.message || '读取文章详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const savePost = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const n = await saveMoeyoPost(selected);
      if (n > 0) {
        message.success(`已加入下载队列（${n} 个附件）`);
      } else {
        message.info('该文章没有可下载的图片');
      }
      setSelected((s) =>
        s ? { ...s, imageCount: n || s.imageCount, exists: n > 0 } : s,
      );
      await load();
    } catch (err: any) {
      message.error(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 关联/解除 hpoi 词条（同步详情、列表与导航快照，并落盘）
  const applyHpoiMatch = async (hpoi: HpoiMatch | null) => {
    if (!selected) return;
    const next = hpoi || undefined;
    setSelected({ ...selected, hpoi: next });
    setItems((prev) =>
      prev.map((it) =>
        it.postId === selected.postId ? { ...it, hpoi: next } : it,
      ),
    );
    setNavList((prev) =>
      prev.map((it) =>
        it.postId === selected.postId ? { ...it, hpoi: next } : it,
      ),
    );
    try {
      await setHpoiMatch(selected, hpoi);
    } catch (err: any) {
      message.error(err?.message || 'hpoi 关联保存失败');
    }
  };

  const selectedIsFav = selected ? favSet.has(String(selected.postId)) : false;

  // 顶部下拉：分类（8 项同级）/ 年份；从标签树取候选
  const categoryOptions = useMemo(() => {
    const root = index.roots.find((r) => r.name === 'moeyo');
    if (!root) return [] as { label: string; value: string }[];
    const out: { label: string; value: string }[] = [];
    const walk = (n: any) => {
      for (const c of n.children || []) {
        out.push({ label: c.name, value: c.id });
        walk(c);
      }
    };
    walk(root);
    return out;
  }, [index]);
  const yearOptions = useMemo(() => {
    const root = index.roots.find((r) => r.name === '年份');
    if (!root) return [] as { label: string; value: string }[];
    return root.children
      .map((c) => ({ label: c.name, value: c.id }))
      .sort((a, b) => b.label.localeCompare(a.label));
  }, [index]);

  const tagIds = useMemo(
    () => [catId, yearId].filter((x): x is string => !!x),
    [catId, yearId],
  );

  const filtered = useMemo(() => {
    let list = items;
    if (tagIds.length) {
      // 预计算每个选中标签的「覆盖路径集」（只算一次）
      const coveredSets = tagIds.map((id) => tagCoveredSet(index, id));
      list = list.filter((it) => {
        const np = normalizeRel(relOf(it));
        return coveredSets.every((s) => s.has(np));
      });
    }
    if (favOnly) {
      list = list.filter((it) => favSet.has(String(it.postId)));
    }
    const kw = keyword.trim().toLowerCase();
    if (kw) list = list.filter((it) => it.title.toLowerCase().includes(kw));

    const cmpDate = (x: MoeyoListItem, y: MoeyoListItem) =>
      x.date < y.date ? -1 : x.date > y.date ? 1 : 0;
    const arr = [...list];
    arr.sort((a, b) => (sort === 'date-asc' ? cmpDate(a, b) : cmpDate(b, a)));
    return arr;
  }, [items, tagIds, index, keyword, favSet, sort, favOnly]);

  // 响应时间流「查看正文」跳转：从 pendingArticle 打开指定文章
  const pendingArticle = useRouteStore((s) => s.pendingArticle);
  useEffect(() => {
    if (!pendingArticle || pendingArticle.page !== 'moeyo') return;
    if (items.length === 0) return;
    const it = items.find((x) => x.postId === pendingArticle.postId);
    if (it) {
      useRouteStore.getState().clearPendingArticle();
      openPost(it, filtered);
    }
  }, [pendingArticle, items, filtered]);

  // 当前文章若关联了 hpoi 词条，查是否有同一词条的 fig-memo 文章 → 显示跳转按钮
  const selectedHpoiItemId = selected?.hpoi?.itemId;
  useEffect(() => {
    let alive = true;
    if (!selectedHpoiItemId) {
      setFigmemoJump(null);
      return () => {
        alive = false;
      };
    }
    getHpoiPostIndex()
      .then((idx) => {
        if (alive) setFigmemoJump(idx.get(selectedHpoiItemId) || null);
      })
      .catch(() => {
        if (alive) setFigmemoJump(null);
      });
    return () => {
      alive = false;
    };
  }, [selectedHpoiItemId]);

  // 切标签页回来：恢复上次「正在看的文章」（时间流跳转优先）
  useEffect(() => {
    if (useRouteStore.getState().pendingArticle) return;
    const c = openArticleCache;
    if (!c) return;
    setSelected(c.item);
    setDetail(c.detail);
    setImages(c.images);
    setLocalImages(c.localImages);
    if (c.navList.length) setNavList(c.navList);
    setDetailLoading(false);
  }, []);

  // 保持缓存的 item 与当前 selected 同步（打标/收藏后回到文章仍是最新）
  useEffect(() => {
    if (openArticleCache && selected) openArticleCache.item = selected;
  }, [selected]);

  // 分页
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedItems = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const changePage = (p: number) => {
    listUiCache.scrollTop = 0;
    setPage(p);
  };

  // 从详情返回 / 重新进入列表时，恢复上次滚动位置（等列表渲染出来再恢复）
  useEffect(() => {
    if (selected) return;
    const el = listScrollRef.current;
    if (el) el.scrollTop = listUiCache.scrollTop;
  }, [selected, items.length, page]);

  const postUrl = selected?.link;

  // 正文里指回 moeyo 的链接：加图标 + 标注（供点击跳 app 内文章）
  const articleHtml = useMemo(
    () => decorateMoeyoLinks(detail?.contentHtml || '', moeyoIcon as string),
    [detail],
  );

  // 本地已存图片：按归一化文件名建索引，供「远程列表 + 本地覆盖」用
  const localByBase = useMemo(() => {
    const map = new Map<string, { path: string; name: string }>();
    for (const f of localImages) map.set(normImgBase(f.name), f);
    return map;
  }, [localImages]);

  // 当前文章在快照列表中的位置（用于「上一篇/下一篇」与进度显示）
  const navIndex = useMemo(
    () =>
      selected ? navList.findIndex((it) => it.postId === selected.postId) : -1,
    [selected, navList],
  );
  const navPrev = navIndex > 0 ? navList[navIndex - 1] : null;
  const navNext =
    navIndex >= 0 && navIndex < navList.length - 1
      ? navList[navIndex + 1]
      : null;

  // 切换文章时回到详情顶部
  useEffect(() => {
    detailScrollRef.current?.scrollTo({ top: 0 });
  }, [selected?.postId]);

  // 空格键 = 下一篇（在输入框/可编辑元素内不触发，避免打字或误触按钮）
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const el = document.activeElement as HTMLElement | null;
      const tagName = el?.tagName;
      if (
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT' ||
        tagName === 'BUTTON' ||
        el?.isContentEditable
      ) {
        return;
      }
      if (!navNext) return;
      e.preventDefault();
      openPost(navNext);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, navNext, openPost]);

  const { openTextMenu, textMenu } = useTextSelectionMenu();

  // 正文图片右键菜单：点击别处 / Esc / 滚动即关闭
  useEffect(() => {
    if (!bodyImgMenu) return;
    const close = () => setBodyImgMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [bodyImgMenu]);

  const mediaFromUrl = (url: string): PlatformMedia => ({
    id: url,
    type: MediaType.Photo,
    url,
    thumbUrl: url,
    downloadUrl: url,
    fileName: decodeURIComponent(url.split('/').pop() || '') || 'moeyo',
  });

  const imageMenu = (media: PlatformMedia): MenuProps => ({
    items: [
      ...imageMenuItems({ remoteUrl: media.url, postUrl }),
      ...(media.url
        ? [
            {
              key: 'saveLocal',
              label: '保存到本地',
              icon: <DownloadOutlined />,
            },
          ]
        : []),
      { type: 'divider' },
      { key: 'copyLink', label: '复制图片链接', icon: <LinkOutlined /> },
      { key: 'openImg', label: '在浏览器打开原图', icon: <ExportOutlined /> },
    ],
    onClick: async ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (
        await handleImageMenuKey(
          key,
          { remoteUrl: media.url, postUrl },
          message,
        )
      ) {
        return;
      }
      try {
        if (key === 'saveLocal' && media.url && selected) {
          await saveMoeyoMedia(selected, media);
          message.success('已添加到下载队列');
        } else if (key === 'copyLink' && media.url) {
          await navigator.clipboard.writeText(media.url);
          message.success('图片链接已复制');
        } else if (key === 'openImg' && media.url) {
          await openUrl(media.url);
        }
      } catch (err: any) {
        message.error(err?.message || '操作失败');
      }
    },
  });

  const localImageMenu = (file: { path: string; name: string }): MenuProps => ({
    items: imageMenuItems({ localPath: file.path, postUrl }),
    onClick: async ({ key, domEvent }) => {
      domEvent.stopPropagation();
      await handleImageMenuKey(key, { localPath: file.path, postUrl }, message);
    },
  });

  const backToList = () => {
    openArticleCache = null;
    setSelected(null);
    setDetail(null);
    setImages([]);
    useRouteStore.getState().clearHistory();
  };
  // 「← 返回」：历史栈非空回上一处；空栈回列表
  const goBack = () => {
    const prev = useRouteStore.getState().popHistory();
    if (prev) {
      if (prev.postId) {
        if (prev.page === 'moeyo') {
          const it = items.find((x) => x.postId === prev.postId);
          if (it) {
            openPost(it, filtered);
            return;
          }
        }
        // 跨页（如时间流 / fig-memo）：切回并打开该文章（不入栈）
        useRouteStore.getState().openArticle(prev.page, prev.postId, null);
        return;
      }
      const r = ROUTES.find((x) => x.id === prev.page);
      if (r) useRouteStore.getState().setRoute(r);
      return;
    }
    backToList();
  };

  // 详情视图
  if (selected) {
    return (
      <div className="flex flex-col h-screen">
        <PageHeader />
        <div className="flex items-center gap-2 pb-3">
          <Button icon={<ArrowLeftOutlined />} onClick={goBack}>
            返回
          </Button>
          <Button
            icon={<LeftOutlined />}
            disabled={!navPrev}
            onClick={() => {
              if (navPrev) {
                useRouteStore.getState().clearHistory();
                openPost(navPrev);
              }
            }}
          >
            上一篇
          </Button>
          <Button
            icon={<RightOutlined />}
            disabled={!navNext}
            title="下一篇（空格键）"
            onClick={() => {
              if (navNext) {
                useRouteStore.getState().clearHistory();
                openPost(navNext);
              }
            }}
          >
            下一篇
          </Button>
          {navIndex >= 0 && (
            <span className="text-sm text-gray-400">
              {navIndex + 1} / {navList.length}
            </span>
          )}
          <a
            href={selected.link}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-ant-color-link"
          >
            在原站打开
          </a>
          {figmemoJump && (
            <Button
              icon={<LinkOutlined />}
              title={
                figmemoJump.title
                  ? `fig-memo：${figmemoJump.title}`
                  : '在 fig-memo 查看'
              }
              onClick={() =>
                useRouteStore
                  .getState()
                  .openArticle('figmemo', figmemoJump.postId, {
                    page: 'moeyo',
                    postId: selected.postId,
                  })
              }
            >
              在 fig-memo 查看
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto pb-10" ref={detailScrollRef}>
          <article className="select-text bg-white rounded-md border-[1px] border-gray-200 max-w-4xl mx-auto p-6">
            <h1 className="text-2xl font-bold leading-snug">
              {selected.title}
            </h1>
            <div className="text-sm text-gray-400 mt-2 flex items-center flex-wrap gap-2">
              <span>{dayjs(selected.date).format('YYYY-MM-DD HH:mm')}</span>
              {selected.categories.map((c) => (
                <Tag key={c.id}>{c.name}</Tag>
              ))}
              <span>
                · {localImages.length || images.length || selected.imageCount}{' '}
                张图 · {selected.exists ? '已下载' : '未下载'}
              </span>
            </div>
            <hr className="my-4 border-gray-100" />

            {detailLoading ? (
              <div className="flex justify-center py-16">
                <Spin size="large" />
              </div>
            ) : (
              <>
                {/* 以远程全量列表为准，本地已存的用本地（本地可能只存了部分） */}
                {images.length > 0 || localImages.length > 0 ? (
                  <Image.PreviewGroup>
                    <ul className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(8rem,9rem))] gap-2">
                      {(images.length > 0
                        ? images
                        : localImages.map((f) => ({
                            url: f.path,
                            fileName: f.name,
                          }))
                      ).map((m: any, i: number) => {
                        const local =
                          images.length > 0
                            ? localByBase.get(normImgBase(m.url || ''))
                            : localImages[i];
                        return (
                          <Dropdown
                            key={`${m.id || m.url}-${i}`}
                            trigger={['contextMenu']}
                            menu={local ? localImageMenu(local) : imageMenu(m)}
                          >
                            <li className="lib-card-cv relative aspect-square bg-white rounded-md overflow-hidden border-[1px] border-gray-100 group">
                              {local ? (
                                <LocalThumb
                                  filePath={local.path}
                                  alt={local.name}
                                  className="object-cover w-full h-full"
                                  wrapperClassName="w-full h-full"
                                  preview
                                />
                              ) : (
                                <Image
                                  src={m.thumbUrl || m.url}
                                  alt={m.fileName || ''}
                                  loading="lazy"
                                  className="object-cover w-full h-full"
                                  wrapperClassName="w-full h-full"
                                  preview={{ src: m.url }}
                                />
                              )}
                            </li>
                          </Dropdown>
                        );
                      })}
                    </ul>
                  </Image.PreviewGroup>
                ) : null}
                {detail && detail.contentHtml.trim() && (
                  <div
                    className="moeyo-article"
                    // 正文来自 moeyo 原站（可信）；保留原格式（含图与超链接）
                    onClick={(e) => {
                      const a = (e.target as HTMLElement).closest('a');
                      // 指回 moeyo 的链接 → 跳 app 内该文章
                      const internalId = a?.getAttribute('data-moeyo-id');
                      if (internalId) {
                        e.preventDefault();
                        useRouteStore
                          .getState()
                          .openArticle('moeyo', internalId, {
                            page: 'moeyo',
                            postId: selected.postId,
                          });
                        return;
                      }
                      const href = a?.getAttribute('href');
                      if (href) {
                        e.preventDefault();
                        openUrl(href);
                      }
                    }}
                    onContextMenu={(e) => {
                      const img = (e.target as HTMLElement).closest('img');
                      const src = img?.getAttribute('src');
                      if (src) {
                        e.preventDefault();
                        setBodyImgMenu({
                          x: e.clientX,
                          y: e.clientY,
                          url: src,
                        });
                        return;
                      }
                      openTextMenu(e);
                    }}
                    dangerouslySetInnerHTML={{ __html: articleHtml }}
                  />
                )}
                {!detail && images.length === 0 && (
                  <Empty description="正文加载失败" />
                )}
              </>
            )}
          </article>
        </div>

        {/* 右上角：Hpoi 候选关联（仅 サンプルレビュー / 製品版レビュー 分类） */}
        {selected.categories?.some((c) =>
          MOEYO_HPOI_CATEGORY_IDS.includes(c.id),
        ) && (
          <HpoiMatchPanel
            item={selected}
            contentHtml={detail?.contentHtml}
            parse={parseMoeyoProduct}
            onConfirm={applyHpoiMatch}
            onClear={() => applyHpoiMatch(null)}
          />
        )}

        {/* 选中文字的右键菜单 */}
        {textMenu}

        {/* 正文图片右键菜单 */}
        {bodyImgMenu && (
          <div
            className="fixed z-[1000]"
            style={{ left: bodyImgMenu.x, top: bodyImgMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Menu
              className="min-w-[10rem] rounded-md border-[1px] border-gray-200 shadow-lg"
              items={[
                ...imageMenuItems({ remoteUrl: bodyImgMenu.url, postUrl }),
                {
                  key: 'saveLocal',
                  label: '保存到本地',
                  icon: <DownloadOutlined />,
                },
              ]}
              onClick={async ({ key }) => {
                const url = bodyImgMenu.url;
                setBodyImgMenu(null);
                if (
                  await handleImageMenuKey(
                    key,
                    { remoteUrl: url, postUrl },
                    message,
                  )
                ) {
                  return;
                }
                if (key === 'saveLocal' && url && selected) {
                  await saveMoeyoMedia(selected, mediaFromUrl(url));
                  message.success('已添加到下载队列');
                }
              }}
            />
          </div>
        )}

        {/* 右下角：收藏按钮 */}
        <div className="fixed right-6 bottom-6 z-50">
          <div className="relative flex flex-col items-end gap-3">
            {/* 收藏按钮 */}
            <button
              type="button"
              title={selectedIsFav ? '取消收藏' : '收藏'}
              onClick={() =>
                useMoeyoFavoritesStore.getState().toggle(selected.postId)
              }
              className={`group flex h-12 w-12 items-center justify-center rounded-full shadow-lg ring-1 ring-black/5 transition-all duration-200 ease-out hover:scale-110 hover:shadow-xl active:scale-95 ${
                selectedIsFav
                  ? 'bg-gradient-to-br from-pink-400 to-rose-500 text-white'
                  : 'bg-white text-gray-500 hover:text-rose-500'
              }`}
            >
              {selectedIsFav ? (
                <HeartFilled key="on" className="moeyo-pop text-lg" />
              ) : (
                <HeartOutlined
                  key="off"
                  className="text-lg transition-transform duration-300 group-hover:scale-110"
                />
              )}
            </button>
            {/* 返回列表（仅“跳转进来的文章”显示，作为保险） */}
            {historyLen > 0 && (
              <button
                type="button"
                title="返回列表"
                onClick={backToList}
                className="group flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-500 shadow-lg ring-1 ring-black/5 transition-all duration-200 ease-out hover:scale-110 hover:text-ant-color-primary hover:shadow-xl active:scale-95"
              >
                <ArrowLeftOutlined className="text-lg" />
              </button>
            )}
            {/* 保存按钮（圆形，缩小） */}
            <button
              type="button"
              title="保存该文章"
              disabled={saving}
              onClick={savePost}
              className="group flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-500 shadow-lg ring-1 ring-black/5 transition-all duration-200 ease-out hover:scale-110 hover:text-ant-color-primary hover:shadow-xl active:scale-95 disabled:opacity-60"
            >
              {saving ? (
                <LoadingOutlined className="text-lg" />
              ) : (
                <DownloadOutlined className="text-lg transition-transform duration-300 group-hover:scale-110" />
              )}
            </button>
            {/* 已在 app 内打开 hpoi 词条（关联了词条时显示） */}
            {selectedHpoiItemId && (
              <button
                type="button"
                title="在 app 内打开 hpoi 词条"
                onClick={() =>
                  useRouteStore
                    .getState()
                    .openArticle('intel', String(selectedHpoiItemId))
                }
                className="group flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/5 transition-all duration-200 ease-out hover:scale-110 hover:shadow-xl active:scale-95"
              >
                <img
                  src={hpoiIcon as string}
                  alt="hpoi"
                  className="h-6 w-6 object-contain transition-transform duration-300 group-hover:scale-110"
                />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 列表视图
  return (
    <div className="flex flex-col h-screen">
      <PageHeader />
      <div className="flex-1 min-h-0 flex pb-4">
        <section className="flex-1 min-w-0 flex flex-col" aria-label="文章列表">
          <div className="flex items-center flex-wrap gap-2 pb-3">
            <Select
              placeholder="分类：全部"
              allowClear
              style={{ width: 160 }}
              value={catId ?? undefined}
              onChange={(v) => {
                const val = (v as string) ?? null;
                setCatId(val);
                listUiCache.catId = val;
                setPage(1);
              }}
              options={categoryOptions}
            />
            <Select
              placeholder="年份：全部"
              allowClear
              style={{ width: 120 }}
              value={yearId ?? undefined}
              onChange={(v) => {
                const val = (v as string) ?? null;
                setYearId(val);
                listUiCache.yearId = val;
                setPage(1);
              }}
              options={yearOptions}
            />
            <Button
              type={favOnly ? 'primary' : 'default'}
              icon={<HeartOutlined />}
              title="只看收藏"
              onClick={() => {
                const val = !favOnly;
                setFavOnly(val);
                listUiCache.favOnly = val;
                setPage(1);
              }}
            />
            <Input
              allowClear
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索标题"
              className="w-52"
            />
            <span className="text-sm text-gray-400">{filtered.length} 篇</span>
            <Select
              size="small"
              value={sort}
              onChange={(v) => setSort(v)}
              className="w-36"
              options={[
                { label: '日期 新→旧', value: 'date-desc' },
                { label: '日期 旧→新', value: 'date-asc' },
              ]}
            />
            <Button
              className="ml-auto"
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => load(true)}
            >
              刷新
            </Button>
          </div>
          <div
            className="flex-1 overflow-y-auto pb-6"
            ref={listScrollRef}
            onScroll={(e) => {
              listUiCache.scrollTop = e.currentTarget.scrollTop;
            }}
          >
            {loading && items.length === 0 ? (
              <div className="flex justify-center py-20">
                <Spin size="large" />
              </div>
            ) : filtered.length === 0 ? (
              <Empty className="mt-16" description="暂无文章" />
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,10rem))] gap-3">
                {pagedItems.map((item) => {
                  const ctx = {
                    localPath: item.coverPath,
                    remoteUrl: item.coverUrl,
                    postUrl: item.link,
                  };
                  const menu: MenuProps = {
                    items: [
                      ...imageMenuItems(ctx),
                      { type: 'divider' },
                      { key: 'openArticle', label: '打开文章' },
                    ],
                    onClick: async ({ key, domEvent }) => {
                      domEvent.stopPropagation();
                      if (await handleImageMenuKey(key, ctx, message)) return;
                      if (key === 'openArticle') openPost(item, filtered);
                    },
                  };
                  return (
                    <Dropdown
                      key={item.postId}
                      trigger={['contextMenu']}
                      menu={menu}
                    >
                      <li
                        className="lib-card-cv bg-white rounded-md border-[1px] border-gray-100 overflow-hidden group cursor-pointer"
                        onClick={() => openPost(item, filtered)}
                      >
                        <div className="relative h-[9rem] bg-gray-100">
                          {item.coverPath ? (
                            <LocalThumb
                              filePath={item.coverPath}
                              alt={item.title}
                              className="w-full h-full object-cover transition-transform group-hover:scale-105"
                              wrapperClassName="w-full h-full"
                            />
                          ) : item.coverUrl ? (
                            <img
                              src={item.coverUrl}
                              alt={item.title}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display =
                                  'none';
                              }}
                              className="w-full h-full object-cover transition-transform group-hover:scale-105"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                              无封面
                            </div>
                          )}
                          <div className="absolute right-1 bottom-1 z-10 flex items-center gap-0.5">
                            {item.exists && (
                              <span
                                title="已下载"
                                className="flex items-center justify-center w-4 h-4 rounded-full bg-sky-500 text-white shadow"
                              >
                                <CheckOutlined className="text-[10px] leading-none" />
                              </span>
                            )}
                            {favSet.has(String(item.postId)) && (
                              <span
                                title="已收藏"
                                className="flex items-center justify-center w-4 h-4 rounded-full bg-rose-500 text-white shadow"
                              >
                                <HeartFilled className="text-[10px] leading-none" />
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="px-2 py-2">
                          <p
                            className="text-sm leading-snug line-clamp-2"
                            title={item.title}
                          >
                            {item.title}
                          </p>
                          <div className="text-xs text-gray-400 mt-1 flex items-center gap-1 flex-wrap">
                            <span>{dayjs(item.date).format('YYYY-MM-DD')}</span>
                            {item.categories[0] && (
                              <Tag className="!m-0 !text-xs">
                                {item.categories[0].name}
                              </Tag>
                            )}
                            {item.imageCount > 0 && (
                              <span>· {item.imageCount} 图</span>
                            )}
                          </div>
                        </div>
                      </li>
                    </Dropdown>
                  );
                })}
              </ul>
            )}
          </div>
          {!loading && filtered.length > PAGE_SIZE && (
            <div className="pt-3 flex justify-center">
              <Pagination
                current={page}
                pageSize={PAGE_SIZE}
                total={filtered.length}
                showSizeChanger={false}
                showQuickJumper
                onChange={changePage}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
