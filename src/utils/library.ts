import { fs, invoke } from '@tauri-apps/api';
import type { FileEntry } from '@tauri-apps/api/fs';
import { convertFileSrc } from '@tauri-apps/api/tauri';

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

/** 本地文件 → asset 协议 URL（Tauri 环境外返回空串，浏览器预览时降级为占位） */
export function toAssetUrl(filePath: string): string {
  try {
    return convertFileSrc(filePath);
  } catch (err) {
    log().warn('convertFileSrc failed', filePath, err);
    return '';
  }
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

/** 列出 saveDirBase 下的一级文件夹（非递归；非媒体文件在此被过滤） */
export async function listRootFolders(
  rootDir: string,
): Promise<{ name: string; path: string }[]> {
  const entries = await fs.readDir(rootDir, { recursive: false });
  return entries
    .map((entry) => ({ name: entryName(entry), path: entry.path }))
    .filter((folder) => !isMediaFile(folder.name));
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
    const summary: LibraryFolderSummary = {
      mediaCount: media.length,
      coverPath: cover?.path,
      coverKind: cover ? getMediaKind(entryName(cover)) || 'image' : undefined,
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

export interface DirectoryContent {
  /** 递归收集的全部媒体文件（平铺模式用） */
  files: LibraryFile[];
  /** 直接子文件夹（按文件夹模式用，带封面与媒体数） */
  folders: LibrarySubFolder[];
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

/** 批量读取路径修改时间（毫秒）；失败返回等长数组，元素为 null */
export async function fetchMtimes(paths: string[]): Promise<(number | null)[]> {
  if (paths.length === 0) return [];
  try {
    return await invoke<(number | null)[]>('get_path_mtimes', { paths });
  } catch (err) {
    log().warn('fetchMtimes failed', err);
    return paths.map(() => null);
  }
}

export interface LibraryFolderStats {
  fileCount: number;
  totalBytes: number;
}

/** 递归统计文件夹的文件总数与占用字节数 */
export async function fetchFolderStats(
  path: string,
): Promise<LibraryFolderStats> {
  return await invoke<LibraryFolderStats>('get_folder_stats', { path });
}

/** 人类可读的文件大小 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** index;
  const digits = index === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

export type FolderSortKey =
  | 'name-asc'
  | 'name-desc'
  | 'count-desc'
  | 'count-asc'
  | 'mtime-desc'
  | 'mtime-asc';

export const FOLDER_SORT_OPTIONS: { label: string; value: FolderSortKey }[] = [
  { label: '名称 A→Z', value: 'name-asc' },
  { label: '名称 Z→A', value: 'name-desc' },
  { label: '日期 新→旧', value: 'mtime-desc' },
  { label: '日期 旧→新', value: 'mtime-asc' },
  { label: '媒体数 多→少', value: 'count-desc' },
  { label: '媒体数 少→多', value: 'count-asc' },
];

function compareName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** 排序文件夹（返回新数组） */
export function sortFolders<
  T extends { name: string; mediaCount: number; mtime?: number },
>(folders: T[], key: FolderSortKey): T[] {
  const sorted = [...folders];
  switch (key) {
    case 'name-desc':
      sorted.sort((a, b) => compareName(b.name, a.name));
      break;
    case 'mtime-desc':
      sorted.sort(
        (a, b) =>
          (b.mtime || 0) - (a.mtime || 0) || compareName(a.name, b.name),
      );
      break;
    case 'mtime-asc':
      sorted.sort(
        (a, b) =>
          (a.mtime || 0) - (b.mtime || 0) || compareName(a.name, b.name),
      );
      break;
    case 'count-desc':
      sorted.sort(
        (a, b) => b.mediaCount - a.mediaCount || compareName(a.name, b.name),
      );
      break;
    case 'count-asc':
      sorted.sort(
        (a, b) => a.mediaCount - b.mediaCount || compareName(a.name, b.name),
      );
      break;
    case 'name-asc':
    default:
      sorted.sort((a, b) => compareName(a.name, b.name));
  }
  return sorted;
}

export type FileSortKey =
  | 'name-asc'
  | 'name-desc'
  | 'mtime-desc'
  | 'mtime-asc'
  | 'type';

export const FILE_SORT_OPTIONS: { label: string; value: FileSortKey }[] = [
  { label: '名称 A→Z', value: 'name-asc' },
  { label: '名称 Z→A', value: 'name-desc' },
  { label: '日期 新→旧', value: 'mtime-desc' },
  { label: '日期 旧→新', value: 'mtime-asc' },
  { label: '类型（图片在前）', value: 'type' },
];

/** 排序文件（返回新数组） */
export function sortFiles(
  files: LibraryFile[],
  key: FileSortKey,
): LibraryFile[] {
  const sorted = [...files];
  switch (key) {
    case 'name-desc':
      sorted.sort((a, b) => compareName(b.name, a.name));
      break;
    case 'mtime-desc':
      sorted.sort(
        (a, b) =>
          (b.mtime || 0) - (a.mtime || 0) || compareName(a.name, b.name),
      );
      break;
    case 'mtime-asc':
      sorted.sort(
        (a, b) =>
          (a.mtime || 0) - (b.mtime || 0) || compareName(a.name, b.name),
      );
      break;
    case 'type':
      sorted.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'image' ? -1 : 1;
        return compareName(a.name, b.name);
      });
      break;
    case 'name-asc':
    default:
      sorted.sort((a, b) => compareName(a.name, b.name));
  }
  return sorted;
}
