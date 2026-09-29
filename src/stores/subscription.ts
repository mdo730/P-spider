import { nanoid } from 'nanoid';
import * as R from 'ramda';
import dayjs from 'dayjs';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import MediaType from '../enums/MediaType';
import { RetweetMode, Subscription } from '../interfaces/Subscription';
import { TwitterPost } from '../interfaces/TwitterPost';
import { TwitterUser } from '../interfaces/TwitterUser';
import {
  TwitterRetweet,
  getUser,
  getUserMedias,
  getUserRetweets,
} from '../twitter/api';
import { buildPostUrl } from '../twitter/url';
import {
  RetweetNote,
  bestVideoUrl,
  upsertRetweetNotes,
} from '../services/retweets';
import { aria2 } from '../utils/aria2';
import {
  getAdapter,
  PlatformPost,
  PlatformSource,
  withCreator,
} from '../platforms';
import { toPlatformMedia, toPlatformPost } from '../platforms/twitter';
import { useAppStateStore } from './app-state';
import {
  CreateDownloadTaskParams,
  onTaskCompleted,
  prepareArchiverPostDir,
  useDownloadStore,
} from './download';
import { createTauriFileStorage } from './persist/tauri-file-storage';
import { mapLimit } from '../utils/library';
import { delay } from '../utils';
import { isSpectatorOn } from '../utils/spectator';
import {
  FeedSource,
  platformPostToFeedItem,
  writeFeedItems,
} from '../services/feed';
import {
  fetchPixivUser,
  fetchPixivWorks,
  PixivUser,
  PixivWork,
} from '../services/pixiv';
import { downloadPixivWork } from '../services/pixiv-download';

/**
 * 各站点独立限流参数：X / pawchive / pixiv 是**不同站点**，可并行检测、互不占用并发槽
 * （原先所有订阅共用一个队列，几条慢的 pawchive 会堵住全部 X）。
 */
const SOURCE_THROTTLE: Record<string, { limit: number; gapMs: number }> = {
  // X：并发 4（过高会被 403），间隔 200ms
  twitter: { limit: 4, gapMs: 200 },
  // 归档站直连：并发 2、间隔 600ms
  pawchive: { limit: 2, gapMs: 600 },
  // pixiv：并发 2、间隔 1000ms（官方限速较严）
  pixiv: { limit: 2, gapMs: 1000 },
};
const DEFAULT_THROTTLE = { limit: 2, gapMs: 400 };
/** 订阅出错后的重试间隔（ms）：比正常间隔短，但远大于调度 tick，避免每秒死循环 */
const ERROR_RETRY_MS = 5 * 60 * 1000;
/** 全局闸门：避免定时调度与手动「一键刷新」叠加成双倍并发 */
let checking = false;

async function checkSubscriptionsThrottled(
  subs: Subscription[],
): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    // 按平台分组，各站点并行、各自限流
    const groups = new Map<string, Subscription[]>();
    for (const s of subs) {
      const key = s.source || 'twitter';
      const arr = groups.get(key);
      if (arr) arr.push(s);
      else groups.set(key, [s]);
    }
    await Promise.all(
      [...groups.entries()].map(([source, list]) => {
        const cfg = SOURCE_THROTTLE[source] ?? DEFAULT_THROTTLE;
        return mapLimit(list, cfg.limit, async (sub) => {
          try {
            await checkSubscription(sub);
          } catch (err) {
            log().error('Subscription check failed', {
              id: sub.id,
              source,
              err,
            });
          }
          await delay(cfg.gapMs);
        });
      }),
    );
  } finally {
    checking = false;
  }
}

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('SUB');
  return _log;
}

export interface CreateSubscriptionParams {
  username: string;
  intervalMin: number;
  mediaTypes: MediaType[];
  /** 转贴模式（off / include / only；默认 off） */
  retweetMode?: RetweetMode;
  /** @deprecated 用 retweetMode 代替（兼容旧调用） */
  includeRetweets?: boolean;
  /** 平台源，默认 twitter（阶段3 UI 支持多平台后由表单选择） */
  source?: PlatformSource;
}

/** 取订阅的转贴模式（兼容旧字段 includeRetweets） */
export function retweetModeOf(
  s: Pick<Subscription, 'retweetMode' | 'includeRetweets'>,
): RetweetMode {
  return s.retweetMode ?? (s.includeRetweets === true ? 'include' : 'off');
}

export interface SubscriptionStore {
  subscriptions: Subscription[];
  /** 新增订阅；若同平台+同用户名已存在则改为**更新**其选项（返回 updated） */
  addSubscription: (
    params: CreateSubscriptionParams,
  ) => Promise<'created' | 'updated'>;
  removeSubscription: (id: string) => void;
  updateSubscription: (id: string, patch: Partial<Subscription>) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  checkNow: (id: string) => Promise<void>;
  checkAll: () => Promise<void>;
  exportSubscriptions: () => string;
  importSubscriptions: (json: string) => { added: number; skipped: number };
}

export const useSubscriptionStore = create(
  persist<SubscriptionStore>(
    (set, get) => ({
      subscriptions: [],
      addSubscription: async ({
        username,
        intervalMin,
        mediaTypes,
        retweetMode,
        includeRetweets,
        source,
      }) => {
        const src = source || 'twitter';
        const mode: RetweetMode =
          retweetMode ?? (includeRetweets === true ? 'include' : 'off');

        // 去重：同平台 + 同用户名已存在 → 更新其选项，不再新增一条
        const existing = get().subscriptions.find(
          (s) =>
            (s.source || 'twitter') === src &&
            s.username.toLowerCase() === username.trim().toLowerCase(),
        );
        if (existing) {
          get().updateSubscription(existing.id, {
            intervalMin,
            mediaTypes,
            retweetMode: mode,
          });
          log().info('Subscription updated (dedup)', {
            id: existing.id,
            username,
          });
          return 'updated';
        }

        const id = nanoid();
        const sub: Subscription = {
          id,
          source: src,
          username,
          intervalMin,
          mediaTypes,
          retweetMode: mode,
          enabled: true,
          downloadedCount: 0,
          dailyStats: {},
          status: 'idle',
        };
        set({
          subscriptions: R.append(sub, get().subscriptions),
        });
        log().info('Subscription added', sub);
        // 立即返回，首次基线检查放到后台异步执行，不阻塞 UI
        setTimeout(() => {
          checkSubscription(sub).catch((err) => {
            log().error('Initial subscription check failed', { id, err });
          });
        }, 0);
        return 'created';
      },
      removeSubscription: (id) => {
        set({
          subscriptions: R.filter((s: Subscription) => s.id !== id)(
            get().subscriptions,
          ),
        });
      },
      updateSubscription: (id, patch) => {
        set({
          subscriptions: R.map((s: Subscription) =>
            s.id === id ? { ...s, ...patch } : s,
          )(get().subscriptions),
        });
      },
      setEnabled: (id, enabled) => {
        get().updateSubscription(id, { enabled });
      },
      checkNow: async (id) => {
        const sub = R.find((s: Subscription) => s.id === id)(
          get().subscriptions,
        );
        if (!sub) return;
        await checkSubscription(sub);
      },
      checkAll: async () => {
        const subs = get().subscriptions;
        // 一键刷新：限流检查所有订阅（含卡在 running 的），
        // 避免因请求挂起卡住的订阅被永久跳过而无法恢复
        await checkSubscriptionsThrottled(subs);
      },
      exportSubscriptions: () => {
        const subs = get().subscriptions;
        const data = {
          version: 1,
          subscriptions: subs.map((s) => ({
            source: s.source,
            username: s.username,
            intervalMin: s.intervalMin,
            mediaTypes: s.mediaTypes,
            retweetMode: retweetModeOf(s),
            // 兼容旧版导入器
            includeRetweets: retweetModeOf(s) === 'include',
            enabled: s.enabled,
          })),
        };
        return JSON.stringify(data, undefined, 2);
      },
      importSubscriptions: (json: string) => {
        let parsed: {
          version?: number;
          subscriptions?: {
            // 外部 JSON 的 source 可能是旧值（如 'kemono'），导入时归并
            source?: string;
            username: string;
            intervalMin?: number;
            mediaTypes?: MediaType[];
            retweetMode?: RetweetMode;
            includeRetweets?: boolean;
            enabled?: boolean;
          }[];
        };
        try {
          parsed = JSON.parse(json);
        } catch (err) {
          log().error('Import subscriptions parse failed', err);
          throw new Error('导入文件格式不正确，不是有效的 JSON');
        }

        const list = parsed?.subscriptions;
        if (!Array.isArray(list)) {
          throw new Error('导入文件格式不正确，缺少 subscriptions 字段');
        }

        const existing = new Set(
          get().subscriptions.map(
            (s) => `${s.source || 'twitter'}:${s.username.toLowerCase()}`,
          ),
        );

        let added = 0;
        let skipped = 0;
        const newSubs: Subscription[] = [];

        for (const item of list) {
          if (!item?.username) {
            skipped++;
            continue;
          }
          const username = item.username.trim();
          const source: PlatformSource =
            item.source === 'pixiv'
              ? 'pixiv'
              : item.source === 'pawchive' || item.source === 'kemono'
                ? 'pawchive'
                : 'twitter';
          const key = `${source}:${username.toLowerCase()}`;
          if (!username || existing.has(key)) {
            skipped++;
            continue;
          }
          const sub: Subscription = {
            id: nanoid(),
            source,
            username,
            intervalMin: item.intervalMin || DEFAULT_INTERVAL_MIN,
            mediaTypes:
              Array.isArray(item.mediaTypes) && item.mediaTypes.length > 0
                ? item.mediaTypes
                : [MediaType.Photo, MediaType.Video, MediaType.Gif],
            retweetMode:
              item.retweetMode ??
              (item.includeRetweets === true ? 'include' : 'off'),
            enabled: item.enabled !== false,
            downloadedCount: 0,
            dailyStats: {},
            status: 'idle',
          };
          existing.add(key);
          newSubs.push(sub);
          added++;
        }

        if (newSubs.length > 0) {
          set({
            subscriptions: get().subscriptions.concat(newSubs),
          });
          // 新导入的订阅后台建立基线
          newSubs.forEach((sub) => {
            setTimeout(() => {
              checkSubscription(sub).catch((err) => {
                log().error('Imported subscription check failed', {
                  id: sub.id,
                  err,
                });
              });
            }, 0);
          });
        }

        return { added, skipped };
      },
    }),
    {
      name: 'subscriptions',
      version: 7,
      storage: createTauriFileStorage(),
      migrate(state: any) {
        state.subscriptions = (state.subscriptions || []).map((s: any) => {
          const dailyStats: Record<string, { count: number; bytes: number }> =
            {};
          const rawStats: Record<
            string,
            number | { count: number; bytes: number }
          > = s.dailyStats || {};
          for (const [date, value] of Object.entries(rawStats)) {
            if (typeof value === 'number') {
              dailyStats[date] = { count: value, bytes: 0 };
            } else {
              dailyStats[date] = value;
            }
          }
          return {
            ...s,
            // v4：旧订阅平台源统一补为 twitter；v5：kemono 订阅迁移为 pawchive（同 service/id 通用）
            // v6：includeRetweets 默认 false（转贴仅进时间流，不下载）
            // v7：includeRetweets 布尔 → retweetMode（true→include / false→off）
            source: s.source === 'kemono' ? 'pawchive' : s.source || 'twitter',
            retweetMode:
              s.retweetMode ?? (s.includeRetweets === true ? 'include' : 'off'),
            dailyStats,
            downloadedCount: s.downloadedCount || 0,
          };
        });
        return state;
      },
    },
  ),
);

/**
 * 执行一次订阅检查：按订阅平台分发到对应实现。
 * - twitter：原逻辑，走 twitter/api，新推文自动下载
 * - pawchive：走适配器（目录结构：saveDirBase/创作者名/帖子标题）
 */
export async function checkSubscription(
  sub: Subscription,
): Promise<{ downloaded: number }> {
  if (sub.source === 'twitter') {
    return checkTwitterSubscription(sub);
  }
  if (sub.source === 'pixiv') {
    return checkPixivSubscription(sub);
  }
  return checkArchiverSubscription(sub);
}

/**
 * X（twitter）订阅检查：
 * 1. 解析用户名拿到 userId
 * 2. 拉取最新一页媒体推文
 * 3. 与 lastTweetId 对比，筛出新增推文
 * 4. 新推文的媒体自动加入下载队列
 * 5. 更新 lastTweetId 与最后检查时间
 */
async function checkTwitterSubscription(
  sub: Subscription,
): Promise<{ downloaded: number }> {
  const { updateSubscription } = useSubscriptionStore.getState();

  const update = (patch: Partial<Subscription>) =>
    updateSubscription(sub.id, patch);

  // 检查 cookie 是否就绪
  if (!useAppStateStore.getState().cookieString) {
    update({ status: 'error', errorMessage: '未登录，请先配置 Cookie' });
    return { downloaded: 0 };
  }

  update({ status: 'running', errorMessage: undefined });

  try {
    const user = await getUser(sub.username);
    const { twitterPosts } = await getUserMedias(user.id, undefined, 20);

    // 时间流 v2：订阅刷新「顺带」把最新一页写进 feed 缓存（不新增轮询；下不下载都能看到）
    await writeFeedItems(
      (twitterPosts || []).map((p) =>
        platformPostToFeedItem(toPlatformPost(p), 'twitter'),
      ),
    );

    if (!twitterPosts || twitterPosts.length === 0) {
      update({
        status: 'idle',
        lastCheckedAt: Date.now(),
        displayName: user.name,
        avatar: user.avatar,
      });
      return { downloaded: 0 };
    }

    // 取第一条（最新）作为新基线
    const newestId = twitterPosts[0].id;

    // 是否有新推文：最新一条推文与上次基线不同即视为有新内容
    const isNew = newestId !== sub.lastTweetId;

    let downloaded = 0;
    const mode = retweetModeOf(sub);

    // 「仅转推」模式：不下载任何内容，只把转贴收进时间流
    // 超级旁观者：跳过自动下载（仍更新基线，时间流照常）
    if (isNew && sub.lastTweetId && mode !== 'only' && !isSpectatorOn()) {
      // 有基线，且最新推文不在本次列表里（即出现了新推文）
      const newPosts = R.takeWhile(
        (p: TwitterPost) => p.id !== sub.lastTweetId,
        twitterPosts,
      );

      const { batchCreateDownloadTask } = useDownloadStore.getState();

      const paramsList: CreateDownloadTaskParams[] = [];
      for (const post of newPosts) {
        const medias = (post.medias || []).filter((m) =>
          sub.mediaTypes.includes(m.type),
        );
        for (const media of medias) {
          paramsList.push({
            source: 'twitter',
            post: toPlatformPost(post),
            media: toPlatformMedia(media),
            subscriptionId: sub.id,
          });
        }
      }

      if (paramsList.length > 0) {
        // aria2 未就绪时跳过下载（保留基线，避免下次重复抓取），稍后自动重试
        if (!aria2.ready) {
          log().warn('Aria2 is not ready, skip downloading for subscription', {
            id: sub.id,
            count: paramsList.length,
          });
        } else {
          await batchCreateDownloadTask(paramsList);
          downloaded = paramsList.length;
        }
      }
    }

    // 转贴：off 不抓；include / only 都抓该用户的转贴进时间流（转贴从不下载）
    if (mode !== 'off') {
      try {
        await syncSubscriptionRetweets(sub, user);
      } catch (err) {
        log().warn('同步转贴失败', { id: sub.id, err });
      }
    }

    update({
      status: 'idle',
      lastTweetId: newestId,
      lastCheckedAt: Date.now(),
      displayName: user.name,
      avatar: user.avatar,
      downloadedCount: sub.downloadedCount + downloaded,
      dailyStats: addDailyStats(sub.dailyStats, downloaded),
    });

    return { downloaded };
  } catch (err: any) {
    log().error('Subscription check failed', { id: sub.id, err });
    update({
      status: 'error',
      // 关键：失败也要记时间，否则调度器每秒都判定「从未检查过」而无限重试
      lastCheckedAt: Date.now(),
      errorMessage: err?.message || '未知原因',
    });
    return { downloaded: 0 };
  }
}

/** 把一条转贴（原创推文 + 转贴时间）转成时间流缓存条目 */
function toRetweetNote(
  rt: TwitterRetweet,
  retweeter: Subscription,
): RetweetNote | null {
  const o = rt.original;
  const sn = o.user?.screenName;
  if (!o.id || !sn) return null;
  const medias = (o.medias || [])
    .map((m) => ({
      url: m.url || '',
      type: m.type,
      videoUrl: bestVideoUrl(m),
    }))
    .filter((m) => !!m.url);
  if (medias.length === 0) return null;
  return {
    id: o.id,
    screenName: sn,
    authorName: o.user?.name,
    authorAvatar: o.user?.avatar,
    text: o.fullText,
    link: buildPostUrl(sn, o.id),
    retweetedAt: (rt.retweetedAt || dayjs()).toISOString(),
    retweetedBy: [
      { screenName: retweeter.username, name: retweeter.displayName },
    ],
    medias,
  };
}

/**
 * 抓取该用户转贴里的媒体并写入时间流缓存（不下载）。
 * 去重：① 存储层按原创推文 id 合并（同一条多人转只留一条）；
 * ② 原作者**已经是订阅用户**的转贴跳过（其原创内容本就会被订阅抓取）。
 */
async function syncSubscriptionRetweets(
  sub: Subscription,
  user: TwitterUser,
): Promise<void> {
  const { retweets } = await getUserRetweets(user.id, undefined, 40);
  if (retweets.length === 0) return;
  const subscribedNames = new Set(
    useSubscriptionStore
      .getState()
      .subscriptions.filter((s) => s.source === 'twitter')
      .map((s) => s.username.toLowerCase()),
  );
  const notes: RetweetNote[] = [];
  for (const rt of retweets) {
    const note = toRetweetNote(rt, sub);
    if (!note) continue;
    if (subscribedNames.has(note.screenName.toLowerCase())) continue;
    notes.push(note);
  }
  if (notes.length > 0) await upsertRetweetNotes(notes);
}

/**
 * Pawchive 订阅检查：走 getAdapter(sub.source) 解析创作者并拉取最新一页帖子，
 * 与 lastPostId（复用 lastTweetId 字段）对比建立基线，
 * 新帖的 medias 按 mediaTypes 过滤后加入下载队列
 * （目录结构：saveDirBase/创作者名/帖子标题，附件保留原始文件名）。
 */
async function checkArchiverSubscription(
  sub: Subscription,
): Promise<{ downloaded: number }> {
  const { updateSubscription } = useSubscriptionStore.getState();
  const update = (patch: Partial<Subscription>) =>
    updateSubscription(sub.id, patch);

  update({ status: 'running', errorMessage: undefined });

  try {
    const adapter = getAdapter(sub.source);
    const creator = await adapter.resolveCreator(sub.username);
    const { posts } = await adapter.fetchPosts(creator.id, undefined, 20);
    // fetchPosts 返回的帖子 creator 无 name，填充已解析的 creator（目录命名用创作者名）
    const enrichedPosts = withCreator(posts, creator);

    // 时间流 v2：订阅刷新「顺带」把最新一页写进 feed 缓存
    await writeFeedItems(
      (enrichedPosts || []).map((p) =>
        platformPostToFeedItem(p, sub.source as FeedSource),
      ),
    );

    if (!enrichedPosts || enrichedPosts.length === 0) {
      update({
        status: 'idle',
        lastCheckedAt: Date.now(),
        displayName: creator.name || creator.username,
        avatar: creator.avatar,
      });
      return { downloaded: 0 };
    }

    // 取第一条（最新）作为新基线
    const newestId = enrichedPosts[0].id;

    // 是否有新帖：最新一条与上次基线不同即视为有新内容
    const isNew = newestId !== sub.lastTweetId;

    let downloaded = 0;

    // 超级旁观者：跳过自动下载（仍更新基线）
    if (isNew && sub.lastTweetId && !isSpectatorOn()) {
      const newPosts = R.takeWhile(
        (p: PlatformPost) => p.id !== sub.lastTweetId,
        enrichedPosts,
      );
      if (newPosts.length > 0) {
        const { batchCreateDownloadTask } = useDownloadStore.getState();
        const paramsList: CreateDownloadTaskParams[] = [];
        const linkOnlyPosts: PlatformPost[] = [];
        for (const post of newPosts) {
          const medias = (post.medias || []).filter((m) =>
            sub.mediaTypes.includes(m.type),
          );
          if (medias.length > 0) {
            for (const media of medias) {
              paramsList.push({
                source: sub.source,
                post,
                media,
                subscriptionId: sub.id,
              });
            }
          } else if ((post.links?.length || 0) > 0) {
            // 纯外链帖（无附件但有网盘链接）：单独建目录 + 写链接清单，不下载
            linkOnlyPosts.push(post);
          }
        }
        if (paramsList.length > 0) {
          if (!aria2.ready) {
            log().warn(
              'Aria2 is not ready, skip downloading for subscription',
              {
                id: sub.id,
                count: paramsList.length,
              },
            );
          } else {
            await batchCreateDownloadTask(paramsList);
            downloaded = paramsList.length;
          }
        }
        for (const post of linkOnlyPosts) {
          try {
            await prepareArchiverPostDir(post);
          } catch (err: any) {
            log().error('Failed to write external links file', {
              id: sub.id,
              postId: post.id,
              err,
            });
          }
        }
      }
    }

    update({
      status: 'idle',
      lastTweetId: newestId,
      lastCheckedAt: Date.now(),
      displayName: creator.name || creator.username,
      avatar: creator.avatar,
      downloadedCount: sub.downloadedCount + downloaded,
      dailyStats: addDailyStats(sub.dailyStats, downloaded),
    });

    return { downloaded };
  } catch (err: any) {
    log().error('Pawchive subscription check failed', { id: sub.id, err });
    update({
      status: 'error',
      lastCheckedAt: Date.now(),
      errorMessage: err?.message || '未知原因',
    });
    return { downloaded: 0 };
  }
}

/** 把一件 pixiv 作品转成 feed 缓存条目（时间流用；列表已带缩略图，不再逐件拉详情） */
function pixivWorkToFeedItem(work: PixivWork, user?: PixivUser) {
  const post: PlatformPost = {
    id: work.id,
    creator: {
      id: user?.id || work.userId,
      name: user?.name || work.userNick,
      username: user?.account || work.userName,
      // 列表接口不一定带头像，优先用订阅检查时解析到的作者头像
      avatar: user?.avatar || work.userAvatar,
      profileUrl: `https://www.pixiv.net/users/${user?.id || work.userId}`,
    },
    publishedAt: dayjs(work.createDate),
    text: work.title,
    medias: work.thumbUrl
      ? [
          {
            id: `${work.id}-0`,
            type: MediaType.Photo,
            url: work.thumbUrl,
            downloadUrl: work.thumbUrl,
          },
        ]
      : [],
    tags: work.tags,
    postUrl: `https://www.pixiv.net/artworks/${work.id}`,
    source: 'pixiv',
  };
  return platformPostToFeedItem(post, 'pixiv');
}

/**
 * pixiv 订阅检查（L3）：自建列表，不依赖 pixiv「关注」。
 * 拉画师最新一页作品 → 与 lastTweetId 基线对比 → 新的下载 + 写 feed 缓存（进时间流 v2）。
 * ⚠️ 只订阅「插画」（含动图，动图会走 zip→mp4/gif）；漫画暂不含。
 */
async function checkPixivSubscription(
  sub: Subscription,
): Promise<{ downloaded: number }> {
  const { updateSubscription } = useSubscriptionStore.getState();
  const update = (patch: Partial<Subscription>) =>
    updateSubscription(sub.id, patch);

  update({ status: 'running', errorMessage: undefined });

  try {
    const user = await fetchPixivUser(sub.username);
    const { works } = await fetchPixivWorks(sub.username, 0, 'illust');

    if (!works || works.length === 0) {
      update({
        status: 'idle',
        lastCheckedAt: Date.now(),
        displayName: user.name,
        avatar: user.avatar,
      });
      return { downloaded: 0 };
    }

    const newestId = works[0].id;
    const isNew = newestId !== sub.lastTweetId;

    // 时间流 v2：订阅刷新「顺带」写入 feed（含未下载；不能因为没有新作品就跳过）
    await writeFeedItems(works.map((w) => pixivWorkToFeedItem(w, user)));

    let downloaded = 0;
    const wantsPhoto = sub.mediaTypes.includes(MediaType.Photo);
    // 超级旁观者：跳过自动下载（仍更新基线与 feed）
    if (isNew && sub.lastTweetId && wantsPhoto && !isSpectatorOn()) {
      const newWorks = R.takeWhile(
        (w: PixivWork) => w.id !== sub.lastTweetId,
        works,
      );
      for (const work of newWorks) {
        try {
          downloaded += await downloadPixivWork(work);
        } catch (err) {
          log().warn('pixiv 作品下载失败', { id: work.id, err });
        }
      }
    }

    update({
      status: 'idle',
      lastTweetId: newestId,
      lastCheckedAt: Date.now(),
      displayName: user.name,
      avatar: user.avatar,
      downloadedCount: sub.downloadedCount + downloaded,
      dailyStats: addDailyStats(sub.dailyStats, downloaded),
    });

    return { downloaded };
  } catch (err: any) {
    log().error('pixiv subscription check failed', { id: sub.id, err });
    update({
      status: 'error',
      lastCheckedAt: Date.now(),
      errorMessage: err?.message || '未知原因',
    });
    return { downloaded: 0 };
  }
}

const DEFAULT_INTERVAL_MIN = 720;

export interface DailyStat {
  count: number;
  bytes: number;
}

/**
 * 将新增数量累加到当天（本地时区），返回新对象
 */
export function addDailyStats(
  stats: Record<string, DailyStat> | undefined,
  downloaded: number,
): Record<string, DailyStat> {
  if (downloaded <= 0) return stats || {};
  const today = dayjs().format('YYYY-MM-DD');
  const prev = stats?.[today] || { count: 0, bytes: 0 };
  return {
    ...(stats || {}),
    [today]: { count: prev.count + downloaded, bytes: prev.bytes },
  };
}

/**
 * 将下载完成的字节数累加到指定订阅当天（本地时区）
 */
export function addTaskBytes(
  stats: Record<string, DailyStat> | undefined,
  bytes: number,
): Record<string, DailyStat> {
  if (bytes <= 0) return stats || {};
  const today = dayjs().format('YYYY-MM-DD');
  const prev = stats?.[today] || { count: 0, bytes: 0 };
  return {
    ...(stats || {}),
    [today]: { count: prev.count, bytes: prev.bytes + bytes },
  };
}

// 调度循环：每隔 1 秒检查一次是否有到点的订阅
async function scheduleSubscriptions() {
  const { subscriptions } = useSubscriptionStore.getState();
  const now = Date.now();

  const due = subscriptions.filter((sub) => {
    if (!sub.enabled) return false;
    if (sub.status === 'running') return false;
    if (!sub.lastCheckedAt) return true; // 从未检查过
    const base = (sub.intervalMin || DEFAULT_INTERVAL_MIN) * 60 * 1000;
    // 出错的重试间隔更短（5 分钟），但绝不是每秒死循环
    const intervalMs =
      sub.status === 'error' ? Math.min(base, ERROR_RETRY_MS) : base;
    return now - sub.lastCheckedAt >= intervalMs;
  });

  // 限流检查所有到点订阅（避免瞬时高并发被 X 风控）
  await checkSubscriptionsThrottled(due);

  setTimeout(scheduleSubscriptions, 1000);
}

// 监听订阅发起的下载任务完成，累加字节数到当天
onTaskCompleted.listen((task) => {
  if (!task.subscriptionId || !task.totalSize || task.totalSize === Infinity) {
    return;
  }
  const { updateSubscription, subscriptions } = useSubscriptionStore.getState();
  const sub = subscriptions.find((s) => s.id === task.subscriptionId);
  if (!sub) return;
  updateSubscription(sub.id, {
    dailyStats: addTaskBytes(sub.dailyStats, task.totalSize),
  });
});

scheduleSubscriptions();
