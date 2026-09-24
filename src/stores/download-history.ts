import { fs, path } from '@tauri-apps/api';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import MediaType from '../enums/MediaType';
import { buildPostUrl } from '../twitter/url';
import { onTaskCompleted } from './download';

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('HIST');
  return _log;
}

export interface DownloadHistoryRecord {
  /** 推文 id */
  postId: string;
  /** 推文发布时间（ISO 字符串），用于时间流排序 */
  tweetTime: string;
  /** 推文全文 */
  fullText?: string;
  /** 推文用户名（screenName） */
  username?: string;
  /** 推文用户昵称 */
  displayName?: string;
  /** 推文用户头像 URL */
  avatar?: string;
  /** 媒体类型 */
  mediaType: MediaType;
  /** 媒体原始 URL */
  mediaUrl?: string;
  /** 本地保存完整路径 */
  filePath: string;
  /** 本地文件名 */
  fileName: string;
  /** 下载完成时间戳 */
  downloadedAt: number;
  /** 来源：subscription=订阅自动下载，manual=手动下载 */
  source: 'subscription' | 'manual';
  /** 来源平台（twitter/pawchive/figmemo），用于还原原帖链接 */
  platform?: 'twitter' | 'pawchive' | 'figmemo';
  /** 帖子详情页 URL */
  postUrl?: string;
}

async function getHistoryFilePath(): Promise<string> {
  const dir = await path.appDataDir();
  if (!(await fs.exists(dir))) {
    await fs.createDir(dir, { recursive: true });
  }
  return await path.join(dir, 'downloads.jsonl');
}

/** 追加一条下载历史记录到 jsonl */
export async function appendDownloadHistory(
  record: DownloadHistoryRecord,
): Promise<void> {
  try {
    const filePath = await getHistoryFilePath();
    await fs.writeTextFile(filePath, JSON.stringify(record) + '\n', {
      append: true,
    });
  } catch (err) {
    log().error('Failed to append download history', err);
  }
}

/** 读取全部历史记录（新→旧） */
export async function readDownloadHistory(): Promise<DownloadHistoryRecord[]> {
  try {
    const filePath = await getHistoryFilePath();
    if (!(await fs.exists(filePath))) {
      return [];
    }
    const text = await fs.readTextFile(filePath);
    const lines = text.split('\n').filter((l) => l.trim());
    const records: DownloadHistoryRecord[] = [];
    for (const line of lines) {
      try {
        const r = JSON.parse(line) as DownloadHistoryRecord;
        if (r && r.postId && r.filePath) {
          records.push(r);
        }
      } catch (err) {
        log().warn('Skip invalid history line', err);
      }
    }
    // 按推文时间倒序（新→旧）
    return records.sort((a, b) => (b.tweetTime > a.tweetTime ? 1 : -1));
  } catch (err) {
    log().error('Failed to read download history', err);
    return [];
  }
}

export interface TimelineGroup {
  postId: string;
  tweetTime: string;
  fullText?: string;
  username?: string;
  displayName?: string;
  records: DownloadHistoryRecord[];
}

/**
 * 获取近 N 天的下载历史，按推文分组，返回新→旧顺序的分组列表。
 */
export async function getTimelineGroups(
  rangeDays = 7,
): Promise<TimelineGroup[]> {
  const all = await readDownloadHistory();
  const startTime = Date.now() - rangeDays * 24 * 60 * 60 * 1000;

  const recent = all.filter((r) => {
    const t = new Date(r.tweetTime).getTime();
    return !Number.isNaN(t) && t >= startTime;
  });

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

/** 生成媒体缩略图 URL（复用下载管理页方案：直接走推特 CDN 缩略图） */
export function getMediaThumbUrl(record: DownloadHistoryRecord): string {
  if (record.mediaUrl) {
    // 视频/GIF 的 url 也是 pbs.twimg.com 的预览图，可正常加缩略图参数
    return `${record.mediaUrl}?format=jpg&name=thumb`;
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
    // 原始 URL 不带缩略图参数即为原图
    return record.mediaUrl;
  }
  return getMediaThumbUrl(record);
}

/** 路径归一化（统一分隔符 + 小写），用于本地文件 → 历史记录的匹配 */
export function normalizePath(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase();
}

/** 读取全部历史并建立「文件路径 → 记录」索引（用于本地库关联原推文） */
export async function getDownloadHistoryMap(): Promise<
  Map<string, DownloadHistoryRecord>
> {
  const all = await readDownloadHistory();
  const map = new Map<string, DownloadHistoryRecord>();
  for (const record of all) {
    if (record.filePath) {
      map.set(normalizePath(record.filePath), record);
    }
  }
  return map;
}

/** 由历史记录还原帖子原网页 URL（旧记录无 postUrl 时按 twitter 拼接，无法还原则 undefined） */
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

/** 本地库「文件 → 推文」统一信息（不同来源拼合后的结果） */
export interface FileTweetInfo {
  displayName?: string;
  username?: string;
  avatar?: string;
  time?: string;
  url?: string;
  text?: string;
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
  };
}

// 监听下载任务完成事件，自动写入历史（时间流数据源）。
// 注意：本模块需在应用启动时被加载（见 main.tsx 副作用 import），
// 否则监听只在打开时间流页面时才注册，后台订阅下载将丢失历史记录。
onTaskCompleted.listen((task) => {
  void (async () => {
    try {
      const filePath = await path.join(task.dir, task.fileName);
      await appendDownloadHistory({
        postId: task.post?.id || '',
        tweetTime:
          task.post?.publishedAt?.toISOString?.() ||
          new Date(task.updatedAt).toISOString(),
        fullText: task.post?.text,
        username: task.post?.creator?.username,
        displayName: task.post?.creator?.name,
        avatar: task.post?.creator?.avatar,
        mediaType: task.media?.type || MediaType.Photo,
        mediaUrl: task.media?.url,
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
