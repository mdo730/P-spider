import { fs, path } from '@tauri-apps/api';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import MediaType from '../enums/MediaType';

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
