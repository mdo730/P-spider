import { invoke } from '@tauri-apps/api';

/** 缓存/存储统计与清理（日志 / 缩略图 / WD14 临时图 / 旧备份） */

export interface StorageUsage {
  logs: number;
  thumb: number;
  wd14: number;
  split: number;
  backups: number;
}

export async function getStorageUsage(): Promise<StorageUsage> {
  try {
    return await invoke<StorageUsage>('storage_usage');
  } catch {
    return { logs: 0, thumb: 0, wd14: 0, split: 0, backups: 0 };
  }
}

/** 清理上述缓存，返回释放字节数 */
export async function clearStorage(): Promise<number> {
  return invoke<number>('clear_storage');
}

export function formatStorage(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  if (bytes >= 1024 * 1024 * 1024)
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export function storageTotal(u: StorageUsage): number {
  return u.logs + u.thumb + u.wd14 + u.split + u.backups;
}
