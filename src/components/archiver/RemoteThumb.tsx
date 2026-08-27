/* eslint-disable react/prop-types */
import React, { useEffect, useRef, useState } from 'react';
import { request } from '../../ipc/network';

/** 会话级 blob 缓存：同一 URL 只拉一次 */
const blobCache = new Map<string, string>();

interface RemoteThumbProps {
  src?: string;
  alt: string;
  className?: string;
  /** 占位高度（无图/加载中时撑起格子） */
  placeholderClassName?: string;
}

/**
 * 经 Rust 直连（绕过 webview 系统代理）拉取缩略图，转 blob URL 显示。
 * 解决 webview 加载 img.pawchive.pw 走 Clash 代理慢/失败导致裂图的问题。
 * 进入视口才发起请求（懒加载，控制并发）。
 */
export const RemoteThumb: React.FC<RemoteThumbProps> = ({
  src,
  alt,
  className,
  placeholderClassName,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | undefined>(() =>
    src ? blobCache.get(src) : undefined,
  );
  const [failed, setFailed] = useState(false);

  // 进入视口才拉取
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !src) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [src]);

  // 拉图转 blob
  useEffect(() => {
    if (!visible || !src || failed) return;
    const cached = blobCache.get(src);
    if (cached) {
      setBlobUrl(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await request({
          method: 'GET',
          url: src,
          responseType: 'binary',
          bypassProxy: true,
          maxRetry: 1,
        });
        const bytes = res.body as number[];
        const blob = new Blob([new Uint8Array(bytes)]);
        const url = URL.createObjectURL(blob);
        blobCache.set(src, url);
        if (!cancelled) setBlobUrl(url);
      } catch (err) {
        log.warn('RemoteThumb failed', src, err);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, src, failed]);

  const placeholder = (
    <div
      className={`w-full h-full flex items-center justify-center text-gray-400 bg-gray-100 ${
        placeholderClassName || ''
      }`}
    >
      {src && !failed ? '加载中' : '无图'}
    </div>
  );

  return (
    <div ref={containerRef} className="w-full h-full">
      {blobUrl ? (
        <img src={blobUrl} alt={alt} loading="lazy" className={className} />
      ) : (
        placeholder
      )}
    </div>
  );
};
