import { fs, invoke, path } from '@tauri-apps/api';
import { request } from '../ipc/network';

export type SplitDirection = 'horizontal' | 'vertical';

/** 取图片字节：本地路径直接读；http(s) 走 Rust 代理请求 */
async function loadImageBytes(src: string): Promise<Uint8Array> {
  if (/^https?:\/\//i.test(src)) {
    const res = await request({
      method: 'GET',
      url: src,
      responseType: 'binary',
      maxRetry: 1,
    });
    return new Uint8Array(res.body as number[]);
  }
  const bytes = await fs.readBinaryFile(src);
  return bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes as number[]);
}

/**
 * 把图片按方向切成 N 条，写入系统剪贴板（以「文件列表」形式，粘贴即得 N 张图）。
 * horizontal=左右切（竖条）；vertical=上下切（横条）。src 可为本地路径或 http(s) URL。
 * 切片写到系统临时目录 `p-spider-split`（每次清除重建，非保存目录），返回条数。
 */
export async function copySplitImageToClipboard(
  src: string,
  direction: SplitDirection,
  parts: number,
): Promise<number> {
  const n = Math.max(2, Math.min(20, Math.floor(parts) || 2));

  const bytes = await loadImageBytes(src);
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const dir = await path.join(await path.appCacheDir(), 'split-cache');
  try {
    if (await fs.exists(dir)) {
      await fs.removeDir(dir, { recursive: true });
    }
    await fs.createDir(dir, { recursive: true });

    const { width: W, height: H } = bitmap;
    const paths: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const sx = direction === 'horizontal' ? Math.round((W * i) / n) : 0;
      const ex = direction === 'horizontal' ? Math.round((W * (i + 1)) / n) : W;
      const sy = direction === 'vertical' ? Math.round((H * i) / n) : 0;
      const ey = direction === 'vertical' ? Math.round((H * (i + 1)) / n) : H;
      const w = Math.max(1, ex - sx);
      const h = Math.max(1, ey - sy);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建 canvas 上下文');
      ctx.drawImage(bitmap, sx, sy, w, h, 0, 0, w, h);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('转换图片失败'))),
          'image/png',
        );
      });

      const out = await path.join(dir, `part_${i + 1}.png`);
      await fs.writeBinaryFile(out, new Uint8Array(await blob.arrayBuffer()));
      paths.push(out);
    }

    await invoke('copy_files_to_clipboard', { paths });
    return n;
  } finally {
    bitmap.close?.();
  }
}
