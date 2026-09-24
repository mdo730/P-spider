import { fs } from '@tauri-apps/api';
import { deleteCachedThumb } from '../utils/thumbnail';

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('LIB');
  return _log;
}

export interface DeleteResult {
  deleted: number;
  failed: number;
}

/**
 * 批量删除本地文件，并清理对应缩略图缓存。
 * 不抛错：逐项统计成功/失败，便于批量操作后统一提示。
 */
export async function deleteLibraryFiles(
  paths: string[],
): Promise<DeleteResult> {
  let deleted = 0;
  let failed = 0;
  for (const path of paths) {
    try {
      await fs.removeFile(path);
      await deleteCachedThumb(path);
      deleted += 1;
    } catch (err) {
      failed += 1;
      log().error('删除文件失败', path, err);
    }
  }
  return { deleted, failed };
}
