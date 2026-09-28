import { fs, path } from '@tauri-apps/api';
import { useEffect, useState } from 'react';
import { request } from '../ipc/network';
import { makerLogoSource } from '../services/maker-logo';

const LOGO_SIZE = 64;
const memCache = new Map<string, string>();

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('LOGO');
  return _log;
}

async function logosDir(): Promise<string> {
  return await path.join(await path.appDataDir(), 'maker-logos');
}

/** 无 hpoi id 时用名称哈希做缓存文件名（ASCII 安全、稳定） */
function hashName(name: string): string {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** 居中裁剪为正方形再缩到 size×size，输出 webp（省体积） */
async function toSquareWebp(
  bytes: number[],
  size: number,
): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
  const side = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - side) / 2;
  const sy = (bmp.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas ctx');
  ctx.drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
  bmp.close?.();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9),
  );
  if (!blob) throw new Error('toBlob failed');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 厂商图标：hpoi 封面 → 居中裁剪 64×64 webp。
 * 首次经后端拉取（直连 + Referer 防防盗链），写入 %APPDATA%\p-spider\maker-logos\<id>.webp，
 * 之后直接读本地缓存。返回 blob URL；无来源/失败返回 undefined（由调用方占位）。
 */
export function useMakerLogo(name?: string): string | undefined {
  const [src, setSrc] = useState<string | undefined>(() =>
    name ? memCache.get(name) : undefined,
  );

  useEffect(() => {
    if (!name) {
      setSrc(undefined);
      return;
    }
    const cached = memCache.get(name);
    if (cached) {
      setSrc(cached);
      return;
    }
    const info = makerLogoSource(name);
    if (!info) {
      setSrc(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      const key = info.id ? String(info.id) : `n${hashName(name)}`;
      const file = await path.join(await logosDir(), `${key}.webp`);
      try {
        if (await fs.exists(file)) {
          const bytes = await fs.readBinaryFile(file);
          const url = URL.createObjectURL(new Blob([bytes]));
          memCache.set(name, url);
          if (!cancelled) setSrc(url);
          return;
        }
      } catch {
        // 缓存损坏则重新拉取
      }
      try {
        const res = await request({
          method: 'GET',
          url: info.url,
          responseType: 'binary',
          maxRetry: 2,
          bypassProxy: true,
          headers: { Referer: 'https://www.hpoi.net/' },
        });
        const bytes = await toSquareWebp(res.body as number[], LOGO_SIZE);
        const dir = await logosDir();
        if (!(await fs.exists(dir))) {
          await fs.createDir(dir, { recursive: true });
        }
        await fs.writeBinaryFile(file, bytes);
        const url = URL.createObjectURL(new Blob([bytes]));
        memCache.set(name, url);
        if (!cancelled) setSrc(url);
      } catch (err) {
        log().warn('maker logo fetch failed', name, err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name]);

  return src;
}
