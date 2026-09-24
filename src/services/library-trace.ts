import { fs, path } from '@tauri-apps/api';
import { toPlatformMedia, toPlatformPost } from '../platforms/twitter';
import { prepareDownloadTask } from '../stores/download';
import { normalizePath } from '../stores/download-history';
import { useAppStateStore } from '../stores/app-state';
import { useSettingsStore } from '../stores/settings';
import { getUser, getUserMedias } from '../twitter/api';
import { buildPostUrl } from '../twitter/url';
import { TwitterPost } from '../interfaces/TwitterPost';
import { delay } from '../utils';
import { listRootFolders, scanDirectory } from '../utils/library';
import {
  TracedRecord,
  parseFileName,
  readTraceMap,
  writeTraceMap,
} from '../utils/library/trace';

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('LIB');
  return _log;
}

/** 每个作者最多翻页数（防超长账号无限翻页） */
const MAX_PAGES_PER_AUTHOR = 40;
const PAGE_COUNT = 20;
const REQUEST_INTERVAL = 400;

export interface TraceProgress {
  phase: 'scanning' | 'tracing';
  totalAuthors: number;
  processedAuthors: number;
  matchedFiles: number;
  currentAuthor?: string;
}

export interface TraceResult {
  matched: number;
  authors: number;
  skipped: number;
  aborted: boolean;
}

function buildTracedRecord(post: TwitterPost): TracedRecord {
  return {
    postId: post.id,
    username: post.user?.screenName,
    displayName: post.user?.name,
    avatar: post.user?.avatar,
    tweetTime: post.createdAt?.toISOString(),
    fullText: post.fullText,
    postUrl: post.user?.screenName
      ? buildPostUrl(post.user.screenName, post.id)
      : undefined,
  };
}

/**
 * 联网溯源（方向 B）：
 * 1) 扫描 saveDirBase 下各作者文件夹，用文件名模板反解出推文 ID（只处理能反解的 X 作者）；
 * 2) 对该作者翻页拉取媒体推文，按推文 ID 命中后，用下载模板算出本地路径并校验存在；
 * 3) 命中结果写入 library-trace.json（增量落盘，可中断）。
 *
 * 局限：仅 X；文件夹名需为用户名（screen name）；已删除推文无法找回；Pawchive 不适用。
 */
export async function runLibraryTrace(
  onProgress: (progress: TraceProgress) => void,
  signal: AbortSignal,
): Promise<TraceResult> {
  const settings = useSettingsStore.getState();
  const saveDirBase = settings.download.saveDirBase;
  const template = settings.download.fileNameTemplate;
  if (!saveDirBase) throw new Error('未设置保存目录');
  if (!useAppStateStore.getState().cookieString) {
    throw new Error('未登录（缺少 Cookie），无法联网溯源');
  }

  const traceMap = new Map(await readTraceMap());

  // 阶段一：找出可反解推文 ID 的作者
  const rootFolders = await listRootFolders(saveDirBase);
  const progress: TraceProgress = {
    phase: 'scanning',
    totalAuthors: rootFolders.length,
    processedAuthors: 0,
    matchedFiles: 0,
  };
  onProgress({ ...progress });

  const authors: { name: string; path: string; postIds: Set<string> }[] = [];
  for (const folder of rootFolders) {
    if (signal.aborted) break;
    progress.currentAuthor = folder.name;
    onProgress({ ...progress });
    try {
      const content = await scanDirectory(folder.path);
      const postIds = new Set<string>();
      for (const file of content.files) {
        const parsed = parseFileName(file.name, template);
        if (parsed?.postId) postIds.add(parsed.postId);
      }
      if (postIds.size > 0) authors.push({ ...folder, postIds });
    } catch (err) {
      log().warn('扫描作者文件夹失败', folder.path, err);
    }
    progress.processedAuthors += 1;
    onProgress({ ...progress });
  }

  // 阶段二：逐作者拉取并匹配
  progress.phase = 'tracing';
  progress.totalAuthors = authors.length;
  progress.processedAuthors = 0;
  progress.currentAuthor = undefined;
  onProgress({ ...progress });

  let matched = 0;
  let skipped = 0;
  for (const author of authors) {
    if (signal.aborted) break;
    progress.currentAuthor = author.name;
    onProgress({ ...progress });
    try {
      const user = await getUser(author.name);
      const remaining = new Set(author.postIds);
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES_PER_AUTHOR; page += 1) {
        if (signal.aborted) break;
        const { twitterPosts, cursor: next } = await getUserMedias(
          user.id,
          cursor,
          PAGE_COUNT,
        );
        for (const post of twitterPosts) {
          if (!remaining.has(post.id)) continue;
          const platformPost = toPlatformPost(post);
          for (const media of post.medias || []) {
            const task = await prepareDownloadTask({
              source: 'twitter',
              post: platformPost,
              media: toPlatformMedia(media),
            });
            const filePath = await path.join(task.dir, task.fileName);
            if (!(await fs.exists(filePath))) continue;
            const key = normalizePath(filePath);
            if (traceMap.has(key)) continue;
            traceMap.set(key, buildTracedRecord(post));
            matched += 1;
            progress.matchedFiles = matched;
            onProgress({ ...progress });
          }
          remaining.delete(post.id);
        }
        cursor = next || undefined;
        if (remaining.size === 0 || !cursor) break;
        await delay(REQUEST_INTERVAL);
      }
    } catch (err) {
      skipped += 1;
      log().warn('溯源作者失败', author.name, err);
    }
    progress.processedAuthors += 1;
    progress.currentAuthor = undefined;
    onProgress({ ...progress });
    // 增量落盘，中断也不丢已得结果
    await writeTraceMap(traceMap);
  }

  await writeTraceMap(traceMap);
  return { matched, authors: authors.length, skipped, aborted: signal.aborted };
}
