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

/**
 * 本地文件的 http 代理地址（支持 Range，WebView 的 <video> 才能解码出帧）。
 * Tauri asset 协议不支持 Range，本地视频取首帧会失败，故走这里；未就绪返回空串。
 */
export function localMediaUrl(filePath: string): string {
  if (!port) return '';
  return `http://127.0.0.1:${port}/local?f=${encodeURIComponent(filePath)}`;
}
