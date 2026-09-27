import { fs, path } from '@tauri-apps/api';
import MediaType from '../enums/MediaType';
import { TwitterMedia } from '../interfaces/TwitterMedia';

/** 从推文媒体里挑最优的**可播放视频地址**（优先高码率 mp4；GIF 用其 mp4） */
export function bestVideoUrl(m: TwitterMedia): string | undefined {
  if (m.type === MediaType.Video) {
    const variants = m.videoInfo?.variants || [];
    const mp4s = variants.filter(
      (v) =>
        v.url &&
        (v.contentType === 'video/mp4' || /\.mp4(\?|$)/i.test(v.url || '')),
    );
    if (mp4s.length > 0) {
      mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      return mp4s[0].url;
    }
    return variants.find((v) => v.url)?.url;
  }
  if (m.type === MediaType.Gif) return m.videoInfo?.url;
  return undefined;
}

/**
 * 「转贴进时间流」的本地缓存：选中转贴的订阅检查时写入，**不下载媒体**。
 * 按**原创推文 id** 去重（同一条被多人转只留一条），滚动保留 N 天。
 */
export interface RetweetMedia {
  /** 封面图（视频为 poster 图） */
  url: string;
  type: MediaType;
  /** 视频/GIF 的可播放地址（远程 mp4，未下载时在 app 内播放） */
  videoUrl?: string;
}

export interface RetweetNote {
  /** 原创推文 id（去重键） */
  id: string;
  /** 原作者 screenName */
  screenName: string;
  /** 原作者显示名 */
  authorName?: string;
  /** 原作者头像 */
  authorAvatar?: string;
  text?: string;
  /** 原创推文链接 */
  link: string;
  /** 最近一次转贴时间（ISO） */
  retweetedAt: string;
  /** 转贴者列表（可能多人） */
  retweetedBy: { screenName: string; name?: string }[];
  medias: RetweetMedia[];
}

const KEEP_DAYS = 30;

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('SUB');
  return _log;
}

async function filePath(): Promise<string> {
  return await path.join(await path.appDataDir(), 'retweets.jsonl');
}

/** 读取全部转贴缓存 */
export async function readRetweetNotes(): Promise<RetweetNote[]> {
  const out: RetweetNote[] = [];
  try {
    const file = await filePath();
    if (!(await fs.exists(file))) return out;
    const text = await fs.readTextFile(file);
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as RetweetNote;
        if (r?.id && r?.screenName) out.push(r);
      } catch {
        // ignore bad line
      }
    }
  } catch (err) {
    log().warn('读取 retweets.jsonl 失败', err);
  }
  return out;
}

async function writeRetweetNotes(notes: RetweetNote[]): Promise<void> {
  try {
    const text = notes.map((n) => JSON.stringify(n)).join('\n');
    await fs.writeTextFile(await filePath(), text ? `${text}\n` : '');
  } catch (err) {
    log().warn('写入 retweets.jsonl 失败', err);
  }
}

/** 合并写入（按原创 id 去重）；返回合并后的全量 */
export async function upsertRetweetNotes(
  items: RetweetNote[],
): Promise<number> {
  if (items.length === 0) return 0;
  const existing = await readRetweetNotes();
  const byId = new Map(existing.map((n) => [n.id, n]));
  for (const item of items) {
    const prev = byId.get(item.id);
    if (!prev) {
      byId.set(item.id, item);
      continue;
    }
    const bySet = new Map(
      prev.retweetedBy.map((b) => [b.screenName.toLowerCase(), b]),
    );
    for (const b of item.retweetedBy) {
      const k = b.screenName.toLowerCase();
      if (!bySet.has(k)) bySet.set(k, b);
    }
    byId.set(item.id, {
      ...prev,
      text: prev.text || item.text,
      authorName: prev.authorName || item.authorName,
      authorAvatar: prev.authorAvatar || item.authorAvatar,
      retweetedAt:
        prev.retweetedAt > item.retweetedAt
          ? prev.retweetedAt
          : item.retweetedAt,
      retweetedBy: [...bySet.values()],
      // 媒体以最新一次抓取为准（可补齐视频地址等新字段）
      medias: item.medias.length ? item.medias : prev.medias,
    });
  }
  const merged = prune([...byId.values()]);
  await writeRetweetNotes(merged);
  return merged.length;
}

function prune(notes: RetweetNote[]): RetweetNote[] {
  const start = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  return notes.filter((n) => {
    const t = new Date(n.retweetedAt).getTime();
    return Number.isNaN(t) || t >= start;
  });
}

/** 近 N 天的转贴（时间流用；新→旧） */
export async function getRecentRetweetNotes(days = 7): Promise<RetweetNote[]> {
  const all = await readRetweetNotes();
  const start = Date.now() - days * 24 * 60 * 60 * 1000;
  return all
    .filter((n) => {
      const t = new Date(n.retweetedAt).getTime();
      return !Number.isNaN(t) && t >= start;
    })
    .sort((a, b) => (a.retweetedAt < b.retweetedAt ? 1 : -1));
}
