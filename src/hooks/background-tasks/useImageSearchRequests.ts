import { invoke } from '@tauri-apps/api';
import { useEffect } from 'react';
import { bestOpenUrl, reverseSearch } from '../../services/image-search';
import { useSettingsStore } from '../../stores/settings';
import { openUrl } from '../../utils/shell';

/**
 * 处理来自资源管理器右键的「以图搜图」请求：
 * 若已有实例在运行，二次启动会把图片路径转发过来；这里轮询取出，用设置里的引擎搜图并打开结果。
 */
export function useImageSearchRequests() {
  useEffect(() => {
    if (!('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) return;
    let alive = true;
    const tick = async () => {
      try {
        const path = await invoke<string | null>('take_pending_image_search');
        if (!path || !alive) return;
        const engine =
          useSettingsStore.getState().imageSearch?.engine || 'google_lens';
        const r = await reverseSearch(path, engine);
        const url = bestOpenUrl(r);
        if (url) await openUrl(url);
      } catch (err) {
        log.warn('处理以图搜图请求失败', err);
      }
    };
    const timer = setInterval(() => void tick(), 1500);
    void tick();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
}
