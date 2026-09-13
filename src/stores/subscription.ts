import { nanoid } from 'nanoid';
import * as R from 'ramda';
import dayjs from 'dayjs';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import MediaType from '../enums/MediaType';
import { Subscription } from '../interfaces/Subscription';
import { TwitterPost } from '../interfaces/TwitterPost';
import { getUser, getUserMedias } from '../twitter/api';
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
        source,
      }) => {
        const id = nanoid();
        const sub: Subscription = {
          id,
          source: source || 'twitter',
          username,
          intervalMin,
          mediaTypes,
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
        // 一键刷新：强制检查所有订阅（含卡在 running 的），
        // 避免因请求挂起卡住的订阅被永久跳过而无法恢复
        await Promise.all(
          subs.map((sub) =>
            checkSubscription(sub).catch((err) => {
              log().error('Check all failed', { id: sub.id, err });
            }),
          ),
        );
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
      version: 5,
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
            source: s.source === 'kemono' ? 'pawchive' : s.source || 'twitter',
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
      errorMessage: err?.message || '未知原因',
    });
    return { downloaded: 0 };
  }
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
    const intervalMs = (sub.intervalMin || DEFAULT_INTERVAL_MIN) * 60 * 1000;
    if (!sub.lastCheckedAt) return true; // 从未检查过
    return now - sub.lastCheckedAt >= intervalMs;
  });

  // 并发检查所有到点订阅
  await Promise.all(
    due.map((sub) =>
      checkSubscription(sub).catch((err) => {
        log().error('Scheduled subscription check failed', { sub, err });
      }),
    ),
  );

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
