import { invoke } from '@tauri-apps/api';
import { useAppStateStore } from '../stores/app-state';
import { useSettingsStore } from '../stores/settings';

/** 本地流式代理端口（Rust media_proxy_port，懒启动、只请求一次） */
let port: number | null = null;
let started = false;

export function ensureMediaProxy(): void {
  if (started) return;
  started = true;
  invoke<number>('media_proxy_port')
    .then((p) => {
      port = p;
    })
    .catch(() => {
      port = null;
    });
}

function currentProxy(): string {
  const s = useSettingsStore.getState();
  if (!s.proxy.enable) return '';
  return s.proxy.useSystem
    ? useAppStateStore.getState().systemProxyUrl || ''
    : s.proxy.url || '';
}

/** 把远程媒体 URL 转成经本地代理（走应用代理、支持 Range）的 http://127.0.0.1 地址；未就绪则原样返回 */
export function mediaProxyUrl(url: string): string {
  if (!port) return url;
  return `http://127.0.0.1:${port}/media?u=${encodeURIComponent(
    url,
  )}&p=${encodeURIComponent(currentProxy())}`;
}
