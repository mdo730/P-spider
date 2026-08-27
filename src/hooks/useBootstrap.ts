import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api';
import { aria2 } from '../utils/aria2';
import { useSettingsStore } from '../stores/settings';

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
