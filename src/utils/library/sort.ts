import { LibraryFile } from './scan';

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
