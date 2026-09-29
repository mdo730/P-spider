import { fs, path } from '@tauri-apps/api';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import MediaType from '../enums/MediaType';
import { PlatformSource } from '../platforms';
import { buildPostUrl } from '../twitter/url';
import { onTaskCompleted } from './download';
import { cacheThumbFromUrl } from '../utils/thumbnail';

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
  /** 媒体原始 URL（视频为封面图） */
  mediaUrl?: string;
  /** 视频/GIF 可播放地址（转贴等未下载媒体的远程 mp4） */
  videoUrl?: string;
  /** 本地保存完整路径 */
  filePath: string;
  /** 本地文件是否仍存在（分组时探测；用于本地文件被删后的兜底） */
  existsLocal?: boolean;
  /** 本地文件名 */
  fileName: string;
  /** 下载完成时间戳 */
  downloadedAt: number;
  /** 来源：subscription=订阅自动下载，manual=手动下载 */
  source: 'subscription' | 'manual';
  /** 来源平台（twitter/pawchive/figmemo/moeyo），用于还原原帖链接 */
  platform?: PlatformSource;
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
    // 有新记录 → 直接并进缓存（避免下次又整文件重解析 300ms+）
    if (_historyCache) {
      _historyCache.unshift(record);
      if (_historyMapCache && record.filePath) {
        _historyMapCache.set(normalizePath(record.filePath), record);
      }
    } else {
      invalidateHistoryCache();
    }
  } catch (err) {
    log().error('Failed to append download history', err);
  }
}

/**
 * 解析结果内存缓存：downloads.jsonl 可能有几十 MB（十万条记录），
 * 每次都重读重解析会让本地库/时间流卡顿。appendDownloadHistory 写入后失效。
 */
let _historyCache: DownloadHistoryRecord[] | null = null;
let _historyLoading: Promise<DownloadHistoryRecord[]> | null = null;

/** 清掉历史缓存（写入新记录后调用） */
function invalidateHistoryCache(): void {
  _historyCache = null;
  _historyMapCache = null;
}

/** 读取全部历史记录（新→旧）；结果带内存缓存，不要就地修改返回的数组 */
export async function readDownloadHistory(): Promise<DownloadHistoryRecord[]> {
  if (_historyCache) return _historyCache;
  if (_historyLoading) return _historyLoading;
  _historyLoading = (async () => {
    const list = await readDownloadHistoryUncached();
    _historyCache = list;
    _historyLoading = null;
    return list;
  })();
  return _historyLoading;
}

async function readDownloadHistoryUncached(): Promise<DownloadHistoryRecord[]> {
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
  /** 'note' = 未下载的新记事（fig-memo/moeyo）；'retweet' = 订阅用户转贴（仅展示，不下载） */
  kind?: 'download' | 'note' | 'retweet';
  /** 记事标题 */
  title?: string;
  /** 跳转 app 内正文的目标页 id（figmemo / moeyo） */
  articlePage?: string;
  /** 记事来源显示名（fig-memo / moeyo） */
  sourceLabel?: string;
  /** 转贴：转推者 screenName（显示「转推自 @x」） */
  retweetedBy?: string;
  /** 转贴：转推者数量（>1 显示「等 N 人」） */
  retweetedByCount?: number;
  /** 头像 URL（下载条目来自推文；转贴为原作者头像；记事用平台图标，留空） */
  avatar?: string;
  /** 记事所属分类名（fig-memo/moeyo），用于时间流标注（低饱和固定色） */
  categories?: string[];
  /** feed 条目（X/Pawchive/pixiv）命中的**本地库标签**名（最多展示最靠前 3 个） */
  libraryTags?: string[];
  /** 筛选令牌：本地库标签 + '转贴' + 'fig-memo'/'moeyo'（时间流胶囊筛选用） */
  filterTokens?: string[];
}

/**
 * 获取近 N 天的下载历史，按推文分组，返回新→旧顺序的分组列表。
 */
export async function getTimelineGroups(
  rangeDays = 7,
): Promise<TimelineGroup[]> {
  const all = await readDownloadHistory();
  const startTime = Date.now() - rangeDays * 24 * 60 * 60 * 1000;

  const recentAll = all.filter((r) => {
    const t = new Date(r.tweetTime).getTime();
    return !Number.isNaN(t) && t >= startTime;
  });
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
    // 仅推特 CDN 支持 ?format=jpg&name=thumb；fig-memo/pawchive 的 mediaUrl 已是图本身
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
    // 原始 URL 不带缩略图参数即为原图
    return record.mediaUrl;
  }
  return getMediaThumbUrl(record);
}

/** 路径归一化（统一分隔符 + 小写），用于本地文件 → 历史记录的匹配 */
export function normalizePath(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase();
}

let _historyMapCache: Map<string, DownloadHistoryRecord> | null = null;

/** 读取全部历史并建立「文件路径 → 记录」索引（用于本地库关联原推文）；结果带缓存 */
export async function getDownloadHistoryMap(): Promise<
  Map<string, DownloadHistoryRecord>
> {
  if (_historyMapCache) return _historyMapCache;
  const all = await readDownloadHistory();
  const map = new Map<string, DownloadHistoryRecord>();
  for (const record of all) {
    if (record.filePath) {
      map.set(normalizePath(record.filePath), record);
    }
  }
  _historyMapCache = map;
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
      // 视频/动图：顺手把**在线封面**写进缩略图缓存
      // （本地库浏览就秒开，不必现场解码视频取帧——那个很慢）
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
        mediaType: task.media?.type || MediaType.Photo,
        mediaUrl: task.media?.url,
        // 视频/GIF 记录下载直链，便于本地文件删除后仍能经代理流式播放
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
