import { useEffect, useState } from 'react';
import { request } from '../ipc/network';

const blobCache = new Map<string, string>();

/**
 * 经 Rust 后端（按设置走代理）拉取远程图片，返回 blob URL。
 * 用于头像等外链图片，避免 WebView 直连被墙/走不到代理导致裂图。
 * 拉取失败时回退为原始直连 URL。
 */
export function useRemoteImageSrc(url?: string): string | undefined {
  const [src, setSrc] = useState<string | undefined>(() =>
    url ? blobCache.get(url) : undefined,
  );

  useEffect(() => {
    if (!url) {
      setSrc(undefined);
      return;
    }
    const cached = blobCache.get(url);
    if (cached) {
      setSrc(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await request({
          method: 'GET',
          url,
          responseType: 'binary',
          maxRetry: 1,
        });
        const bytes = res.body as number[];
        const blobUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
        blobCache.set(url, blobUrl);
        if (!cancelled) setSrc(blobUrl);
      } catch (err) {
        log.warn('远程图片经后端拉取失败，回退直连', err);
        if (!cancelled) setSrc(url);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return src;
}
