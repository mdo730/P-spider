import { invoke } from '@tauri-apps/api';
import { getCurrent } from '@tauri-apps/api/window';

export interface DropTarget {
  tagId?: string;
  entryId?: string;
}

export function isTauri(): boolean {
  return '__TAURI__' in window || '__TAURI_INTERNALS__' in window;
}

/**
 * 外部文件拖放时，按屏幕光标位置命中标签行 / 卡片。
 * 需要 Rust 命令 `launcher_cursor_position` 提供屏幕物理坐标。
 */
export async function hitTestTarget(): Promise<DropTarget> {
  try {
    const [cursor, inner, scale] = await Promise.all([
      invoke<[number, number]>('launcher_cursor_position'),
      getCurrent().innerPosition(),
      getCurrent().scaleFactor(),
    ]);
    const x = (cursor[0] - inner.x) / scale;
    const y = (cursor[1] - inner.y) / scale;
    const el = document.elementFromPoint(x, y);
    return {
      tagId:
        el
          ?.closest('[data-launcher-tag-id]')
          ?.getAttribute('data-launcher-tag-id') || undefined,
      entryId:
        el
          ?.closest('[data-launcher-entry-id]')
          ?.getAttribute('data-launcher-entry-id') || undefined,
    };
  } catch (err) {
    log.warn('drop 命中检测失败', err);
    return {};
  }
}
