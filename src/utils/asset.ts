import { convertFileSrc } from '@tauri-apps/api/tauri';

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('LIB');
  return _log;
}

/** 本地文件 → asset 协议 URL（非 Tauri 环境返回空串，浏览器预览时降级为占位） */
export function toAssetUrl(filePath: string): string {
  try {
    return convertFileSrc(filePath);
  } catch (err) {
    log().warn('convertFileSrc failed', filePath, err);
    return '';
  }
}
