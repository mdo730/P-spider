import { fs, path } from '@tauri-apps/api';
import MediaType from '../enums/MediaType';
import { PlatformPost } from '../platforms';
import { useSettingsStore } from '../stores/settings';

/**
 * 时间流 v2 的**订阅刷新结果 feed 缓存**（%APPDATA%\p-spider\timeline-feed.jsonl）。
 *
 * 由现有订阅刷新逻辑在拉取时「顺带」写入（不新增轮询）：
 * - X（twitter）/ Pawchive / pixiv 每拉一页就 upsert 一页条目，按推文 id 去重；
 * - fig-memo / moeyo 的「新记事」仍走各站点缓存（getRecentSiteNotes）；
 * - 「转贴」仍走 retweets.jsonl。
 *
 * 这样时间流不再依赖 downloads.jsonl（下不下载都能即时看到）；
 * downloads.jsonl 保留给本地库「溯源」用。
 */
export type FeedSource = 'twitter' | 'pawchive' | 'pixiv';

export interface FeedMedia {
  type: MediaType;
  /** 展示用地址（图片原图 / 视频封面 poster） */
  url: string;
  /** 视频/GIF 的可播放 mp4（未下载时在 app 内播放） */
  videoUrl?: string;
  /** 缩略图地址（可选） */
  thumbUrl?: string;
}

export interface FeedItem {
  /** 推文/帖子 id（去重键） */
  id: string;
  source: FeedSource;
  /** 原帖页面 URL */
  url: string;
  /** 发布时间（ISO 字符串） */
  time: string;
  text?: string;
  username?: string;
  displayName?: string;
  avatar?: string;
  /** 作者稳定 id（用于「账号 → 文件夹名」绑定解析本地库标签） */
  userId?: string;
  medias: FeedMedia[];
}

const FILE = 'timeline-feed.jsonl';
/** 缓存保留天数**跟随时间流设置**（`timeline.rangeDays`，1~30；默认 7） */
const DEFAULT_KEEP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function keepDays(): number {
  const v =
    useSettingsStore.getState().timeline?.rangeDays ?? DEFAULT_KEEP_DAYS;
  return Math.min(30, Math.max(1, v));
}
/** 批量写盘防抖（订阅并发检查时避免反复重写整文件） */
const FLUSH_DELAY_MS = 1500;

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('FEED');
  return _log;
}

async function filePath(): Promise<string> {
  return await path.join(await path.appDataDir(), FILE);
}

function prune(items: FeedItem[]): FeedItem[] {
  const start = Date.now() - keepDays() * DAY_MS;
  return items.filter((it) => {
    const t = new Date(it.time).getTime();
    return Number.isNaN(t) || t >= start;
  });
}

/** 把一条统一平台帖子转成 feed 条目（订阅刷新时调用） */
export function platformPostToFeedItem(
  post: PlatformPost,
  source: FeedSource,
): FeedItem {
  const medias: FeedMedia[] = [];
  for (const m of post.medias || []) {
    const url = m.url || m.downloadUrl || '';
    if (!url) continue;
    const playable =
      m.type === MediaType.Video || m.type === MediaType.Gif
        ? m.downloadUrl || m.videoInfo?.url
        : undefined;
    medias.push({
      type: m.type,
      url,
      videoUrl: playable,
      thumbUrl: m.thumbUrl,
    });
  }
  return {
    id: post.id,
    source,
    url: post.postUrl || '',
    time: post.publishedAt
      ? post.publishedAt.toISOString()
      : new Date().toISOString(),
    text: post.text,
    username: post.creator?.username,
    displayName: post.creator?.name,
    avatar: post.creator?.avatar,
    userId: post.creator?.id,
    medias,
  };
}

// ---- 内存缓存 + 串行/防抖写盘 ----

let cache: FeedItem[] | null = null;
let loading: Promise<FeedItem[]> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function readFromDisk(): Promise<FeedItem[]> {
  const out: FeedItem[] = [];
  const file = await filePath();
  if (!(await fs.exists(file))) return out;
  const text = await fs.readTextFile(file);
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const it = JSON.parse(line) as FeedItem;
      if (it?.id) out.push(it);
    } catch {
      // 跳过坏行
    }
  }
  return out;
}

async function ensureLoaded(): Promise<FeedItem[]> {
  if (cache) return cache;
  if (!loading) {
    loading = (async () => readFromDisk())().finally(() => {
      loading = null;
    });
  }
  cache = await loading;
  return cache;
}

async function persist(): Promise<void> {
  if (!cache) return;
  try {
    const text = cache.map((it) => JSON.stringify(it)).join('\n');
    await fs.writeTextFile(await filePath(), text ? `${text}\n` : '');
  } catch (err) {
    log().warn('feed persist failed', err);
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void persist();
  }, FLUSH_DELAY_MS);
}

/**
 * 合并写入一批 feed 条目（按 id 去重，保留上限天）。写盘做防抖，内存缓存即时生效，
 * 因此刚写完马上读时间流也能看到。
 */
async function doWriteFeed(fresh: FeedItem[]): Promise<void> {
  const list = await ensureLoaded();
  const byId = new Map(list.map((it) => [it.id, it]));
  for (const it of fresh) byId.set(it.id, it);
  cache = prune([...byId.values()]);
  scheduleFlush();
}

/** 写队列（串行化）：多站点并行检测时避免并发读改写互相覆盖 */
let writeQueue: Promise<void> = Promise.resolve();

export function writeFeedItems(items: FeedItem[]): Promise<void> {
  const fresh = items.filter((it) => it?.id);
  if (fresh.length === 0) return Promise.resolve();
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => doWriteFeed(fresh))
    .catch((err) => {
      // 写 feed 失败不应影响订阅检查本身
      log().warn('writeFeedItems failed', err);
    });
  return writeQueue;
}

/** 近 N 天的 feed 条目（时间流用；新→旧） */
export async function getRecentFeedItems(days = 7): Promise<FeedItem[]> {
  const list = await ensureLoaded();
  const start = Date.now() - days * DAY_MS;
  return list
    .filter((it) => {
      const t = new Date(it.time).getTime();
      return !Number.isNaN(t) && t >= start;
    })
    .sort((a, b) => (a.time < b.time ? 1 : -1));
}

/** 立即落盘（供测试/需要确保持久化时调用） */
export async function flushFeed(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await persist();
}
