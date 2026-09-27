import { nanoid } from 'nanoid';
import * as R from 'ramda';
import dayjs from 'dayjs';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import MediaType from '../enums/MediaType';
import { Subscription } from '../interfaces/Subscription';
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

/** 订阅检查并发上限：兼顾速度与风控（过高会被 X 403；过低太慢） */
const CHECK_CONCURRENCY = 4;
/** 每次订阅检查之间的间隔（ms），降低瞬时压力 */
const CHECK_GAP_MS = 200;
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
    await mapLimit(subs, CHECK_CONCURRENCY, async (sub) => {
      try {
        await checkSubscription(sub);
      } catch (err) {
        log().error('Subscription check failed', { id: sub.id, err });
      }
      await delay(CHECK_GAP_MS);
    });
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
  /** 是否额外抓取转贴媒体（仅进时间流，不下载；默认 false） */
  includeRetweets?: boolean;
  /** 平台源，默认 twitter（阶段3 UI 支持多平台后由表单选择） */
  source?: PlatformSource;
}

export interface SubscriptionStore {
  subscriptions: Subscription[];
  addSubscription: (params: CreateSubscriptionParams) => Promise<void>;
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
        includeRetweets,
        source,
      }) => {
        const id = nanoid();
        const sub: Subscription = {
          id,
          source: source || 'twitter',
          username,
          intervalMin,
          mediaTypes,
          includeRetweets: includeRetweets === true,
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
            includeRetweets: s.includeRetweets === true,
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
            item.source === 'pawchive' || item.source === 'kemono'
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
            includeRetweets: item.includeRetweets === true,
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
      version: 6,
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
            source: s.source === 'kemono' ? 'pawchive' : s.source || 'twitter',
            includeRetweets: s.includeRetweets === true,
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

    if (isNew && sub.lastTweetId) {
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

    // 转贴：勾选了 includeRetweets 时，额外抓该用户的转贴媒体（仅进时间流，不下载）
    if (sub.includeRetweets) {
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

    if (isNew && sub.lastTweetId) {
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
