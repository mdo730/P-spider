/* eslint-disable react/prop-types */
import {
  App,
  Avatar,
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Image,
  MenuProps,
  Modal,
  Popover,
  Select,
  Space,
  Spin,
} from 'antd';
import {
  ArrowUpOutlined,
  CalendarOutlined,
  CopyOutlined,
  DownOutlined,
  DownloadOutlined,
  FileOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlayCircleFilled,
  ReloadOutlined,
  TagOutlined,
} from '@ant-design/icons';
import { RetweetMode } from '../interfaces/Subscription';
import dayjs from 'dayjs';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PageHeader } from '../components/PageHeader';
import { LocalThumb } from '../components/library/LocalThumb';
import { useRemoteVideo } from '../hooks/useRemoteVideo';
import { ensureMediaProxy, mediaProxyUrl } from '../utils/media-proxy';
import { copyTextToClipboard } from '../utils/clipboard';
import { resolveTweetMediaUrl } from '../services/tweet-media';
import {
  DownloadHistoryRecord,
  getMediaOriginalUrl,
  getMediaThumbUrl,
  TimelineGroup,
} from '../stores/download-history';
import { useDownloadStore } from '../stores/download';
import { PlatformMedia, PlatformSource } from '../platforms';
import { toPlatformMedia } from '../platforms/twitter';
import { useRemoteImageSrc } from '../hooks/useRemoteImage';
import { TwitterMedia } from '../interfaces/TwitterMedia';
import {
  handleImageMenuKey,
  imageMenuItems,
  ImageMenuCtx,
} from '../utils/image-menu';
import { buildUserUrl } from '../twitter/url';
import {
  getRecentSiteNotes,
  refreshSitePosts as refreshFigmemoSites,
} from '../services/figmemo';
import {
  getRecentSiteNotes as getMoeyoNotes,
  refreshSitePosts as refreshMoeyoSites,
} from '../services/moeyo';
import { getHpoiIntelNotes, refreshHpoiIntel } from '../services/hpoi-intel';
import { syncHpoiIncremental } from '../services/hpoi-delta';
import {
  ensureHpoiIndexLoaded,
  getHpoiHobbyRefs,
} from '../services/hpoi-search';
import { useHpoiFavoritesStore } from '../stores/hpoi-favorites';

const REF_TO_KIND: Record<string, string> = {
  c: 'company',
  s: 'series',
  w: 'works',
  h: 'charactar',
  p: 'person',
};

/** 只保留「与收藏相关」的情报：收藏了该词条，或其关联的厂商/作品/角色等被收藏 */
async function filterHpoiNotesByFav<T extends { postId: string }>(
  list: T[],
): Promise<T[]> {
  const favs = new Set(useHpoiFavoritesStore.getState().ids);
  if (favs.size === 0) return [];
  let indexReady = false;
  try {
    indexReady = await ensureHpoiIndexLoaded();
  } catch {
    indexReady = false;
  }
  return list.filter((n) => {
    const id = Number(n.postId);
    if (!id) return false;
    if (favs.has(`hobby:${id}`)) return true;
    if (!indexReady) return false;
    const refs = getHpoiHobbyRefs(id);
    if (!refs) return false;
    return refs.some((r) => {
      const [c, rid] = r.split(':');
      const k = REF_TO_KIND[c];
      return !!k && favs.has(`${k}:${rid}`);
    });
  });
}
import { getRecentRetweetNotes, RetweetNote } from '../services/retweets';
import { FeedItem, getRecentFeedItems } from '../services/feed';
import { getUserFolderMap } from '../services/user-folders';
import { useFigmemoStore } from '../stores/figmemo';
import { useMoeyoStore } from '../stores/moeyo';
import { useHpoiIntelStore } from '../stores/hpoi-intel';
import { useLibraryStore } from '../stores/library';
import { tagChipActiveStyle, tagChipStyle } from '../utils/tag-color';
import { useSettingsStore } from '../stores/settings';
import { useRouteStore } from '../stores/route';
import figmemoIcon from '../assets/platform-icons/figmemo.png';
import moeyoIcon from '../assets/platform-icons/moeyo.png';
import hpoiIcon from '../assets/platform-icons/hpoi.png';
import { toAssetUrl } from '../utils/asset';
import { openPath, openUrl, showInFolder } from '../utils/shell';
import { useHomepageStore } from '../stores/homepage';
import { useSubscriptionStore } from '../stores/subscription';
import { useSiteCacheStore } from '../stores/site-cache';
import { ROUTES } from '../constants/routes';
import MediaType from '../enums/MediaType';

// 提前启动本地流式代理（GIF/视频远程播放用）
ensureMediaProxy();

const PAGE_SIZE = 25;
const LOAD_MORE_STEP = 5;
const RANGE_DAYS = 7;
/** 自动刷新间隔（仅 moeyo / fig-memo 站点列表） */
const AUTO_REFRESH_MS = 20 * 60 * 1000;
/** 日期刻度条展开高度（px） */
const OPEN_HEIGHT = 360;

/** 「订阅原作者」下拉里的刷新间隔选项 */
const INTERVAL_OPTIONS = [
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 180, label: '3 小时' },
  { value: 360, label: '6 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '1 天' },
];

const MEDIA_TYPE_LABEL: Record<string, string> = {
  photo: '图片',
  video: '视频',
  animated_gif: 'GIF',
};

/**
 * 站点日期归一：moeyo/fig-memo 的日期是站点本地时间（日本 +09:00，无时区）。
 * 不换算的话，字符串排序会让它们相对 UTC 的下载记录「虚高约 9 小时」而浮在时间流顶端。
 */
function siteIso(dateStr: string): string {
  if (!dateStr) return dateStr;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(`${dateStr}+09:00`);
  return Number.isNaN(d.getTime()) ? dateStr : d.toISOString();
}

/** 记事来源 → 筛选胶囊 token */
const NOTE_TOKEN: Record<'figmemo' | 'moeyo' | 'intel', string> = {
  figmemo: 'fig-memo',
  moeyo: 'moeyo',
  intel: 'hpoi',
};

/** 把站点「新记事 / 情报」（未下载条目）转成时间流分组 */
function noteGroup(
  page: 'figmemo' | 'moeyo' | 'intel',
  sourceLabel: string,
  n: {
    postId: string;
    date: string;
    title: string;
    link: string;
    coverUrl?: string;
    categories: string[];
  },
): TimelineGroup {
  const iso = siteIso(n.date);
  return {
    postId: n.postId,
    tweetTime: iso,
    fullText: n.title,
    title: n.title,
    kind: 'note',
    articlePage: page,
    sourceLabel,
    categories: n.categories,
    filterTokens: [NOTE_TOKEN[page]],
    records: n.coverUrl
      ? [
          {
            postId: n.postId,
            tweetTime: iso,
            mediaType: MediaType.Photo,
            mediaUrl: n.coverUrl,
            filePath: '',
            fileName: '',
            downloadedAt: 0,
            source: 'subscription',
            // hpoi 不是下载平台，不设 platform（取图靠 URL 判别 Referer）
            platform: page === 'intel' ? undefined : page,
            postUrl: n.link,
            displayName: sourceLabel,
          },
        ]
      : [],
  };
}

/** 把「转贴」缓存条目转成时间流分组（原作者在前，标注转推者） */
function retweetGroup(n: RetweetNote): TimelineGroup {
  return {
    postId: n.id,
    tweetTime: n.retweetedAt,
    fullText: n.text,
    username: n.screenName,
    displayName: n.authorName,
    kind: 'retweet',
    avatar: n.authorAvatar,
    retweetedBy: n.retweetedBy[0]?.screenName,
    retweetedByCount: n.retweetedBy.length,
    filterTokens: ['转贴'],
    records: n.medias.map((m) => ({
      postId: n.id,
      tweetTime: n.retweetedAt,
      mediaType: m.type,
      mediaUrl: m.url,
      videoUrl: m.videoUrl,
      filePath: '',
      fileName: '',
      downloadedAt: 0,
      source: 'subscription',
      platform: 'twitter',
      postUrl: n.link,
      username: n.screenName,
      displayName: n.authorName,
    })),
  };
}

/** 本地库「一级文件夹名 → 标签名[]」映射（来自 library.json 的 categories） */
function buildFolderTagMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const c of useLibraryStore.getState().categories) {
    for (const f of c.folders) {
      const arr = map.get(f);
      if (arr) {
        if (!arr.includes(c.name)) arr.push(c.name);
      } else {
        map.set(f, [c.name]);
      }
    }
  }
  return map;
}

/**
 * feed 条目 → 命中的「本地库标签」名。
 * 作者文件夹名经「账号 → 文件夹名」绑定（user-folders.json）解析，
 * 绑定优先（id > username），再回退显示名 / 用户名。
 */
function resolveFeedLibraryTags(
  item: FeedItem,
  folderTags: Map<string, string[]>,
  pinned: Record<string, string>,
): string[] {
  const src = item.source;
  const candidates: string[] = [];
  const push = (n?: string) => {
    if (n && !candidates.includes(n)) candidates.push(n);
  };
  if (item.userId) push(pinned[`${src}:id:${item.userId}`]);
  if (item.username) push(pinned[`${src}:un:${item.username.toLowerCase()}`]);
  push(item.displayName);
  push(item.username);
  const tags: string[] = [];
  for (const n of candidates) {
    const t = folderTags.get(n);
    if (t) {
      for (const x of t) if (!tags.includes(x)) tags.push(x);
    }
  }
  return tags;
}

/** 把 feed 缓存条目（X/Pawchive/pixiv）转成时间流分组 */
function feedGroup(item: FeedItem, libraryTags: string[]): TimelineGroup {
  return {
    postId: item.id,
    tweetTime: item.time,
    fullText: item.text,
    username: item.username,
    displayName: item.displayName,
    avatar: item.avatar,
    kind: 'download',
    libraryTags,
    filterTokens: libraryTags,
    records: item.medias.map((m) => ({
      postId: item.id,
      tweetTime: item.time,
      mediaType: m.type,
      mediaUrl: m.url,
      videoUrl: m.videoUrl,
      filePath: '',
      fileName: '',
      downloadedAt: 0,
      source: 'subscription',
      platform: item.source,
      postUrl: item.url,
      username: item.username,
      displayName: item.displayName,
      avatar: item.avatar,
    })),
  };
}

/** 会话级缓存：切到别的标签再回来保持原样（列表、加载条数、滚动位置） */
let groupsCache: TimelineGroup[] | null = null;
let visibleCountCache = PAGE_SIZE;
let scrollTopCache = 0;

export const TimelinePage: React.FC = () => {
  const { message } = App.useApp();
  const [groups, setGroups] = useState<TimelineGroup[]>(groupsCache || []);
  const [visibleCount, setVisibleCount] = useState(visibleCountCache);
  const [loading, setLoading] = useState(!groupsCache);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const maxTextLen = useSettingsStore((s) => s.timeline?.maxTextLen ?? 200);
  const maxImages = useSettingsStore((s) => s.timeline?.maxImages ?? 6);
  const rangeDays = useSettingsStore(
    (s) => s.timeline?.rangeDays ?? RANGE_DAYS,
  );
  // 胶囊筛选：本地库标签 + [转贴] + [fig-memo] + [moeyo]（多选并集，未命中隐藏）
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const libraryCategories = useLibraryStore((s) => s.categories);
  const figmemoEnabled = useFigmemoStore((s) => s.featureEnabled);
  const moeyoEnabled = useMoeyoStore((s) => s.featureEnabled);
  const intelEnabled = useHpoiIntelStore((s) => s.featureEnabled);

  // 启动/启用 hpoi 时增量补齐新词条（距上次 <12h 自动跳过，后台静默）
  useEffect(() => {
    if (!intelEnabled) return;
    void syncHpoiIncremental(false).catch(() => undefined);
  }, [intelEnabled]);

  const build = useCallback(async (): Promise<TimelineGroup[]> => {
    const days = Math.min(
      30,
      Math.max(
        1,
        useSettingsStore.getState().timeline?.rangeDays ?? RANGE_DAYS,
      ),
    );
    // 时间流 v2：X / Pawchive / pixiv 来自订阅刷新结果 feed 缓存（下不下载都能看到）
    const folderTags = buildFolderTagMap();
    let pinned: Record<string, string> = {};
    try {
      pinned = await getUserFolderMap();
    } catch {
      // 忽略
    }
    let downloads: TimelineGroup[] = [];
    try {
      const feed = await getRecentFeedItems(days);
      downloads = feed.map((it) =>
        feedGroup(it, resolveFeedLibraryTags(it, folderTags, pinned)),
      );
    } catch {
      // 忽略
    }

    const notes: TimelineGroup[] = [];
    if (useFigmemoStore.getState().featureEnabled) {
      try {
        for (const n of await getRecentSiteNotes(days)) {
          notes.push(noteGroup('figmemo', 'fig-memo', n));
        }
      } catch {
        // 忽略
      }
    }
    if (useMoeyoStore.getState().featureEnabled) {
      try {
        for (const n of await getMoeyoNotes(
          days,
          useSettingsStore.getState().timeline?.moeyoCategoryIds,
        )) {
          notes.push(noteGroup('moeyo', 'moeyo', n));
        }
      } catch {
        // 忽略
      }
    }
    if (useHpoiIntelStore.getState().featureEnabled) {
      try {
        let hpoiNotes = await getHpoiIntelNotes(
          days,
          useHpoiIntelStore.getState().categoryIds,
        );
        if (useHpoiIntelStore.getState().favoritesOnly) {
          hpoiNotes = await filterHpoiNotesByFav(hpoiNotes);
        }
        for (const n of hpoiNotes) {
          notes.push(noteGroup('intel', 'hpoi', n));
        }
      } catch {
        // 忽略
      }
    }
    const retweets: TimelineGroup[] = [];
    try {
      for (const n of await getRecentRetweetNotes(days)) {
        retweets.push(retweetGroup(n));
      }
    } catch {
      // 忽略
    }
    return [...downloads, ...notes, ...retweets].sort((a, b) =>
      b.tweetTime > a.tweetTime ? 1 : -1,
    );
  }, []);

  // 收藏变化 / 「只看收藏相关」开关变化 → 重建时间流（否则需手动刷新）
  const favIds = useHpoiFavoritesStore((s) => s.ids);
  const favoritesOnly = useHpoiIntelStore((s) => s.favoritesOnly);
  const favWatchFirst = useRef(true);
  useEffect(() => {
    if (favWatchFirst.current) {
      favWatchFirst.current = false;
      return;
    }
    if (!intelEnabled) return;
    let alive = true;
    void (async () => {
      const merged = await build();
      if (!alive) return;
      groupsCache = merged;
      setGroups(merged);
    })();
    return () => {
      alive = false;
    };
  }, [favIds, favoritesOnly, intelEnabled, build]);

  // 后台为「本地已删且历史无直链」的视频/GIF 自动反查直链（网格里也能动）
  const resolveMissingMedia = useCallback(async (gs: TimelineGroup[]) => {
    const targets: DownloadHistoryRecord[] = [];
    for (const g of gs) {
      for (const r of g.records) {
        if (
          (r.mediaType === MediaType.Video || r.mediaType === MediaType.Gif) &&
          r.existsLocal === false &&
          !r.videoUrl &&
          r.username &&
          r.postId
        ) {
          targets.push(r);
        }
      }
    }
    let changed = false;
    for (const r of targets.slice(0, 6)) {
      const url = await resolveTweetMediaUrl(r.username!, r.postId);
      if (url) {
        r.videoUrl = url;
        changed = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (changed) setGroups((prev) => [...prev]);
  }, []);

  // 挂载：有会话缓存先秒显（切回原样），**同时后台重新聚合**以反映新下载/新内容
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!groupsCache) setLoading(true);
      const merged = await build();
      if (!alive) return;
      groupsCache = merged;
      visibleCountCache = Math.min(
        Math.max(visibleCountCache, PAGE_SIZE),
        merged.length,
      );
      setGroups(merged);
      setVisibleCount(visibleCountCache);
      setLoading(false);
      void resolveMissingMedia(merged);
    })();
    return () => {
      alive = false;
    };
  }, [build, resolveMissingMedia]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const subs = useSubscriptionStore.getState();
      // hpoi 与订阅检查**并行**跑（否则 hpoi 回溯要等订阅跑完，看起来像卡住）
      const hpoiKey = 'hpoi-intel-refresh';
      let hpoiStarted = false;
      const hpoiTask = useHpoiIntelStore.getState().featureEnabled
        ? refreshHpoiIntel(
            useSettingsStore.getState().timeline?.rangeDays ?? RANGE_DAYS,
            useHpoiIntelStore.getState().categoryIds,
            (p) => {
              hpoiStarted = true;
              message.loading({
                key: hpoiKey,
                duration: 0,
                content:
                  p.mode === 'full'
                    ? `hpoi 正在回溯近 30 天情报…（第 ${p.page} 页 · 已 ${p.total} 条）`
                    : `hpoi 情报更新中…（已 ${p.total} 条）`,
              });
            },
          )
            .catch(() => undefined)
            .finally(() => {
              if (hpoiStarted) {
                message.success({ key: hpoiKey, content: 'hpoi 情报已更新' });
              }
            })
        : Promise.resolve();
      // 订阅检查（含转贴更新）
      if (subs.subscriptions.length > 0) {
        await subs.checkAll().catch(() => {
          // 单个订阅失败不阻断整体刷新
        });
      }
      await hpoiTask;
      const merged = await build();
      groupsCache = merged;
      visibleCountCache = Math.min(
        Math.max(visibleCount, PAGE_SIZE),
        merged.length,
      );
      setGroups(merged);
      setVisibleCount(visibleCountCache);
      void resolveMissingMedia(merged);
      message.success('已更新');
    } finally {
      setRefreshing(false);
    }
  }, [build, visibleCount, message, resolveMissingMedia]);

  // 自动刷新：只刷新 moeyo / fig-memo 的站点列表（不触发订阅检查），然后重新聚合时间流
  const refreshSites = useCallback(async () => {
    try {
      if (useFigmemoStore.getState().featureEnabled) {
        await refreshFigmemoSites().catch(() => {
          /* 忽略 */
        });
      }
      if (useMoeyoStore.getState().featureEnabled) {
        await refreshMoeyoSites().catch(() => {
          /* 忽略 */
        });
      }
      if (useHpoiIntelStore.getState().featureEnabled) {
        await refreshHpoiIntel(
          useSettingsStore.getState().timeline?.rangeDays ?? RANGE_DAYS,
          useHpoiIntelStore.getState().categoryIds,
        ).catch(() => {
          /* 忽略 */
        });
      }
      // 站点列表已刷新 → 让 fig-memo / moeyo 页的会话缓存失效（跳过去能看到新文章）
      useSiteCacheStore.getState().bump();
      const merged = await build();
      groupsCache = merged;
      setGroups(merged);
      void resolveMissingMedia(merged);
    } catch {
      /* 忽略 */
    }
  }, [build, resolveMissingMedia]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshSites();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshSites]);

  // 筛选后的条目（多选并集；没命中的隐藏）；默认 [全部] 不过滤
  const displayedGroups = useMemo(() => {
    if (filterTags.size === 0) return groups;
    return groups.filter((g) =>
      (g.filterTokens || []).some((t) => filterTags.has(t)),
    );
  }, [groups, filterTags]);

  // 筛选浮窗里的胶囊选项：本地库标签 + 转贴 + 站点（fig-memo/moeyo）
  const filterOptions = useMemo(() => {
    const opts = libraryCategories.map((c) => c.name);
    const withFixed = (t: string) => {
      if (!opts.includes(t)) opts.push(t);
    };
    withFixed('转贴');
    if (figmemoEnabled) withFixed('fig-memo');
    if (moeyoEnabled) withFixed('moeyo');
    if (intelEnabled) withFixed('hpoi');
    return opts;
  }, [libraryCategories, figmemoEnabled, moeyoEnabled, intelEnabled]);

  const toggleFilterTag = (tag: string) => {
    setFilterTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    // 模拟异步，避免快速连续触发
    setTimeout(() => {
      setVisibleCount((prev) => {
        const next = Math.min(prev + LOAD_MORE_STEP, displayedGroups.length);
        visibleCountCache = next;
        return next;
      });
      setLoadingMore(false);
    }, 200);
  }, [displayedGroups.length]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && visibleCount < displayedGroups.length) {
        loadMore();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [displayedGroups.length, visibleCount, loadMore]);

  // 滚动位置保存/恢复（滚动容器是外层 <main>，切标签会重建）
  // 找到真正可滚动的祖先（App 外层 overflow-auto 的 div，而非 <main>）
  const getScroller = (): HTMLElement | null => {
    let el = rootRef.current?.parentElement ?? null;
    while (el) {
      const oy = window.getComputedStyle(el).overflowY;
      if (
        (oy === 'auto' || oy === 'scroll') &&
        el.scrollHeight > el.clientHeight
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return (document.scrollingElement as HTMLElement | null) || null;
  };
  useEffect(() => {
    if (loading) return;
    const scroller = getScroller();
    if (!scroller) return;
    const restore = () => {
      if (scroller.scrollTop !== scrollTopCache) {
        scroller.scrollTop = scrollTopCache;
      }
    };
    restore();
    // 内容高度可能尚未稳定，下一帧再补一次
    const raf = requestAnimationFrame(restore);
    const onScroll = () => {
      scrollTopCache = scroller.scrollTop;
    };
    scroller.addEventListener('scroll', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [loading]);

  const scrollToTop = () => {
    const scroller = getScroller();
    if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });
    scrollTopCache = 0;
  };

  const visibleGroups = displayedGroups.slice(0, visibleCount);

  // 拖日期刻度条 → 定位到该日期（必要时先展开渲染到该条，再滚动到它）
  const jumpToDate = useCallback(
    (ms: number) => {
      if (displayedGroups.length === 0) return;
      let idx = displayedGroups.findIndex(
        (g) => new Date(g.tweetTime).getTime() <= ms,
      );
      if (idx < 0) idx = displayedGroups.length - 1;
      const need = idx + 1;
      if (need > visibleCount) {
        visibleCountCache = need;
        setVisibleCount(need);
      }
      requestAnimationFrame(() => {
        const g = displayedGroups[idx];
        const el = document.getElementById(
          `tl-${g.kind || 'download'}-${g.postId}`,
        );
        el?.scrollIntoView({ block: 'start' });
      });
    },
    [displayedGroups, visibleCount],
  );

  return (
    <div ref={rootRef}>
      <PageHeader />
      <section className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-20">
            <Spin size="large" />
          </div>
        ) : visibleGroups.length === 0 ? (
          <Empty
            description={
              groups.length > 0
                ? '没有命中筛选的内容'
                : `近 ${rangeDays} 天还没有内容，订阅刷新 / 新记事会显示在这里`
            }
          />
        ) : (
          <>
            <p className="text-sm text-gray-400">
              近 {rangeDays} 天共 {displayedGroups.length} 条
              {filterTags.size > 0 && `（筛自 ${groups.length} 条）`}
            </p>
            <ul className="space-y-4">
              {visibleGroups.map((group) => (
                <TimelineItem
                  key={`${group.kind || 'download'}-${group.postId}`}
                  group={group}
                  maxTextLen={maxTextLen}
                  maxImages={maxImages}
                />
              ))}
            </ul>
            <div ref={sentinelRef} className="h-2" />
            {loadingMore && (
              <div className="flex justify-center py-4">
                <Spin size="small" />
              </div>
            )}
            {visibleCount >= displayedGroups.length && (
              <p className="text-center text-gray-400 text-sm py-4">
                已加载全部 {displayedGroups.length} 条
              </p>
            )}
          </>
        )}
      </section>

      {/* 右下角圆形按钮：日期定位 / 刷新 / 标签筛选 / 回到顶部 */}
      <div className="fixed right-6 bottom-6 z-50 flex flex-col items-end gap-3">
        <TimelineDateScrubber
          groups={displayedGroups}
          rangeDays={rangeDays}
          onJump={jumpToDate}
        />
        <button
          type="button"
          title="刷新"
          onClick={refresh}
          disabled={refreshing}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-600 shadow-lg ring-1 ring-black/5 transition-all duration-200 hover:scale-110 hover:text-ant-color-primary active:scale-95 disabled:opacity-60"
        >
          <ReloadOutlined spin={refreshing} className="text-lg" />
        </button>
        <button
          type="button"
          title="标签筛选"
          onClick={() => setFilterOpen((v) => !v)}
          className={`relative flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/5 transition-all duration-200 hover:scale-110 active:scale-95 ${
            filterTags.size > 0 || filterOpen
              ? 'text-ant-color-primary'
              : 'text-gray-600 hover:text-ant-color-primary'
          }`}
        >
          <TagOutlined className="text-lg" />
          {filterTags.size > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ant-color-primary px-1 text-[10px] leading-none text-white">
              {filterTags.size}
            </span>
          )}
        </button>
        <button
          type="button"
          title="回到顶部"
          onClick={scrollToTop}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-600 shadow-lg ring-1 ring-black/5 transition-all duration-200 hover:scale-110 hover:text-ant-color-primary active:scale-95"
        >
          <ArrowUpOutlined className="text-lg" />
        </button>
      </div>

      {/* 标签筛选浮窗（约 1/4 屏）：胶囊多选并集；默认 [全部] */}
      {filterOpen && (
        <div className="fixed bottom-24 right-6 z-40 flex w-[min(360px,82vw)] max-h-[45vh] flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/5">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-sm font-medium">标签筛选</span>
            <span className="text-xs text-gray-400">多选并集 · 未命中隐藏</span>
          </div>
          <div className="flex flex-wrap gap-2 overflow-y-auto p-3">
            <button
              type="button"
              onClick={() => setFilterTags(new Set())}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filterTags.size === 0
                  ? 'border-transparent bg-ant-color-primary text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              全部
            </button>
            {filterOptions.map((t) => {
              const active = filterTags.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleFilterTag(t)}
                  style={active ? tagChipActiveStyle(t) : tagChipStyle(t)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    active ? '' : 'hover:brightness-95'
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * 同一条媒体可能被重复记录（如 GIF 同时存了 .mp4 与封面 .jpg）——按 mediaUrl 去重，
 * 优先保留非封面(jpg)的那条，避免时间流一张图显示两次。
 */
function dedupeMediaRecords(
  list: DownloadHistoryRecord[],
): DownloadHistoryRecord[] {
  const isPosterJpg = (r: DownloadHistoryRecord) =>
    /\.jpe?g$/i.test(r.fileName || '');
  const index = new Map<string, number>();
  const out: DownloadHistoryRecord[] = [];
  for (const r of list) {
    const key = r.mediaUrl || r.filePath || `${r.postId}-${r.fileName}`;
    const i = index.get(key);
    if (i === undefined) {
      index.set(key, out.length);
      out.push(r);
    } else if (isPosterJpg(out[i]) && !isPosterJpg(r)) {
      out[i] = r; // 用非封面替换封面
    }
  }
  return out;
}

/** 时间流「日期刻度条」：圆形按钮 → 点击展开为长条，按自定义保留天数做刻度，拖动定位到某天 */
const TimelineDateScrubber: React.FC<{
  groups: TimelineGroup[];
  rangeDays: number;
  onJump: (ms: number) => void;
}> = ({ groups, rangeDays, onJump }) => {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [frac, setFrac] = useState(0); // 默认手柄在顶部（最新，0 天前）
  const [ball, setBall] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // 点击空白处 → 取消本次跳转并缩回
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false);
        setBall(null);
      }
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const newest = useMemo(() => {
    let m = 0;
    for (const g of groups) {
      const t = new Date(g.tweetTime).getTime();
      if (t > m) m = t;
    }
    return m || Date.now();
  }, [groups]);
  const spanMs = Math.max(1, rangeDays) * 86400000;
  const dateFor = (f: number) => newest - f * spanMs;

  const ticks = useMemo(() => {
    const step = rangeDays <= 7 ? 1 : rangeDays <= 15 ? 2 : 5;
    const arr: number[] = [];
    for (let d = 0; d <= rangeDays; d += step) arr.push(d);
    if (arr[arr.length - 1] !== rangeDays) arr.push(rangeDays);
    return arr;
  }, [rangeDays]);

  const FRAC_INSET = 12; // 上下留白（px）
  const fracFromEvent = (clientY: number) => {
    const el = barRef.current;
    if (!el) return 1;
    const rect = el.getBoundingClientRect();
    const usable = Math.max(1, rect.height - FRAC_INSET * 2);
    return Math.min(1, Math.max(0, (clientY - rect.top - FRAC_INSET) / usable));
  };
  const posOf = (f: number) => FRAC_INSET + f * (OPEN_HEIGHT - FRAC_INSET * 2);

  if (groups.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="按日期快速定位"
        onClick={() => {
          if (!open) {
            setFrac(0);
            setOpen(true);
          }
        }}
        className="flex items-center justify-center self-end overflow-hidden rounded-full bg-white text-gray-600 shadow-lg ring-1 ring-black/5 transition-[height,width] duration-200 ease-out will-change-[height,width] hover:text-ant-color-primary"
        style={{ width: open ? 58 : 44, height: open ? OPEN_HEIGHT : 44 }}
      >
        {open ? (
          <div
            ref={barRef}
            className="relative h-full w-full cursor-ns-resize select-none"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              setDragging(true);
              setFrac(fracFromEvent(e.clientY));
              setBall(null);
            }}
            onPointerMove={(e) => {
              const f = fracFromEvent(e.clientY);
              if (dragging) setFrac(f);
              setBall({
                x: e.clientX,
                y: e.clientY,
                text: `${dayjs(dateFor(f)).format('MM-DD')}（${Math.round(
                  f * rangeDays,
                )} 天前）`,
              });
            }}
            onPointerUp={(e) => {
              const f = fracFromEvent(e.clientY);
              setDragging(false);
              setFrac(f);
              setBall(null);
              setOpen(false);
              onJump(dateFor(f));
            }}
            onPointerLeave={() => setBall(null)}
          >
            {/* 竖线 */}
            <div
              className="absolute left-[18px] w-px bg-gray-200"
              style={{ top: FRAC_INSET, bottom: FRAC_INSET }}
            />
            {/* 刻度：左侧竖线上小横线，右侧标数字 */}
            {ticks.map((d) => {
              const f = d / rangeDays;
              return (
                <div
                  key={d}
                  className="absolute left-[18px] -translate-y-1/2"
                  style={{ top: posOf(f) }}
                >
                  <div className="h-px w-2.5 bg-gray-300" />
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] leading-none text-gray-400">
                    {d}
                  </div>
                </div>
              );
            })}
            {/* 当前手柄 */}
            <div
              className="absolute left-[18px] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ant-color-primary shadow"
              style={{ top: posOf(frac) }}
            />
          </div>
        ) : (
          <CalendarOutlined className="text-lg" />
        )}
      </button>
      {ball && (
        <div
          className="pointer-events-none fixed z-[1000] -translate-x-full -translate-y-1/2 whitespace-nowrap rounded-full bg-black/80 px-2 py-1 text-xs text-white"
          style={{ left: ball.x - 10, top: ball.y }}
        >
          {ball.text}
        </div>
      )}
    </>
  );
};

const TimelineItem: React.FC<{
  group: TimelineGroup;
  maxTextLen: number;
  maxImages: number;
}> = ({ group, maxTextLen, maxImages }) => {
  const { message } = App.useApp();
  const openArticle = useRouteStore((s) => s.openArticle);
  const records = dedupeMediaRecords(group.records);
  const first = records[0];
  const url = first?.username
    ? buildUserUrl(first.username)
    : 'javascript:void(0);';
  // 头像：下载/转贴用真人头像；记事用对应标签页的图标
  const platformIcon =
    group.articlePage === 'figmemo'
      ? (figmemoIcon as string)
      : group.articlePage === 'moeyo'
        ? (moeyoIcon as string)
        : group.articlePage === 'intel'
          ? (hpoiIcon as string)
          : undefined;
  // pixiv 头像在 i.pximg.net，需带 Referer 经后端拉取
  const pixivAvatar = useRemoteImageSrc(
    first?.platform === 'pixiv' ? group.avatar || first?.avatar : undefined,
    { headers: { Referer: 'https://www.pixiv.net/' } },
  );
  const avatarSrc =
    first?.platform === 'pixiv'
      ? pixivAvatar || group.avatar || first?.avatar
      : group.avatar || (group.kind === 'note' ? platformIcon : first?.avatar);
  const avatarName = group.displayName || group.username || '?';

  const menuFor = (ctx: ImageMenuCtx): MenuProps => ({
    items: imageMenuItems(ctx),
    onClick: async ({ key, domEvent }) => {
      domEvent.stopPropagation();
      await handleImageMenuKey(key, ctx, message);
    },
  });

  const text = group.fullText || '';
  const textClipped = text.length > maxTextLen;
  const shownText = textClipped ? `${text.slice(0, maxTextLen)}…` : text;
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const [subscribing, setSubscribing] = useState(false);
  // 当前播放的视频：本地用 asset 直链；远程（未下载转贴）经后端代理拉取后播放
  const [video, setVideo] = useState<{
    local?: string;
    remote?: string;
    postUrl?: string;
  } | null>(null);
  const remoteVideo = useRemoteVideo(video?.remote);
  const [videoError, setVideoError] = useState(false);
  // 「订阅原作者」下拉里可调整的项（默认：12 小时 / 照片+视频+GIF / 不含转推）
  const [subInterval, setSubInterval] = useState(720);
  const [subMedia, setSubMedia] = useState<Set<string>>(
    () => new Set(['photo', 'video', 'gif']),
  );
  const [subRetweet, setSubRetweet] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const isRetweet = group.kind === 'retweet';
  const subscribed = group.username
    ? subscriptions.some(
        (s) =>
          s.source === 'twitter' &&
          s.username.toLowerCase() === group.username!.toLowerCase(),
      )
    : false;

  // 点击原作者 → 跳到 app 内主页（Homepage 页有订阅按钮）
  const openAuthor = (sn: string) => {
    const hp = useHomepageStore.getState();
    // 必须先清掉上一个用户的媒体列表，否则主页挂载时会走「加载更多」而非重新加载
    hp.setKeyword(sn);
    hp.clearUser();
    hp.clearPostList();
    const home = ROUTES.find((r) => r.id === 'home');
    if (home) useRouteStore.getState().setRoute(home);
    hp.loadUser(sn).catch(() => {
      message.error('加载用户失败，请检查网络或 Cookie');
    });
  };

  const subscribeAuthor = async (
    retweetMode: RetweetMode = 'off',
    intervalMin = 720,
    mediaTypes: MediaType[] = [MediaType.Photo, MediaType.Video, MediaType.Gif],
  ) => {
    if (!group.username) return;
    setSubscribing(true);
    try {
      const result = await useSubscriptionStore.getState().addSubscription({
        source: 'twitter',
        username: group.username,
        intervalMin,
        mediaTypes: mediaTypes.length
          ? mediaTypes
          : [MediaType.Photo, MediaType.Video, MediaType.Gif],
        retweetMode,
      });
      if (result === 'updated') {
        message.success(`已更新 @${group.username} 的订阅选项`);
      } else if (retweetMode === 'only') {
        message.success(
          `已订阅 @${group.username}（仅转推：只进时间流，不下载）`,
        );
      } else {
        message.success(`已订阅 @${group.username}，之后其原创媒体会自动下载`);
      }
    } catch (err: any) {
      message.error(`订阅失败：${err?.message || '未知原因'}`);
    } finally {
      setSubscribing(false);
    }
  };

  // 未下载的媒体（如转贴视频）：右键「保存到本地」，走正常下载管线
  const saveMedia = async (record: DownloadHistoryRecord) => {
    try {
      let tmedia: TwitterMedia;
      if (record.mediaType === MediaType.Photo) {
        tmedia = {
          id: record.postId,
          url: record.mediaUrl,
          type: MediaType.Photo,
        };
      } else if (record.mediaType === MediaType.Gif) {
        tmedia = {
          id: record.postId,
          url: record.mediaUrl,
          type: MediaType.Gif,
          videoInfo: { url: record.videoUrl },
        };
      } else {
        tmedia = {
          id: record.postId,
          url: record.mediaUrl,
          type: MediaType.Video,
          videoInfo: {
            duration: 0,
            variants: record.videoUrl
              ? [
                  {
                    url: record.videoUrl,
                    contentType: 'video/mp4',
                    bitrate: 1000000,
                  },
                ]
              : [],
          },
        };
      }
      const src = (record.platform || 'twitter') as PlatformSource;
      // pixiv 图片已是图本身，直接用原 url 作下载直链（不走推特缩略图/原图转换）
      const media: PlatformMedia =
        src === 'pixiv'
          ? {
              id: record.postId,
              type: record.mediaType,
              url: record.mediaUrl,
              downloadUrl: record.mediaUrl,
            }
          : toPlatformMedia(tmedia);
      const post = {
        id: record.postId,
        creator: {
          id: '',
          name: record.displayName || '',
          username: record.username || '',
          avatar: group.avatar,
        },
        publishedAt: dayjs(record.tweetTime),
        text: group.fullText,
        medias: [media],
        postUrl: record.postUrl,
        source: src,
      };
      await useDownloadStore.getState().createDownloadTask({
        source: src,
        post,
        media,
      });
      message.success('已添加到下载队列');
    } catch (err: any) {
      message.error(err?.message || '添加下载失败');
    }
  };

  const isNote = group.kind === 'note';
  // 可跳转 app 内正文的页：记事用它自己的页；已下载的 fig-memo/moeyo 条目也支持
  const articlePage = isNote
    ? group.articlePage
    : first?.platform === 'figmemo'
      ? 'figmemo'
      : first?.platform === 'moeyo'
        ? 'moeyo'
        : undefined;

  return (
    <li
      id={`tl-${group.kind || 'download'}-${group.postId}`}
      className="bg-white rounded-md border-[1px] p-4"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-start gap-2 min-w-0">
          <Avatar src={avatarSrc} size={36} className="shrink-0">
            {avatarName.slice(0, 1)}
          </Avatar>
          <div className="min-w-0">
            {isRetweet ? (
              <span className="font-medium">
                <button
                  type="button"
                  className="text-ant-color-link hover:underline"
                  onClick={() => group.username && openAuthor(group.username)}
                  title="在 app 内查看该作者"
                >
                  {group.displayName || group.username}
                </button>
                <span className="text-gray-400 text-sm ml-2">
                  @{group.username}
                </span>
                <span className="text-gray-400 text-sm ml-2">
                  转推自 @{group.retweetedBy}
                  {group.retweetedByCount && group.retweetedByCount > 1
                    ? ` 等 ${group.retweetedByCount} 人`
                    : ''}
                </span>
                <span
                  className="ml-2 rounded border px-1.5 py-0.5 text-xs"
                  style={tagChipStyle('转贴')}
                >
                  转贴
                </span>
              </span>
            ) : isNote ? (
              <span className="font-medium">{group.sourceLabel || '记事'}</span>
            ) : first?.displayName || first?.username ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="font-medium"
              >
                {first?.displayName || first?.username}
              </a>
            ) : (
              <span className="font-medium">未知用户</span>
            )}
            {!isNote && !isRetweet && (
              <span className="text-gray-400 text-sm ml-2">
                @{first?.username}
              </span>
            )}
            {/* 记事：站点分类色标 */}
            {isNote && group.categories && group.categories.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {group.categories.map((c) => (
                  <span
                    key={c}
                    className="rounded border px-1.5 py-0.5 text-xs"
                    style={tagChipStyle(c)}
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
            {/* X / Pawchive / pixiv：本地库标签（最多最靠前 3 个） */}
            {!isNote && group.libraryTags && group.libraryTags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {group.libraryTags.slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="rounded border px-1.5 py-0.5 text-xs"
                    style={tagChipStyle(t)}
                  >
                    {t}
                  </span>
                ))}
                {group.libraryTags.length > 3 && (
                  <span className="text-xs text-gray-400">
                    +{group.libraryTags.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <span className="text-sm text-gray-400 shrink-0">
          {dayjs(group.tweetTime).format('MM-DD HH:mm')}
        </span>
      </div>

      {text && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap mb-3 break-words">
          {shownText}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {records.slice(0, maxImages).map((record, idx) => {
          const key = `${record.postId}-${idx}`;
          // 本地文件被删（existsLocal=false）时按“未下载”处理，走远程兜底
          const localPath =
            record.existsLocal === false
              ? undefined
              : record.filePath || undefined;
          const rawThumb = getMediaThumbUrl(record);
          const rawOriginal = getMediaOriginalUrl(record);
          // pixiv（i.pximg.net）/ hpoi（rfx.hpoi.net）图片有防盗链，经代理时需带 Referer
          const mediaReferer =
            record.platform === 'pixiv'
              ? 'https://www.pixiv.net/'
              : /hpoi\.net/.test(rawThumb || rawOriginal || '')
                ? 'https://www.hpoi.net/'
                : undefined;
          // 远程图（pbs 等被墙）也经本地代理取，本地文件删了仍能显示
          const toRemote = (u?: string) =>
            u && /^https?:/i.test(u) ? mediaProxyUrl(u, mediaReferer) : u;
          const thumbUrl = toRemote(rawThumb);
          const originalUrl = toRemote(rawOriginal);
          // 只有视频走视频播放器；GIF 单独处理（要动、但不要播放器 UI）
          const isVideo = record.mediaType === MediaType.Video;
          const isGif = record.mediaType === MediaType.Gif;

          const gifCtx: ImageMenuCtx = {
            localPath,
            remoteUrl: originalUrl,
            postUrl: record.postUrl,
            author: record.username ? `@${record.username}` : undefined,
            headers: mediaReferer ? { Referer: mediaReferer } : undefined,
          };

          // GIF：本地 .gif 直接 <img>（会动）；本地 mp4 / 远程用无控件的自动循环视频（像 gif）
          if (isGif) {
            const localIsGif = !!localPath && /\.gif$/i.test(localPath);
            const remoteAnimSrc = record.videoUrl
              ? mediaProxyUrl(record.videoUrl, mediaReferer)
              : undefined;
            const animSrc = localIsGif
              ? toAssetUrl(localPath!)
              : localPath
                ? toAssetUrl(localPath)
                : remoteAnimSrc;
            return (
              <Dropdown
                key={key}
                trigger={['contextMenu']}
                menu={{
                  items: [
                    ...imageMenuItems(gifCtx),
                    ...(!localPath && record.mediaUrl
                      ? [
                          {
                            key: 'saveLocal',
                            label: '保存到本地',
                            icon: <DownloadOutlined />,
                          },
                        ]
                      : []),
                  ],
                  onClick: async ({ key: k, domEvent }) => {
                    domEvent.stopPropagation();
                    if (await handleImageMenuKey(k, gifCtx, message)) return;
                    if (k === 'saveLocal') await saveMedia(record);
                  },
                }}
              >
                <div
                  className="relative w-40 h-40 rounded-md overflow-hidden border-[1px] border-gray-100 bg-black group cursor-pointer"
                  title={localIsGif ? '查看 GIF' : '播放 GIF'}
                  onClick={async () => {
                    if (localIsGif) return; // 本地 .gif 交给 antd 图片预览
                    setVideoError(false);
                    if (localPath) {
                      setVideo({ local: toAssetUrl(localPath) });
                      return;
                    }
                    if (record.videoUrl) {
                      setVideo({
                        remote: record.videoUrl,
                        postUrl: record.postUrl,
                      });
                      return;
                    }
                    // 本地已删且历史无直链：按推文 ID 反查媒体直链
                    if (record.username && record.postId) {
                      message.loading({
                        content: '查找视频直链…',
                        key: 'resolve-media',
                        duration: 0,
                      });
                      const url = await resolveTweetMediaUrl(
                        record.username,
                        record.postId,
                      );
                      message.destroy('resolve-media');
                      if (url) {
                        setVideo({ remote: url, postUrl: record.postUrl });
                        return;
                      }
                    }
                    if (record.postUrl) openUrl(record.postUrl);
                  }}
                >
                  {thumbUrl && (
                    <img
                      src={thumbUrl}
                      alt={record.fileName}
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                  {animSrc &&
                    (localIsGif ? (
                      <Image
                        src={animSrc}
                        alt={record.fileName}
                        width={160}
                        height={160}
                        className="relative w-full h-full object-cover"
                        preview={{ src: animSrc }}
                      />
                    ) : (
                      <video
                        src={animSrc}
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="relative w-full h-full object-cover"
                        onError={(e) => {
                          const v = e.currentTarget as HTMLVideoElement;
                          // 本地文件缺失/直连失败 → 回退到经代理的远程直链，再不行就藏起来露封面
                          if (
                            remoteAnimSrc &&
                            !v.dataset.fellBack &&
                            v.src !== remoteAnimSrc
                          ) {
                            v.dataset.fellBack = '1';
                            v.src = remoteAnimSrc;
                          } else {
                            v.style.display = 'none';
                          }
                        }}
                      />
                    ))}
                  <span className="absolute right-1 bottom-1 text-xs text-white bg-black/60 rounded px-1">
                    GIF
                  </span>
                </div>
              </Dropdown>
            );
          }

          // 视频：封面走 CDN 预览图；本地有文件则点击弹窗播放，否则打开原推
          if (isVideo) {
            const videoMenu: MenuProps = {
              items: [
                ...(localPath
                  ? [
                      {
                        key: 'reveal',
                        label: '在资源管理器中打开',
                        icon: <FolderOpenOutlined />,
                      },
                      { key: 'open', label: '打开', icon: <FileOutlined /> },
                    ]
                  : []),
                ...(!localPath && record.mediaUrl
                  ? [
                      {
                        key: 'download',
                        label: '保存到本地',
                        icon: <DownloadOutlined />,
                      },
                    ]
                  : []),
                ...(record.postUrl
                  ? [
                      {
                        key: 'openPost',
                        label: '打开原网页',
                        icon: <LinkOutlined />,
                      },
                      {
                        key: 'copyPost',
                        label: '复制原网页',
                        icon: <CopyOutlined />,
                      },
                    ]
                  : []),
              ],
              onClick: async ({ key: k, domEvent }) => {
                domEvent.stopPropagation();
                if (k === 'reveal' && localPath) {
                  try {
                    await showInFolder(localPath, true);
                  } catch (err: any) {
                    message.error(err?.message || '打开资源管理器失败');
                  }
                } else if (k === 'open' && localPath) {
                  try {
                    await openPath(localPath);
                  } catch (err: any) {
                    message.error(err?.message || '打开文件失败');
                  }
                } else if (k === 'download') {
                  await saveMedia(record);
                } else if (k === 'openPost' && record.postUrl) {
                  openUrl(record.postUrl);
                } else if (k === 'copyPost' && record.postUrl) {
                  await copyTextToClipboard(record.postUrl);
                  message.success('原网页链接已复制');
                }
              },
            };
            return (
              <Dropdown key={key} trigger={['contextMenu']} menu={videoMenu}>
                <div
                  className="relative w-40 h-40 rounded-md overflow-hidden border-[1px] border-gray-100 bg-black group cursor-pointer"
                  title={localPath || record.videoUrl ? '播放视频' : '打开原推'}
                  onClick={async () => {
                    setVideoError(false);
                    if (localPath) {
                      setVideo({ local: toAssetUrl(localPath) });
                      return;
                    }
                    if (record.videoUrl) {
                      setVideo({
                        remote: record.videoUrl,
                        postUrl: record.postUrl,
                      });
                      return;
                    }
                    if (record.username && record.postId) {
                      message.loading({
                        content: '查找视频直链…',
                        key: 'resolve-media',
                        duration: 0,
                      });
                      const url = await resolveTweetMediaUrl(
                        record.username,
                        record.postId,
                      );
                      message.destroy('resolve-media');
                      if (url) {
                        setVideo({ remote: url, postUrl: record.postUrl });
                        return;
                      }
                    }
                    if (record.postUrl) openUrl(record.postUrl);
                  }}
                >
                  {/* 时间流视频一律用**在线封面**（不本地取帧，避免卡顿） */}
                  {thumbUrl ? (
                    <img
                      src={thumbUrl}
                      alt={record.fileName}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gray-100" />
                  )}
                  <PlayCircleFilled className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl text-white/90 group-hover:scale-110 transition-transform" />
                  <span className="absolute right-1 bottom-1 text-xs text-white bg-black/60 rounded px-1">
                    {MEDIA_TYPE_LABEL[record.mediaType] || '视频'}
                  </span>
                </div>
              </Dropdown>
            );
          }

          // 图片：本地优先用本地缩略图（缓存秒开 + 本地预览），不联网
          if (localPath) {
            return (
              <Dropdown
                key={key}
                trigger={['contextMenu']}
                menu={menuFor({
                  localPath,
                  postUrl: record.postUrl,
                  author: record.username ? `@${record.username}` : undefined,
                })}
              >
                <div className="inline-block">
                  <LocalThumb
                    filePath={localPath}
                    alt={record.fileName}
                    className="object-cover w-full h-full rounded-md"
                    wrapperClassName="w-40 h-40"
                    preview
                  />
                </div>
              </Dropdown>
            );
          }
          if (!thumbUrl) return null;
          const remoteCtx: ImageMenuCtx = {
            remoteUrl: originalUrl,
            postUrl: record.postUrl,
            author: record.username ? `@${record.username}` : undefined,
            headers: mediaReferer ? { Referer: mediaReferer } : undefined,
          };
          return (
            <Dropdown
              key={key}
              trigger={['contextMenu']}
              menu={{
                items: [
                  ...imageMenuItems(remoteCtx),
                  ...(record.mediaUrl
                    ? [
                        {
                          key: 'download',
                          label: '保存到本地',
                          icon: <DownloadOutlined />,
                        },
                      ]
                    : []),
                ],
                onClick: async ({ key: k, domEvent }) => {
                  domEvent.stopPropagation();
                  if (await handleImageMenuKey(k, remoteCtx, message)) return;
                  if (k === 'download') await saveMedia(record);
                },
              }}
            >
              <div className="inline-block">
                <Image
                  src={thumbUrl}
                  alt={record.fileName}
                  className="object-cover rounded-md"
                  width={160}
                  height={160}
                  preview={{
                    mask: MEDIA_TYPE_LABEL[record.mediaType] || '查看',
                    src: originalUrl,
                  }}
                />
              </div>
            </Dropdown>
          );
        })}
      </div>

      {(textClipped ||
        records.length > maxImages ||
        articlePage ||
        isRetweet) && (
        <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
          {textClipped && <span>正文已折叠</span>}
          {records.length > maxImages && (
            <span>还有 {records.length - maxImages} 张图</span>
          )}
          {articlePage && (
            <Button
              size="small"
              onClick={() => openArticle(articlePage, group.postId)}
            >
              查看正文
            </Button>
          )}
          {isRetweet && group.username && (
            <Space.Compact>
              <Button
                size="small"
                type="primary"
                loading={subscribing}
                onClick={() => subscribeAuthor()}
              >
                {subscribed ? '更新订阅' : '订阅原作者'}
              </Button>
              <Popover
                trigger="click"
                open={subOpen}
                onOpenChange={setSubOpen}
                placement="bottomRight"
                content={
                  <div className="w-60 space-y-3">
                    <div>
                      <div className="mb-1 text-sm font-medium">刷新时间</div>
                      <Select
                        size="small"
                        className="w-full"
                        value={subInterval}
                        onChange={setSubInterval}
                        options={INTERVAL_OPTIONS}
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-sm font-medium">媒体类型</div>
                      <Checkbox.Group
                        value={[...subMedia]}
                        onChange={(v) => setSubMedia(new Set(v as string[]))}
                        options={[
                          { label: '照片', value: 'photo' },
                          { label: '视频', value: 'video' },
                          { label: 'GIF', value: 'gif' },
                        ]}
                      />
                      <Checkbox
                        className="mt-1 block"
                        checked={subRetweet}
                        onChange={(e) => setSubRetweet(e.target.checked)}
                      >
                        转推（只进时间流）
                      </Checkbox>
                    </div>
                    <Button
                      type="primary"
                      block
                      loading={subscribing}
                      onClick={() => {
                        setSubOpen(false);
                        void subscribeAuthor(
                          subRetweet ? 'include' : 'off',
                          subInterval,
                          [...subMedia] as MediaType[],
                        );
                      }}
                    >
                      按以上条件订阅
                    </Button>
                  </div>
                }
              >
                <Button size="small" type="primary" icon={<DownOutlined />} />
              </Popover>
            </Space.Compact>
          )}
        </div>
      )}

      <Modal
        open={!!video}
        footer={null}
        width="92%"
        centered
        destroyOnClose
        wrapClassName="library-video-wrap"
        styles={{ body: { padding: 0, background: '#0f1114' } }}
        onCancel={() => setVideo(null)}
      >
        {video && !video.local && remoteVideo.loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-gray-300">
            <Spin size="large" />
            <span className="text-sm">正在经代理加载视频…</span>
          </div>
        )}
        {video && (remoteVideo.failed || videoError) && !video.local && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-gray-300">
            <span className="text-sm">视频加载失败（代理或网络问题）</span>
            {video.postUrl && (
              <Button size="small" onClick={() => openUrl(video.postUrl!)}>
                在原推打开
              </Button>
            )}
          </div>
        )}
        {(video?.local || remoteVideo.src) && !videoError && (
          <video
            src={video?.local || remoteVideo.src}
            onError={() => setVideoError(true)}
            controls
            autoPlay
            className="w-full max-h-[80vh] bg-black"
          />
        )}
      </Modal>
    </li>
  );
};
