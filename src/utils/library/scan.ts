import { fs } from '@tauri-apps/api';
import type { FileEntry } from '@tauri-apps/api/fs';
import { PlatformSource } from '../../platforms';

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('LIB');
  return _log;
}

/** 媒体类型（本地库仅区分图片/视频，gif 归为图片） */
export type LibraryMediaKind = 'image' | 'video';

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'avif',
  'heic',
  'jfif',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'webm',
  'mkv',
  'avi',
  'm4v',
  'wmv',
  'flv',
  'ts',
  'mpeg',
  'mpg',
]);

/** 明确是「文件」而非文件夹的扩展名：saveDirBase 下偶有散落文件，避免被当文件夹扫描 */
const NON_FOLDER_EXTENSIONS = new Set([
  'json',
  'jsonl',
  'txt',
  'log',
  'md',
  'ini',
  'cfg',
  'conf',
  'db',
  'sqlite',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'bak',
  'tmp',
  'temp',
  'part',
  'aria2',
  'exe',
  'msi',
  'dll',
  'lnk',
  'url',
  'html',
  'htm',
  'xml',
  'csv',
]);

/** 同步取路径末段（Tauri 的 path.basename 是异步的，扫描时不便使用） */
export function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function getExtension(name: string): string {
  const base = baseName(name);
  const idx = base.lastIndexOf('.');
  if (idx <= 0) return '';
  return base.slice(idx + 1).toLowerCase();
}

export function getMediaKind(name: string): LibraryMediaKind | null {
  const ext = getExtension(name);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

export function isMediaFile(name: string): boolean {
  return getMediaKind(name) !== null;
}

export interface LibraryFile {
  name: string;
  path: string;
  kind: LibraryMediaKind;
  ext: string;
  /** 文件修改时间（毫秒），用于按日期排序 */
  mtime?: number;
}

export interface LibraryFolderSummary {
  mediaCount: number;
  coverPath?: string;
  coverKind?: LibraryMediaKind;
  /** 平台（结构启发式推断：含子文件夹≈Pawchive，直接含媒体≈X） */
  platform?: PlatformSource;
}

export interface LibraryRootFolder extends LibraryFolderSummary {
  name: string;
  path: string;
  /** 目录修改时间（毫秒），近似「最近下载时间」 */
  mtime?: number;
}

export interface LibrarySubFolder extends LibraryFolderSummary {
  name: string;
  path: string;
  mtime?: number;
}

export interface DirectoryContent {
  /** 递归收集的全部媒体文件（平铺模式用） */
  files: LibraryFile[];
  /** 直接子文件夹（按文件夹模式用，带封面与媒体数） */
  folders: LibrarySubFolder[];
}

/** 收集树中所有叶子节点（文件）；带 children 数组的视为目录 */
function flattenLeaves(entries: FileEntry[]): FileEntry[] {
  const out: FileEntry[] = [];
  for (const entry of entries) {
    if (Array.isArray(entry.children)) {
      out.push(...flattenLeaves(entry.children));
    } else {
      out.push(entry);
    }
  }
  return out;
}

function entryName(entry: FileEntry): string {
  return entry.name || baseName(entry.path);
}

function pickCover(mediaEntries: FileEntry[]): FileEntry | undefined {
  return (
    mediaEntries.find((e) => getMediaKind(entryName(e)) === 'image') ||
    mediaEntries[0]
  );
}

function toLibraryFile(entry: FileEntry): LibraryFile {
  const name = entryName(entry);
  return {
    name,
    path: entry.path,
    kind: getMediaKind(name) || 'image',
    ext: getExtension(name),
  };
}

/** 并发受限的 map（避免一次性 readDir 打开过多目录） */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = new Array(workerCount).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const folderSummaryCache = new Map<string, LibraryFolderSummary | null>();

export function clearFolderSummaryCache(): void {
  folderSummaryCache.clear();
}

/**
 * 从「本地库」排除的外部根目录：fig-memo 有独立选项卡 + 独立标签树/收藏，
 * 只是物理上保存在 saveDirBase 下，不应混入本地库（文件夹网格 / 一键缩略图 / 联网溯源）。
 * 排除点收敛在 `listRootFolders`，上述三个入口都会调用它。
 */
const EXCLUDED_ROOT_FOLDERS = new Set(['fig-memo']);

/** 列出 saveDirBase 下的一级文件夹（非递归；非媒体文件与 fig-memo 在此被过滤） */
export async function listRootFolders(
  rootDir: string,
): Promise<{ name: string; path: string }[]> {
  const entries = await fs.readDir(rootDir, { recursive: false });
  return entries
    .map((entry) => ({ name: entryName(entry), path: entry.path }))
    .filter(
      (folder) =>
        !isMediaFile(folder.name) &&
        !NON_FOLDER_EXTENSIONS.has(getExtension(folder.name)) &&
        !EXCLUDED_ROOT_FOLDERS.has(folder.name.toLowerCase()),
    );
}

/** 汇总某个文件夹（递归统计媒体数 + 取封面），失败（非目录/无权限）返回 null */
export async function summarizeFolder(
  dir: string,
  refresh = false,
): Promise<LibraryFolderSummary | null> {
  if (!refresh && folderSummaryCache.has(dir)) {
    return folderSummaryCache.get(dir) as LibraryFolderSummary | null;
  }
  try {
    const entries = await fs.readDir(dir, { recursive: true });
    const media = flattenLeaves(entries).filter((e) =>
      isMediaFile(entryName(e)),
    );
    const cover = pickCover(media);
    // 结构启发式：一级文件夹内含子文件夹（帖子标题）≈ Pawchive；直接含媒体 ≈ X
    const hasSubFolders = entries.some((entry) =>
      Array.isArray(entry.children),
    );
    const summary: LibraryFolderSummary = {
      mediaCount: media.length,
      coverPath: cover?.path,
      coverKind: cover ? getMediaKind(entryName(cover)) || 'image' : undefined,
      platform: hasSubFolders ? 'pawchive' : 'twitter',
    };
    folderSummaryCache.set(dir, summary);
    return summary;
  } catch (err) {
    log().warn('summarizeFolder failed', dir, err);
    folderSummaryCache.set(dir, null);
    return null;
  }
}

/** 扫描一级文件夹并汇总（封面/媒体数），失败的条目被丢弃 */
export async function summarizeFolders(
  folders: { name: string; path: string }[],
  refresh = false,
  onEach?: (folder: LibraryRootFolder) => void,
): Promise<LibraryRootFolder[]> {
  const summaries = await mapLimit(folders, 4, async (folder) =>
    summarizeFolder(folder.path, refresh),
  );
  const result: LibraryRootFolder[] = [];
  folders.forEach((folder, index) => {
    const summary = summaries[index];
    if (!summary) return;
    const merged = { ...folder, ...summary };
    result.push(merged);
    onEach?.(merged);
  });
  return result;
}

/** 扫描目录：递归媒体文件 + 直接子文件夹汇总（一次 readDir 完成） */
export async function scanDirectory(dir: string): Promise<DirectoryContent> {
  const entries = await fs.readDir(dir, { recursive: true });
  const directDirs = entries.filter((entry) => Array.isArray(entry.children));

  const files = flattenLeaves(entries)
    .filter((entry) => isMediaFile(entryName(entry)))
    .map(toLibraryFile)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const folders = directDirs
    .map((entry): LibrarySubFolder => {
      const media = flattenLeaves(entry.children as FileEntry[]).filter((e) =>
        isMediaFile(entryName(e)),
      );
      const cover = pickCover(media);
      return {
        name: entryName(entry),
        path: entry.path,
        mediaCount: media.length,
        coverPath: cover?.path,
        coverKind: cover
          ? getMediaKind(entryName(cover)) || 'image'
          : undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return { files, folders };
}
