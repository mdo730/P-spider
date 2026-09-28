/* eslint-disable react/prop-types */
import {
  App,
  Avatar,
  Button,
  Dropdown,
  Empty,
  Image,
  MenuProps,
  Modal,
  Spin,
  Tag,
} from 'antd';
import {
  ArrowUpOutlined,
  CalendarOutlined,
  DownOutlined,
  DownloadOutlined,
  FileOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlayCircleFilled,
  ReloadOutlined,
} from '@ant-design/icons';
import { RetweetMode } from '../interfaces/Subscription';
import { RETWEET_MODE_OPTIONS } from '../constants/subscription';
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
import { resolveTweetMediaUrl } from '../services/tweet-media';
import {
  DownloadHistoryRecord,
  getMediaOriginalUrl,
  getMediaThumbUrl,
  getTimelineGroups,
  TimelineGroup,
} from '../stores/download-history';
import { useDownloadStore } from '../stores/download';
import { toPlatformMedia } from '../platforms/twitter';
import { TwitterMedia } from '../interfaces/TwitterMedia';
import {
  handleImageMenuKey,
  imageMenuItems,
  ImageMenuCtx,
} from '../utils/image-menu';
import { buildUserUrl } from '../twitter/url';
import {
  getRecentSiteNotes,
  getSiteCategoryMap as getFigmemoCategoryMap,
  refreshSitePosts as refreshFigmemoSites,
} from '../services/figmemo';
import {
  getRecentSiteNotes as getMoeyoNotes,
  getSiteCategoryMap as getMoeyoCategoryMap,
  refreshSitePosts as refreshMoeyoSites,
} from '../services/moeyo';
import { getRecentRetweetNotes, RetweetNote } from '../services/retweets';
import { useFigmemoStore } from '../stores/figmemo';
import { useMoeyoStore } from '../stores/moeyo';
import { useSettingsStore } from '../stores/settings';
import { useRouteStore } from '../stores/route';
import figmemoIcon from '../assets/platform-icons/figmemo.png';
import moeyoIcon from '../assets/platform-icons/moeyo.png';
import { toAssetUrl } from '../utils/asset';
import { openPath, openUrl, showInFolder } from '../utils/shell';
import { useHomepageStore } from '../stores/homepage';
import { useSubscriptionStore } from '../stores/subscription';
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

/** 把站点「新记事」（未下载文章）转成时间流分组 */
function noteGroup(
  page: 'figmemo' | 'moeyo',
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
            platform: page,
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

  const build = useCallback(async (): Promise<TimelineGroup[]> => {
    const days = Math.min(
      30,
      Math.max(
        1,
        useSettingsStore.getState().timeline?.rangeDays ?? RANGE_DAYS,
      ),
    );
    const downloads = await getTimelineGroups(days);
    const downloaded = new Set(downloads.map((g) => g.postId));
    // 给已下载的 fig-memo / moeyo 条目补上分类标注
    try {
      const fmMap = useFigmemoStore.getState().featureEnabled
        ? await getFigmemoCategoryMap()
        : null;
      const moMap = useMoeyoStore.getState().featureEnabled
        ? await getMoeyoCategoryMap()
        : null;
      for (const g of downloads) {
        if (g.categories?.length) continue;
        const pf = g.records[0]?.platform;
        if (pf === 'figmemo' && fmMap) g.categories = fmMap.get(g.postId);
        else if (pf === 'moeyo' && moMap) g.categories = moMap.get(g.postId);
      }
    } catch {
      // 忽略
    }
    const notes: TimelineGroup[] = [];
    if (useFigmemoStore.getState().featureEnabled) {
      try {
        for (const n of await getRecentSiteNotes(days)) {
          if (!downloaded.has(n.postId))
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
          if (!downloaded.has(n.postId))
            notes.push(noteGroup('moeyo', 'moeyo', n));
        }
      } catch {
        // 忽略
      }
    }
    const retweets: TimelineGroup[] = [];
    try {
      for (const n of await getRecentRetweetNotes(days)) {
        // 与已下载条目按原创推文 id 去重（原作者本就订阅时会被这里滤掉）
        if (!downloaded.has(n.id)) retweets.push(retweetGroup(n));
      }
    } catch {
      // 忽略
    }
    return [...downloads, ...notes, ...retweets].sort((a, b) =>
      b.tweetTime > a.tweetTime ? 1 : -1,
    );
  }, []);

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
      // 先触发订阅检查（含转贴更新），再重新聚合时间流
      const subs = useSubscriptionStore.getState();
      if (subs.subscriptions.length > 0) {
        await subs.checkAll().catch(() => {
          // 单个订阅失败不阻断整体刷新
        });
      }
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

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    // 模拟异步，避免快速连续触发
    setTimeout(() => {
      setVisibleCount((prev) => {
        const next = Math.min(prev + LOAD_MORE_STEP, groups.length);
        visibleCountCache = next;
        return next;
      });
      setLoadingMore(false);
    }, 200);
  }, [groups.length]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && visibleCount < groups.length) {
        loadMore();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [groups.length, visibleCount, loadMore]);

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

  const visibleGroups = groups.slice(0, visibleCount);

  // 拖日期刻度条 → 定位到该日期（必要时先展开渲染到该条，再滚动到它）
  const jumpToDate = useCallback(
    (ms: number) => {
      if (groups.length === 0) return;
      let idx = groups.findIndex((g) => new Date(g.tweetTime).getTime() <= ms);
      if (idx < 0) idx = groups.length - 1;
      const need = idx + 1;
      if (need > visibleCount) {
        visibleCountCache = need;
        setVisibleCount(need);
      }
      requestAnimationFrame(() => {
        const g = groups[idx];
        const el = document.getElementById(
          `tl-${g.kind || 'download'}-${g.postId}`,
        );
        el?.scrollIntoView({ block: 'start' });
      });
    },
    [groups, visibleCount],
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
            description={`近 ${rangeDays} 天还没有内容，订阅自动下载 / 新记事会显示在这里`}
          />
        ) : (
          <>
            <p className="text-sm text-gray-400">
              近 {rangeDays} 天共 {groups.length} 条（含下载与未下载新记事）
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
            {visibleCount >= groups.length && (
              <p className="text-center text-gray-400 text-sm py-4">
                已加载全部 {groups.length} 条
              </p>
            )}
          </>
        )}
      </section>

      {/* 右下角圆形按钮：日期定位 / 刷新 / 回到顶部 */}
      <div className="fixed right-6 bottom-6 z-50 flex flex-col items-end gap-3">
        <TimelineDateScrubber
          groups={groups}
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
          title="回到顶部"
          onClick={scrollToTop}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-600 shadow-lg ring-1 ring-black/5 transition-all duration-200 hover:scale-110 hover:text-ant-color-primary active:scale-95"
        >
          <ArrowUpOutlined className="text-lg" />
        </button>
      </div>
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
        : undefined;
  const avatarSrc =
    group.avatar || (group.kind === 'note' ? platformIcon : first?.avatar);
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

  const subscribeAuthor = async (retweetMode: RetweetMode = 'off') => {
    if (!group.username) return;
    setSubscribing(true);
    try {
      const result = await useSubscriptionStore.getState().addSubscription({
        source: 'twitter',
        username: group.username,
        intervalMin: 720,
        mediaTypes: [MediaType.Photo, MediaType.Video, MediaType.Gif],
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
      const media = toPlatformMedia(tmedia);
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
        source: 'twitter' as const,
      };
      await useDownloadStore.getState().createDownloadTask({
        source: 'twitter',
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
            {isNote && group.categories && group.categories.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {group.categories.map((c) => (
                  <Tag key={c} className="!mr-0">
                    {c}
                  </Tag>
                ))}
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
          // 远程图（pbs 等被墙）也经本地代理取，本地文件删了仍能显示
          const toRemote = (u?: string) =>
            u && /^https?:/i.test(u) ? mediaProxyUrl(u) : u;
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
          };

          // GIF：本地 .gif 直接 <img>（会动）；本地 mp4 / 远程用无控件的自动循环视频（像 gif）
          if (isGif) {
            const localIsGif = !!localPath && /\.gif$/i.test(localPath);
            const remoteAnimSrc = record.videoUrl
              ? mediaProxyUrl(record.videoUrl)
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
                  {localPath ? (
                    <LocalThumb
                      kind="video"
                      filePath={localPath}
                      alt={record.fileName}
                      wrapperClassName="w-full h-full"
                      className="w-full h-full object-cover"
                    />
                  ) : thumbUrl ? (
                    <img
                      src={thumbUrl}
                      alt={record.fileName}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : null}
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
            <Dropdown
              menu={{
                items: RETWEET_MODE_OPTIONS.map((o) => ({
                  key: o.value,
                  label: o.label,
                })),
                onClick: ({ key }) => subscribeAuthor(key as RetweetMode),
              }}
            >
              <Button size="small" type="primary" ghost loading={subscribing}>
                {subscribed ? '更新订阅' : '订阅原作者'} <DownOutlined />
              </Button>
            </Dropdown>
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
