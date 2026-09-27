import { invoke } from '@tauri-apps/api';
import { useEffect, useState } from 'react';
import { useAppStateStore } from '../stores/app-state';
import { useSettingsStore } from '../stores/settings';

let portPromise: Promise<number | null> | null = null;
function getPort(): Promise<number | null> {
  if (!portPromise) {
    portPromise = invoke<number>('media_proxy_port').catch(() => null);
  }
  return portPromise;
}

/** 当前应使用的代理地址（与 ipc/network 一致） */
function currentProxy(): string {
  const s = useSettingsStore.getState();
  if (!s.proxy.enable) return '';
  return s.proxy.useSystem
    ? useAppStateStore.getState().systemProxyUrl || ''
    : s.proxy.url || '';
}

export interface RemoteVideoState {
  src?: string;
  loading: boolean;
  failed: boolean;
}

/**
 * 把远程视频（如未下载的转贴视频）交给**本地流式代理**（`media_proxy_port`）播放：
 * 经应用代理转发且支持 Range → 边下边播、可拖动。非 Tauri 环境回退直连。
 */
export function useRemoteVideo(url?: string): RemoteVideoState {
  const [state, setState] = useState<RemoteVideoState>({
    loading: false,
    failed: false,
  });

  useEffect(() => {
    if (!url) {
      setState({ loading: false, failed: false });
      return;
    }
    let cancelled = false;
    setState({ loading: true, failed: false });
    (async () => {
      const port = await getPort();
      if (cancelled) return;
      if (!port) {
        // 非 Tauri（浏览器预览）或代理未启动 → 直连
        setState({ src: url, loading: false, failed: false });
        return;
      }
      const src = `http://127.0.0.1:${port}/media?u=${encodeURIComponent(
        url,
      )}&p=${encodeURIComponent(currentProxy())}`;
      setState({ src, loading: false, failed: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
