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
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  TagOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Dropdown,
  Empty,
  Image,
  Input,
  MenuProps,
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
import { CategorySidebar } from '../components/figmemo/CategorySidebar';
import { PageHeader } from '../components/PageHeader';
import { PlatformMedia } from '../platforms';
import {
  FigmemoListItem,
  fetchPostDetail,
  fetchPostImages,
  loadCachedSitePosts,
  refreshSitePosts,
  saveFigmemoPost,
  setArticleTags,
  setHpoiMatch,
  upsertMetaImageCount,
} from '../services/figmemo';
import { useFigmemoFavoritesStore } from '../stores/figmemo-favorites';
import { useFigmemoTagsStore } from '../stores/figmemo-tags';
import {
  DEFAULT_LIBRARY_FILTER,
  LibraryFilter,
  NON_COUNTING_TAG_ROOTS,
  TagCounts,
  buildTagIndex,
  computeTagCounts,
  folderManualTagIds,
  matchesFilter,
  scanDirectory,
} from '../utils/library';
import { openUrl } from '../utils/shell';
import { handleImageMenuKey, imageMenuItems } from '../utils/image-menu';
import { LocalThumb } from '../components/library/LocalThumb';
import hpoiIcon from '../assets/platform-icons/hpoi.png';
import { HpoiMatchPanel } from '../components/figmemo/HpoiMatchPanel';
import { HpoiMatch, HPOI_MATCH_CATEGORY_IDS } from '../services/hpoi';

interface PostDetail {
  title: string;
  contentHtml: string;
  link: string;
}

/** 文章级标签分组（可后续扩充；可选值之外还能自定义） */
const TAG_GROUPS: { key: string; options: string[] }[] = [
  { key: '姿势', options: ['站姿', '蹲姿', '坐姿'] },
  { key: '发型', options: ['长发', '短发', '特殊发型'] },
  { key: '体型', options: ['幼女', '成女', '熟女'] },
];

const EMPTY_COUNTS: TagCounts = { all: 0, unclassified: 0, byId: {} };

/**
 * 用 fig-memo 文章标题/正文拼出 Hpoi 搜索关键词。
 * 标题形如 `メーカー「商品名」...`；正文兜底解析 `メーカー：` / `商品名：`。
 */
function buildHpoiKeyword(title: string, html?: string): string {
  let maker = '';
  let name = '';
  const t = title.match(/^([^「]+?)「(.+?)」/);
  if (t) {
    maker = t[1].trim();
    name = t[2].trim();
  }
  if (html && (!maker || !name)) {
    const text = html.replace(/<[^>]*>/g, '\n');
    if (!maker) {
      const m = text.match(/メーカー\s*[:：]\s*([^\n]+)/);
      if (m) maker = m[1].trim();
    }
    if (!name) {
      const m = text.match(/商品名\s*[:：]\s*([^\n]+)/);
      if (m) name = m[1].trim();
    }
  }
  return [name || title.trim(), maker].filter(Boolean).join(' ');
}

// 会话级内存缓存：切走再切回 fig-memo 时直接用内存列表，避免重复「读缓存→构建→同步标签→渲染」
const ITEMS_TTL = 3 * 60 * 1000;
const REFRESH_INTERVAL = 5 * 60 * 1000;
let itemsCache: FigmemoListItem[] | null = null;
let itemsCacheAt = 0;
let lastRefreshAt = 0;

/** fig-memo：标签树筛选 + 本地文章列表 + 网页式详情 */
export const FigmemoPage: React.FC = () => {
  const { message } = App.useApp();
  const tags = useFigmemoTagsStore((s) => s.tags);
  const index = useMemo(() => buildTagIndex(tags), [tags]);
  const favoriteIds = useFigmemoFavoritesStore((s) => s.ids);
  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  // 可标注的分类（大类）及其候选小类：取自标签树中「非自动根」的根标签 + 其子标签；
  // 预设组（姿势/发型/体型）始终展示，历史自定义值（如 跪姿）自动纳入。
  const annotatableGroups = useMemo(() => {
    const nonCount = new Set(NON_COUNTING_TAG_ROOTS);
    const childrenByParent = new Map<string, string[]>();
    for (const t of tags) {
      const pid = t.parentId ?? null;
      if (!pid) continue;
      const arr = childrenByParent.get(pid);
      if (arr) arr.push(t.name);
      else childrenByParent.set(pid, [t.name]);
    }
    const rootsByName = new Map<string, string>();
    for (const t of tags) {
      if ((t.parentId ?? null) !== null) continue;
      if (nonCount.has(t.name)) continue;
      if (!rootsByName.has(t.name)) rootsByName.set(t.name, t.id);
    }
    for (const g of TAG_GROUPS) {
      if (!rootsByName.has(g.key)) rootsByName.set(g.key, '');
    }
    const names = [...rootsByName.keys()].sort((a, b) => {
      const ia = TAG_GROUPS.findIndex((g) => g.key === a);
      const ib = TAG_GROUPS.findIndex((g) => g.key === b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return names.map((name) => {
      const rootId = rootsByName.get(name) || '';
      const preset = TAG_GROUPS.find((g) => g.key === name)?.options || [];
      const kids = rootId ? childrenByParent.get(rootId) || [] : [];
      return { name, options: Array.from(new Set([...preset, ...kids])) };
    });
  }, [tags]);

  const [filter, setFilter] = useState<LibraryFilter>(DEFAULT_LIBRARY_FILTER);
  const [items, setItems] = useState<FigmemoListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<
    'date-desc' | 'date-asc' | 'rating-desc' | 'rating-asc'
  >('date-desc');

  // 列表变化时同步到会话缓存，供切回时秒开（仅在有内容时记录，避免把初始空列表当成缓存）
  useEffect(() => {
    if (items.length > 0) {
      itemsCache = items;
      itemsCacheAt = Date.now();
    }
  }, [items]);

  const [selected, setSelected] = useState<FigmemoListItem | null>(null);
  // 进入详情时快照当时的筛选列表顺序，供「上一篇/下一篇」按用户筛选结果跳转
  const [navList, setNavList] = useState<FigmemoListItem[]>([]);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [images, setImages] = useState<PlatformMedia[]>([]);
  const [localImages, setLocalImages] = useState<
    { path: string; name: string }[]
  >([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [panelOpen, setPanelOpen] = useState(false);
  const [newGroup, setNewGroup] = useState('');
  const [tagSaving, setTagSaving] = useState(false);

  const relOf = (item: FigmemoListItem) => `fig-memo/${item.folderName}`;

  const load = useCallback(async () => {
    // 快速路径：最近构建过就直接用内存列表（切回不卡），仅按间隔后台静默刷新
    if (
      itemsCache &&
      itemsCache.length > 0 &&
      Date.now() - itemsCacheAt < ITEMS_TTL
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
  }, [message]);

  useEffect(() => {
    load();
  }, [load]);

  const openPost = async (item: FigmemoListItem, list?: FigmemoListItem[]) => {
    if (list) setNavList(list);
    setSelected(item);
    setDetail(null);
    setImages([]);
    setLocalImages([]);
    setDetailLoading(true);
    try {
      // 本地优先：已下载且目录里有图片时，直接读本地（走缩略图缓存），不再拉站点媒体
      let local: { path: string; name: string }[] = [];
      if (item.exists) {
        try {
          const content = await scanDirectory(item.folderPath);
          local = content.files
            .filter((f) => f.kind === 'image')
            .map((f) => ({ path: f.path, name: f.name }));
        } catch {
          local = [];
        }
      }
      if (local.length > 0) {
        setLocalImages(local);
        setDetail(await fetchPostDetail(item.postId));
        // 已下载文章的图片数若与记录不符，顺手修正（自愈旧的 imageCount=0 记录）
        if (item.imageCount !== local.length) {
          const count = local.length;
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
      } else {
        const [d, imgs] = await Promise.all([
          fetchPostDetail(item.postId),
          fetchPostImages(item.postId).catch(() => [] as PlatformMedia[]),
        ]);
        setDetail(d);
        setImages(imgs);
        // 未下载文章：顺手把站点图片数落库，列表卡片就能显示真实数量
        if (item.imageCount !== imgs.length) {
          const count = imgs.length;
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
      const n = await saveFigmemoPost(selected);
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

  const applyArticleTags = async (next: Record<string, string[]>) => {
    if (!selected) return;
    const clean: Record<string, string[]> = {};
    for (const [g, vs] of Object.entries(next)) {
      const arr = (vs || []).filter(Boolean);
      if (arr.length) clean[g] = arr;
    }
    setSelected({ ...selected, articleTags: clean });
    setItems((prev) =>
      prev.map((it) =>
        it.postId === selected.postId ? { ...it, articleTags: clean } : it,
      ),
    );
    setNavList((prev) =>
      prev.map((it) =>
        it.postId === selected.postId ? { ...it, articleTags: clean } : it,
      ),
    );
    setTagSaving(true);
    try {
      await setArticleTags(selected, clean);
    } catch (err: any) {
      message.error(err?.message || '标签保存失败');
    } finally {
      setTagSaving(false);
    }
  };

  const setGroupTags = (group: string, values: string[]) => {
    if (!selected) return;
    const cur = selected.articleTags || {};
    const next = { ...cur };
    const arr = Array.from(
      new Set(values.map((v) => v.trim()).filter(Boolean)),
    );
    if (arr.length) next[group] = arr;
    else delete next[group];
    applyArticleTags(next);
  };

  // 点一下即打/取消某分类下的一个标签值（快捷标签墙）
  const toggleGroupTag = (group: string, value: string) => {
    if (!selected) return;
    const cur = selected.articleTags?.[group] || [];
    setGroupTags(
      group,
      cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
    );
  };

  const addGroupTag = (group: string, value: string) => {
    if (!selected) return;
    const cur = selected.articleTags?.[group] || [];
    if (cur.includes(value)) return;
    setGroupTags(group, [...cur, value]);
  };

  const addGroup = () => {
    const name = newGroup.trim();
    if (!name) return;
    if (NON_COUNTING_TAG_ROOTS.includes(name)) {
      message.warning('该名称被系统保留，请换一个');
      return;
    }
    if (annotatableGroups.some((g) => g.name === name)) {
      message.info('该分类已存在');
      setNewGroup('');
      return;
    }
    useFigmemoTagsStore.getState().addTagsBatch([{ name, parentId: null }]);
    setNewGroup('');
    setPanelOpen(true);
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

  const hasSelected = selected != null;

  const tagTotal = selected
    ? Object.values(selected.articleTags || {}).reduce(
        (n, vs) => n + (vs?.length || 0),
        0,
      )
    : 0;
  const selectedIsFav = selected ? favSet.has(String(selected.postId)) : false;

  // 详情页用不到列表统计/筛选，跳过重活（此前每次点标签都会全量重算 → 卡顿）
  const counts = useMemo<TagCounts>(
    () =>
      hasSelected ? EMPTY_COUNTS : computeTagCounts(index, items.map(relOf)),
    [hasSelected, index, items],
  );

  const filtered = useMemo(() => {
    if (hasSelected) return [] as FigmemoListItem[];
    let list = items;
    if (filter.tagIds.length) {
      list = list.filter((it) =>
        matchesFilter(index, filter.tagIds, filter.rule, relOf(it)),
      );
    }
    if (filter.unclassifiedOnly) {
      list = list.filter(
        (it) => folderManualTagIds(index, relOf(it)).length === 0,
      );
    }
    if (filter.favoritesOnly) {
      list = list.filter((it) => favSet.has(String(it.postId)));
    }
    const kw = keyword.trim().toLowerCase();
    if (kw) list = list.filter((it) => it.title.toLowerCase().includes(kw));

    const cmpDate = (x: FigmemoListItem, y: FigmemoListItem) =>
      x.date < y.date ? -1 : x.date > y.date ? 1 : 0;
    const arr = [...list];
    arr.sort((a, b) => {
      if (sort === 'rating-desc' || sort === 'rating-asc') {
        const ra = a.hpoi?.rating;
        const rb = b.hpoi?.rating;
        if (ra == null && rb == null) return cmpDate(b, a);
        if (ra == null) return 1;
        if (rb == null) return -1;
        if (ra !== rb) return sort === 'rating-desc' ? rb - ra : ra - rb;
      } else if (sort === 'date-asc') {
        return cmpDate(a, b);
      }
      return cmpDate(b, a);
    });
    return arr;
  }, [hasSelected, items, filter, index, keyword, favSet, sort]);

  // 侧栏「收藏」计数：当前列表范围内已收藏的文章数
  const favoriteCount = useMemo(
    () =>
      hasSelected
        ? 0
        : items.filter((it) => favSet.has(String(it.postId))).length,
    [hasSelected, items, favSet],
  );

  const postUrl = selected?.link;

  // Hpoi 手办维基：用「商品名 + 厂商」预填搜索（手动挑对应词条，不做脆弱的自动匹配）
  const hpoiKeyword = selected
    ? buildHpoiKeyword(selected.title, detail?.contentHtml)
    : '';
  const hpoiUrl = `https://www.hpoi.net/search?keyword=${encodeURIComponent(
    hpoiKeyword,
  )}&category=100`;

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

  const imageMenu = (media: PlatformMedia): MenuProps => ({
    items: [
      ...imageMenuItems({ remoteUrl: media.url, postUrl }),
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
        if (key === 'copyLink' && media.url) {
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

  // 详情视图
  if (selected) {
    return (
      <div className="flex flex-col h-screen">
        <PageHeader />
        <div className="flex items-center gap-2 pb-3">
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => {
              setSelected(null);
              setDetail(null);
              setImages([]);
            }}
          >
            返回列表
          </Button>
          <Button
            icon={<LeftOutlined />}
            disabled={!navPrev}
            onClick={() => {
              if (navPrev) openPost(navPrev);
            }}
          >
            上一篇
          </Button>
          <Button
            icon={<RightOutlined />}
            disabled={!navNext}
            title="下一篇（空格键）"
            onClick={() => {
              if (navNext) openPost(navNext);
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
          <Button
            icon={
              <img
                src={hpoiIcon}
                alt="Hpoi"
                className="w-4 h-4 object-contain"
              />
            }
            title={`在 Hpoi 手办维基搜索：${hpoiKeyword}`}
            onClick={() => openUrl(hpoiUrl)}
          >
            Hpoi
          </Button>
          <Button
            className="ml-auto"
            type="primary"
            icon={<DownloadOutlined />}
            loading={saving}
            onClick={savePost}
          >
            保存该文章
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto pb-10" ref={detailScrollRef}>
          <article className="bg-white rounded-md border-[1px] border-gray-200 max-w-4xl mx-auto p-6">
            <h1 className="text-2xl font-bold leading-snug">
              {selected.title}
            </h1>
            <div className="text-sm text-gray-400 mt-2 flex items-center flex-wrap gap-2">
              <span>{dayjs(selected.date).format('YYYY-MM-DD HH:mm')}</span>
              {selected.categories.map((c) => (
                <Tag key={c.id}>{c.name}</Tag>
              ))}
              {Object.entries(selected.articleTags || {}).flatMap(([g, vs]) =>
                (vs || []).map((v) => (
                  <Tag key={`${g}:${v}`} color="blue">
                    {g}·{v}
                  </Tag>
                )),
              )}
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
                {/* 图片在上，正文在下；有本地文件优先用本地（缩略图缓存，秒开） */}
                {localImages.length > 0 ? (
                  <Image.PreviewGroup>
                    <ul className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(8rem,9rem))] gap-2">
                      {localImages.map((f) => (
                        <Dropdown
                          key={f.path}
                          trigger={['contextMenu']}
                          menu={localImageMenu(f)}
                        >
                          <li className="lib-card-cv relative aspect-square bg-white rounded-md overflow-hidden border-[1px] border-gray-100 group">
                            <LocalThumb
                              filePath={f.path}
                              alt={f.name}
                              className="object-cover w-full h-full"
                              wrapperClassName="w-full h-full"
                              preview
                            />
                          </li>
                        </Dropdown>
                      ))}
                    </ul>
                  </Image.PreviewGroup>
                ) : images.length > 0 ? (
                  <Image.PreviewGroup>
                    <ul className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(8rem,9rem))] gap-2">
                      {images.map((m, i) => (
                        <Dropdown
                          key={`${m.id || m.url}-${i}`}
                          trigger={['contextMenu']}
                          menu={imageMenu(m)}
                        >
                          <li className="lib-card-cv relative aspect-square bg-white rounded-md overflow-hidden border-[1px] border-gray-100 group">
                            <Image
                              src={m.thumbUrl || m.url}
                              alt={m.fileName || ''}
                              loading="lazy"
                              className="object-cover w-full h-full"
                              wrapperClassName="w-full h-full"
                              preview={{ src: m.url }}
                            />
                          </li>
                        </Dropdown>
                      ))}
                    </ul>
                  </Image.PreviewGroup>
                ) : null}
                {detail && detail.contentHtml.trim() && (
                  <div
                    className="figmemo-article"
                    // 正文来自 fig-memo 原站（可信）；已清洗 script/style/figure/a/img
                    dangerouslySetInnerHTML={{ __html: detail.contentHtml }}
                  />
                )}
                {!detail && images.length === 0 && (
                  <Empty description="正文加载失败" />
                )}
              </>
            )}
          </article>
        </div>

        {/* 右上角：Hpoi 候选关联（仅白名单分类） */}
        {selected.categories?.some((c) =>
          HPOI_MATCH_CATEGORY_IDS.includes(c.id),
        ) && (
          <HpoiMatchPanel
            item={selected}
            contentHtml={detail?.contentHtml}
            onConfirm={applyHpoiMatch}
            onClear={() => applyHpoiMatch(null)}
          />
        )}

        {/* 右下角：现代化浮动操作（标签浮窗 + 标签/收藏按钮） */}
        <div className="fixed right-6 bottom-6 z-50">
          <div className="relative flex flex-col items-end gap-3">
            {/* 标签浮窗：绝对定位于按钮上方，不占位；带进/出场动画 */}
            <div
              className={`absolute bottom-full right-0 mb-3 w-72 origin-bottom-right rounded-2xl bg-white/95 backdrop-blur shadow-2xl ring-1 ring-black/5 p-3 max-h-[70vh] overflow-y-auto transition-all duration-200 ease-out ${
                panelOpen
                  ? 'opacity-100 translate-y-0 scale-100'
                  : 'pointer-events-none opacity-0 translate-y-3 scale-95'
              }`}
            >
              <div className="text-sm font-medium mb-2 flex items-center">
                文章标签
                {tagSaving && <Spin size="small" className="ml-2" />}
                <button
                  className="ml-auto text-xs text-gray-400 hover:text-gray-700 transition-colors"
                  onClick={() => setPanelOpen(false)}
                >
                  收起
                </button>
              </div>
              {annotatableGroups.map((g) => {
                const sel = (selected.articleTags || {})[g.name] || [];
                const selSet = new Set(sel);
                // 已选但还不在候选项里的值（如刚自定义输入、标签树尚未刷新）也一并展示
                const options = [
                  ...g.options,
                  ...sel.filter((v) => !g.options.includes(v)),
                ];
                return (
                  <div key={g.name} className="mb-3">
                    <div className="text-xs text-gray-500 mb-1">
                      {g.name}
                      {sel.length > 0 && (
                        <span className="ml-1 text-sky-500">{sel.length}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {options.map((v) => {
                        const on = selSet.has(v);
                        return (
                          <button
                            key={v}
                            type="button"
                            onClick={(e) => {
                              e.currentTarget.blur();
                              toggleGroupTag(g.name, v);
                            }}
                            className={`rounded-full border px-2 py-0.5 text-xs leading-5 transition-colors ${
                              on
                                ? 'border-sky-500 bg-sky-500 text-white'
                                : 'border-gray-200 bg-white text-gray-600 hover:border-sky-400 hover:text-sky-600'
                            }`}
                          >
                            {v}
                          </button>
                        );
                      })}
                      <input
                        type="text"
                        placeholder="＋自定义"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const v = e.currentTarget.value.trim();
                            if (v) {
                              addGroupTag(g.name, v);
                              e.currentTarget.value = '';
                            }
                          }
                        }}
                        onBlur={(e) => {
                          e.currentTarget.value = '';
                        }}
                        className="w-20 rounded-full border border-dashed border-gray-300 bg-transparent px-2 py-0.5 text-xs leading-5 outline-none transition-all focus:w-28 focus:border-sky-400"
                      />
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center gap-1 border-t-[1px] border-gray-100 pt-2">
                <Input
                  size="small"
                  placeholder="新建分类"
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                  onPressEnter={addGroup}
                />
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={addGroup}
                />
              </div>
            </div>

            {/* 标签按钮 */}
            <button
              type="button"
              title="文章标签"
              onClick={() => setPanelOpen((v) => !v)}
              className={`group relative flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg ring-1 ring-black/5 bg-gradient-to-br from-sky-400 to-blue-600 transition-all duration-200 ease-out hover:scale-110 hover:shadow-xl active:scale-95 ${
                panelOpen ? 'ring-2 ring-sky-300' : ''
              }`}
            >
              <TagOutlined className="text-lg transition-transform duration-300 group-hover:rotate-12" />
              {tagTotal > 0 && (
                <span
                  key={tagTotal}
                  className="figmemo-pop absolute -right-1 -top-1 flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-medium text-white shadow"
                >
                  {tagTotal}
                </span>
              )}
            </button>

            {/* 收藏按钮 */}
            <button
              type="button"
              title={selectedIsFav ? '取消收藏' : '收藏'}
              onClick={() =>
                useFigmemoFavoritesStore.getState().toggle(selected.postId)
              }
              className={`group flex h-12 w-12 items-center justify-center rounded-full shadow-lg ring-1 ring-black/5 transition-all duration-200 ease-out hover:scale-110 hover:shadow-xl active:scale-95 ${
                selectedIsFav
                  ? 'bg-gradient-to-br from-pink-400 to-rose-500 text-white'
                  : 'bg-white text-gray-500 hover:text-rose-500'
              }`}
            >
              {selectedIsFav ? (
                <HeartFilled key="on" className="figmemo-pop text-lg" />
              ) : (
                <HeartOutlined
                  key="off"
                  className="text-lg transition-transform duration-300 group-hover:scale-110"
                />
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 列表视图
  return (
    <div className="flex flex-col h-screen">
      <PageHeader />
      <div className="flex-1 min-h-0 flex gap-4 pb-4">
        <CategorySidebar
          filter={filter}
          counts={counts}
          favoriteCount={favoriteCount}
          onChange={setFilter}
        />
        <section className="flex-1 min-w-0 flex flex-col" aria-label="文章列表">
          <div className="flex items-center flex-wrap gap-2 pb-3">
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
                { label: 'Hpoi 评分 高→低', value: 'rating-desc' },
                { label: 'Hpoi 评分 低→高', value: 'rating-asc' },
              ]}
            />
            <Button
              className="ml-auto"
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={load}
            >
              刷新
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto pb-6">
            {loading && items.length === 0 ? (
              <div className="flex justify-center py-20">
                <Spin size="large" />
              </div>
            ) : filtered.length === 0 ? (
              <Empty className="mt-16" description="暂无文章" />
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,10rem))] gap-3">
                {filtered.map((item) => {
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
                            {Object.keys(item.articleTags || {}).length > 0 && (
                              <span
                                title="已打标签"
                                className="flex items-center justify-center w-4 h-4 rounded-full bg-slate-400 text-white shadow"
                              >
                                <TagOutlined className="text-[10px] leading-none" />
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
                            {item.hpoi?.rating != null && (
                              <span className="text-amber-500">
                                ★{item.hpoi.rating}
                              </span>
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
        </section>
      </div>
    </div>
  );
};
