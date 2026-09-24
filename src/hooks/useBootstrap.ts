import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api';
import {
  LogicalSize,
  appWindow,
  currentMonitor,
  primaryMonitor,
} from '@tauri-apps/api/window';
import { aria2 } from '../utils/aria2';
import { useSettingsStore } from '../stores/settings';

/**
 * 按当前显示器工作区自适应窗口尺寸并居中。
 * 解决高 DPI/多屏下默认 1280x920 超出可用高度、底部被任务栏遮挡的问题。
 */
async function fitWindowToMonitor(): Promise<void> {
  const monitor = (await currentMonitor()) || (await primaryMonitor());
  if (!monitor) return;
  const scale = monitor.scaleFactor || 1;
  const workWidth = monitor.size.width / scale;
  const workHeight = monitor.size.height / scale;
  const width = Math.min(1280, Math.round(workWidth * 0.92));
  const height = Math.min(920, Math.round(workHeight * 0.85));
  await appWindow.setSize(new LogicalSize(width, height));
  await appWindow.center();
}

export function useBootstrap() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      // 浏览器预览模式：非 Tauri 环境下跳过依赖 Tauri 的启动流程，方便纯前端预览 UI
      const isTauri = '__TAURI__' in window || '__TAURI_INTERNALS__' in window;
      if (!isTauri) {
        log.info('Running in browser preview mode, skip bootstrap');
        setReady(true);
        return;
      }

      interface BootConfig {
        name: string;
        fn: () => Promise<void>;
      }
      const flows: BootConfig[] = [
        {
          name: 'window',
          async fn() {
            // 窗口自适应失败不影响启动
            try {
              await fitWindowToMonitor();
            } catch (err) {
              log.warn('窗口自适应失败', err);
            }
          },
        },
        {
          name: 'aria',
          async fn() {
            try {
              await aria2.bootstrap();
            } catch (err) {
              log.error(err);
              throw new Error('启动 Aria 失败 ');
            }
          },
        },
        {
          name: 'autostart',
          async fn() {
            // 根据设置同步开机自启动注册表状态（失败不影响启动）
            try {
              const autoStart = useSettingsStore.getState().app.autoStart;
              await invoke('set_auto_start', { enabled: autoStart });
            } catch (err) {
              log.error('Sync autostart failed', err);
            }
          },
        },
      ];

      for (const item of flows) {
        try {
          log.info(`Boot ${item.name}`);
          await item.fn();
        } catch (err: any) {
          log.error(`UI Boot error name=${item.name}`, err);
          setError(typeof err === 'string' ? err : err?.message);
          return;
        }
      }

      setReady(true);
    })();
  }, []);

  return { ready, error };
}
