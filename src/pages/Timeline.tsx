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
  DownloadOutlined,
  FileOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlayCircleFilled,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { LocalThumb } from '../components/library/LocalThumb';
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
} from '../services/figmemo';
import {
  getRecentSiteNotes as getMoeyoNotes,
  getSiteCategoryMap as getMoeyoCategoryMap,
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

const PAGE_SIZE = 25;
const LOAD_MORE_STEP = 5;
const RANGE_DAYS = 7;

const MEDIA_TYPE_LABEL: Record<string, string> = {
  photo: '图片',
  video: '视频',
  animated_gif: 'GIF',
};

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
  return {
    postId: n.postId,
    tweetTime: n.date,
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
            tweetTime: n.date,
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
    })();
    return () => {
      alive = false;
    };
  }, [build]);

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
      message.success('已更新');
    } finally {
      setRefreshing(false);
    }
  }, [build, visibleCount, message]);

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
  const getScroller = () =>
    (rootRef.current?.closest('main') as HTMLElement | null) || null;
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

      {/* 右下角圆形按钮：刷新 / 回到顶部 */}
      <div className="fixed right-6 bottom-6 z-50 flex flex-col gap-3">
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

const TimelineItem: React.FC<{
  group: TimelineGroup;
  maxTextLen: number;
  maxImages: number;
}> = ({ group, maxTextLen, maxImages }) => {
  const { message } = App.useApp();
  const openArticle = useRouteStore((s) => s.openArticle);
  const first = group.records[0];
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
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
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

  const subscribeAuthor = async () => {
    if (!group.username || subscribed) return;
    setSubscribing(true);
    try {
      await useSubscriptionStore.getState().addSubscription({
        source: 'twitter',
        username: group.username,
        intervalMin: 720,
        mediaTypes: [MediaType.Photo, MediaType.Video, MediaType.Gif],
      });
      message.success(`已订阅 @${group.username}，之后其原创媒体会自动下载`);
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
    <li className="bg-white rounded-md border-[1px] p-4">
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
        {group.records.slice(0, maxImages).map((record, idx) => {
          const key = `${record.postId}-${idx}`;
          const localPath = record.filePath || undefined;
          const thumbUrl = getMediaThumbUrl(record);
          const originalUrl = getMediaOriginalUrl(record);
          const isVideo =
            record.mediaType === MediaType.Video ||
            record.mediaType === MediaType.Gif;

          // 视频/GIF：封面走 CDN 预览图；本地有文件则点击弹窗播放，否则打开原推
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
                  onClick={() => {
                    if (localPath) setVideoSrc(toAssetUrl(localPath));
                    else if (record.videoUrl) setVideoSrc(record.videoUrl);
                    else if (record.postUrl) openUrl(record.postUrl);
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
                menu={menuFor({ localPath, postUrl: record.postUrl })}
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
        group.records.length > maxImages ||
        articlePage ||
        isRetweet) && (
        <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
          {textClipped && <span>正文已折叠</span>}
          {group.records.length > maxImages && (
            <span>还有 {group.records.length - maxImages} 张图</span>
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
            <Button
              size="small"
              type="primary"
              ghost
              disabled={subscribed}
              loading={subscribing}
              onClick={subscribeAuthor}
            >
              {subscribed ? '已订阅原作者' : '订阅原作者'}
            </Button>
          )}
        </div>
      )}

      <Modal
        open={!!videoSrc}
        footer={null}
        width="92%"
        centered
        destroyOnClose
        wrapClassName="library-video-wrap"
        styles={{ body: { padding: 0, background: '#0f1114' } }}
        onCancel={() => setVideoSrc(null)}
      >
        {videoSrc && (
          <video
            src={videoSrc}
            controls
            autoPlay
            className="w-full max-h-[80vh] bg-black"
          />
        )}
      </Modal>
    </li>
  );
};
