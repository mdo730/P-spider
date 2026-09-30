import { fs, invoke } from '@tauri-apps/api';
import { request } from '../ipc/network';
import { useAppStateStore } from '../stores/app-state';
import { useSettingsStore } from '../stores/settings';

const isTauri = () => '__TAURI__' in window || '__TAURI_INTERNALS__' in window;

/** 应用当前代理设置 → invoke 参数 */
function proxyArgs() {
  const s = useSettingsStore.getState();
  return {
    enableProxy: s.proxy.enable,
    proxyUrl: s.proxy.useSystem
      ? useAppStateStore.getState().systemProxyUrl
      : s.proxy.url,
  };
}

// ---- 以下 fallback 仅浏览器预览（无 Tauri）时用；桌面走 Rust 原生写剪贴板 ----

async function writeImageBytesToClipboard(bytes: Uint8Array): Promise<void> {
  if (bytes.length === 0) throw new Error('图片为空');
  const ClipboardItemCtor = (window as any).ClipboardItem;
  if (!navigator.clipboard || !ClipboardItemCtor) {
    throw new Error('当前环境不支持复制图片到剪贴板');
  }
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 上下文');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('转换 PNG 失败'))),
      'image/png',
    );
  });
  await navigator.clipboard.write([
    new ClipboardItemCtor({ 'image/png': pngBlob }),
  ]);
}

/** 复制纯文本（优先 WebView clipboard，失败回退 Tauri 剪贴板插件） */
export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // 回退 Tauri
  }
  const { writeText } = await import('@tauri-apps/api/clipboard');
  await writeText(text);
}

/**
 * 把远程图片复制到系统剪贴板。
 * 桌面：走 Rust 原生写剪贴板（无需窗口聚焦、快）；浏览器预览：回退 WebView API。
 */
export async function copyImageUrlToClipboard(
  url: string,
  headers?: Record<string, string>,
): Promise<void> {
  if (isTauri()) {
    await invoke('copy_image_to_clipboard', {
      url,
      headers: headers ?? null,
      ...proxyArgs(),
    });
    return;
  }
  const res = await request({
    method: 'GET',
    url,
    responseType: 'binary',
    maxRetry: 1,
    headers,
  });
  await writeImageBytesToClipboard(new Uint8Array(res.body as number[]));
}

/** 把本地图片文件复制到系统剪贴板（本地优先时用，不联网） */
export async function copyLocalImageToClipboard(
  filePath: string,
): Promise<void> {
  if (isTauri()) {
    await invoke('copy_image_to_clipboard', { path: filePath });
    return;
  }
  const bytes = await fs.readBinaryFile(filePath);
  await writeImageBytesToClipboard(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as number[]),
  );
}
