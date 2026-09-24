import { invoke } from '@tauri-apps/api';

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('LIB');
  return _log;
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
