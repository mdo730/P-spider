import { invoke } from '@tauri-apps/api';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { fs, path } from '@tauri-apps/api';
import MediaType from '../enums/MediaType';
import { PlatformSource } from '../platforms';
import { buildPostUrl, buildUserUrl } from '../twitter/url';
import { onTaskCompleted } from './download';
import { cacheThumbFromUrl } from '../utils/thumbnail';

/**
 * 下载历史（改为 Rust + SQLite）。
 *
 * `downloads.jsonl`（可能几十 MB / 14 万条）首次由 Rust 建成 `history.db`，
 * 之后本地库按**路径**查、时间流按**时间**查，**JS 不再常驻全部记录**。
 * 新增下载仍追加写 jsonl（备份），同时入库。
 */

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('HIST');
  return _log;
}

export interface DownloadHistoryRecord {
  postId: string;
  tweetTime: string;
  fullText?: string;
  username?: string;
  displayName?: string;
  avatar?: string;
  mediaType: MediaType;
  mediaUrl?: string;
  videoUrl?: string;
  filePath: string;
  existsLocal?: boolean;
  fileName: string;
  downloadedAt: number;
  source: 'subscription' | 'manual';
  platform?: PlatformSource;
  postUrl?: string;
  userId?: string;
}

/** 追加一条下载历史（Rust：入 SQLite + 追加 jsonl） */
export async function appendDownloadHistory(
  record: DownloadHistoryRecord,
): Promise<void> {
  try {
    await invoke('hist_append', { record });
  } catch (err) {
    log().error('Failed to append download history', err);
  }
}

/** 路径归一化（统一分隔符 + 小写），用于本地文件 → 历史记录的匹配 */
export function normalizePath(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase();
}

/** 按文件路径批量取下载历史（本地库关联原推文用） */
export async function getHistoryByPaths(
  paths: string[],
): Promise<Map<string, DownloadHistoryRecord>> {
  const out = new Map<string, DownloadHistoryRecord>();
  if (paths.length === 0) return out;
  try {
    const records = await invoke<DownloadHistoryRecord[]>('hist_by_paths', {
      paths,
    });
    for (const r of records) {
      if (r.filePath) out.set(normalizePath(r.filePath), r);
    }
  } catch (err) {
    log().warn('读取下载历史（按路径）失败', err);
  }
  return out;
}

/** 本地库顶层文件夹：一级段 → 平台（覆盖结构启发式） */
export async function getPlatformSegments(
  prefix: string,
): Promise<Map<string, PlatformSource>> {
  const out = new Map<string, PlatformSource>();
  try {
    const rows = await invoke<{ seg: string; platform: string }[]>(
      'hist_platform_segments',
      { prefix },
    );
    for (const { seg, platform } of rows)
      out.set(seg, platform as PlatformSource);
  } catch (err) {
    log().warn('读取平台段失败', err);
  }
  return out;
}

export interface TimelineGroup {
  postId: string;
  tweetTime: string;
  fullText?: string;
  username?: string;
  displayName?: string;
  records: DownloadHistoryRecord[];
  kind?: 'download' | 'note' | 'retweet';
  title?: string;
  articlePage?: string;
  sourceLabel?: string;
  retweetedBy?: string;
  retweetedByCount?: number;
  avatar?: string;
  categories?: string[];
  libraryTags?: string[];
  filterTokens?: string[];
}

/**
 * 获取近 N 天的下载历史，按推文分组，返回新→旧顺序的分组列表。
 * 只查数据库里这段时间的记录（不再全量读内存）。
 */
export async function getTimelineGroups(
  rangeDays = 7,
): Promise<TimelineGroup[]> {
  const sinceIso = new Date(
    Date.now() - rangeDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  let recentAll: DownloadHistoryRecord[] = [];
  try {
    recentAll = await invoke<DownloadHistoryRecord[]>('hist_recent', {
      sinceIso,
      limit: 0,
    });
  } catch (err) {
    log().error('Failed to read download history', err);
    return [];
  }
  // 探测本地文件是否仍存在（被删除后用于兜底：走远程/原推，而不是本地路径）
  const recent = await Promise.all(
    recentAll.map(async (r) => {
      let existsLocal: boolean | undefined;
      if (r.filePath) {
        existsLocal = await fs.exists(r.filePath).catch(() => false);
      }
      return { ...r, existsLocal };
    }),
  );

  const map = new Map<string, TimelineGroup>();
  for (const r of recent) {
    let g = map.get(r.postId);
    if (!g) {
      g = {
        postId: r.postId,
        tweetTime: r.tweetTime,
        fullText: r.fullText,
        username: r.username,
        displayName: r.displayName,
        avatar: r.avatar,
        records: [],
      };
      map.set(r.postId, g);
    }
    g.records.push(r);
  }

  return Array.from(map.values()).sort((a, b) =>
    b.tweetTime > a.tweetTime ? 1 : -1,
  );
}

/** 生成媒体缩略图 URL（推特走 CDN 缩略图参数；其它平台原图即缩略图） */
export function getMediaThumbUrl(record: DownloadHistoryRecord): string {
  if (record.mediaUrl) {
    if (!record.platform || record.platform === 'twitter') {
      return `${record.mediaUrl}?format=jpg&name=thumb`;
    }
    return record.mediaUrl;
  }
  if (record.filePath) {
    try {
      return convertFileSrc(record.filePath);
    } catch (err) {
      log().warn('convertFileSrc failed', err);
    }
  }
  return '';
}

/** 生成媒体原图 URL（用于点开大图预览） */
export function getMediaOriginalUrl(record: DownloadHistoryRecord): string {
  if (record.mediaUrl) {
    return record.mediaUrl;
  }
  return getMediaThumbUrl(record);
}

/** 由历史记录还原帖子原网页 URL（旧记录无 postUrl 时按 twitter 拼接） */
export function resolvePostUrl(
  record: DownloadHistoryRecord,
): string | undefined {
  if (record.postUrl) return record.postUrl;
  const isTwitter = !record.platform || record.platform === 'twitter';
  if (isTwitter && record.username && record.postId) {
    return buildPostUrl(record.username, record.postId);
  }
  return undefined;
}

export interface FileTweetInfo {
  displayName?: string;
  username?: string;
  avatar?: string;
  time?: string;
  url?: string;
  text?: string;
  platform?: PlatformSource;
  profileUrl?: string;
}

/** 按平台还原「作者主页」链接 */
export function resolveProfileUrl(
  record: DownloadHistoryRecord,
): string | undefined {
  const platform = record.platform || 'twitter';
  if (platform === 'twitter') {
    return record.username ? buildUserUrl(record.username) : undefined;
  }
  if (platform === 'pawchive') {
    const [service, user] = (record.username || '').split('/');
    return service && user
      ? `https://pawchive.pw/${service}/user/${user}`
      : undefined;
  }
  if (platform === 'pixiv') {
    return record.userId
      ? `https://www.pixiv.net/users/${record.userId}`
      : undefined;
  }
  return undefined;
}

/** 下载历史记录 → 统一信息 */
export function recordToTweetInfo(
  record: DownloadHistoryRecord,
): FileTweetInfo {
  return {
    displayName: record.displayName,
    username: record.username,
    avatar: record.avatar,
    time: record.tweetTime,
    url: resolvePostUrl(record),
    text: record.fullText,
    platform: record.platform || 'twitter',
    profileUrl: resolveProfileUrl(record),
  };
}

// 监听下载任务完成事件，自动写入历史（时间流数据源）。
// 注意：本模块需在应用启动时被加载（见 main.tsx 副作用 import），
// 否则监听只在打开时间流页面时才注册，后台订阅下载将丢失历史记录。
onTaskCompleted.listen((task) => {
  void (async () => {
    try {
      const filePath = await path.join(task.dir, task.fileName);
      const type = task.media?.type;
      if (
        (type === MediaType.Video || type === MediaType.Gif) &&
        task.media?.url
      ) {
        void cacheThumbFromUrl(
          filePath,
          `${task.media.url}?format=jpg&name=thumb`,
        );
      }
      await appendDownloadHistory({
        postId: task.post?.id || '',
        tweetTime:
          task.post?.publishedAt?.toISOString?.() ||
          new Date(task.updatedAt).toISOString(),
        fullText: task.post?.text,
        username: task.post?.creator?.username,
        displayName: task.post?.creator?.name,
        avatar: task.post?.creator?.avatar,
        userId: task.post?.creator?.id || undefined,
        mediaType: task.media?.type || MediaType.Photo,
        mediaUrl: task.media?.url,
        videoUrl:
          task.media?.type === MediaType.Video ||
          task.media?.type === MediaType.Gif
            ? task.media?.downloadUrl
            : undefined,
        filePath,
        fileName: task.fileName,
        downloadedAt: task.updatedAt,
        source: task.subscriptionId ? 'subscription' : 'manual',
        platform: task.post?.source,
        postUrl: task.post?.postUrl,
      });
    } catch (err) {
      log().error('Failed to write download history', err);
    }
  })();
});
