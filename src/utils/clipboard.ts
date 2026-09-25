import { fs } from '@tauri-apps/api';
import { request } from '../ipc/network';

/** bytes → PNG → 剪贴板（远程/本地共用） */
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

/**
 * 把远程图片复制到系统剪贴板（以 PNG 写入，兼容性最好）。
 * 经 Rust 后端取字节（走代理），再经 createImageBitmap + canvas 转 PNG，避开 <img> 跨源 canvas 污染。
 */
export async function copyImageUrlToClipboard(url: string): Promise<void> {
  const res = await request({
    method: 'GET',
    url,
    responseType: 'binary',
    maxRetry: 1,
  });
  await writeImageBytesToClipboard(new Uint8Array(res.body as number[]));
}

/** 把本地图片文件复制到系统剪贴板（本地优先时用，不联网） */
export async function copyLocalImageToClipboard(
  filePath: string,
): Promise<void> {
  const bytes = await fs.readBinaryFile(filePath);
  await writeImageBytesToClipboard(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as number[]),
  );
}
