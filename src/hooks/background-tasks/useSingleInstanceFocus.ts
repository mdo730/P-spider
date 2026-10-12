import { invoke } from '@tauri-apps/api';
import { useEffect } from 'react';

/**
 * 处理二次启动的「聚焦」请求：
 * 无参数再次启动 P-Spider（桌面图标/任务栏/restart）时，新进程若发现已有实例在运行，
 * 会转发一个 SHOW 请求后自行退出；这里轮询取出并把主窗口显示到前台。
 */
export function useSingleInstanceFocus() {
  useEffect(() => {
    if (!('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) return;
    let alive = true;
    const tick = async () => {
      try {
        const show = await invoke<boolean>('take_pending_show');
        if (show && alive) await invoke('show_main_window_cmd');
      } catch (err) {
        log.warn('处理单实例聚焦请求失败', err);
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
