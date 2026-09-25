/* eslint-disable react/prop-types */
import { EyeOutlined, LoadingOutlined } from '@ant-design/icons';
import { Image } from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import { toAssetUrl } from '../../utils/asset';
import {
  generateImageThumbUrl,
  getCachedThumbUrl,
} from '../../utils/thumbnail';

interface Props {
  filePath?: string;
  alt: string;
  /** 图片元素 class（尺寸/裁剪） */
  className?: string;
  /** 外层容器 class（决定占位尺寸） */
  wrapperClassName?: string;
  /** 是否接入 antd Image 全屏预览（PreviewGroup） */
  preview?: boolean;
}

/**
 * 全局共享的 IntersectionObserver：避免「每张缩略图一个 observer」（长列表可达上千个）。
 * 元素进入视口即回调一次并停止观察。
 */
type VisibleCb = () => void;
const visibleCallbacks = new Map<Element, VisibleCb>();
let sharedObserver: IntersectionObserver | null = null;

function getSharedObserver(): IntersectionObserver {
  if (sharedObserver) return sharedObserver;
  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const cb = visibleCallbacks.get(entry.target);
        if (cb) {
          visibleCallbacks.delete(entry.target);
          sharedObserver?.unobserve(entry.target);
          cb();
        }
      }
    },
    { rootMargin: '400px' },
  );
  return sharedObserver;
}

function observeOnce(el: Element, cb: VisibleCb): () => void {
  visibleCallbacks.set(el, cb);
  getSharedObserver().observe(el);
  return () => {
    visibleCallbacks.delete(el);
    sharedObserver?.unobserve(el);
  };
}

/**
 * 本地图片缩略图：优先用磁盘缓存，命中即秒开；
 * 未命中时进入视口才解码生成（并发受限），并写回缓存目录。
 *
 * 注意：preview 模式下**始终挂载 antd Image**（缩略图未就绪时用占位层覆盖），
 * 以保证 PreviewGroup 的注册顺序与文件顺序一致（右侧信息条按 index 取文件）。
 */
export const LocalThumb: React.FC<Props> = ({
  filePath,
  alt,
  className,
  wrapperClassName,
  preview,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    setSrc(undefined);
    setVisible(false);
    if (!filePath) return;
    const el = containerRef.current;
    if (!el) return;
    return observeOnce(el, () => setVisible(true));
  }, [filePath]);

  useEffect(() => {
    if (!filePath || !visible) return;
    let cancelled = false;
    (async () => {
      const cached = await getCachedThumbUrl(filePath);
      if (cancelled) return;
      if (cached) {
        setSrc(cached);
        return;
      }
      const generated = await generateImageThumbUrl(filePath);
      if (cancelled) return;
      setSrc(generated || toAssetUrl(filePath));
    })();
    return () => {
      cancelled = true;
    };
  }, [filePath, visible]);

  const placeholder = (
    <div
      className={`flex items-center justify-center bg-gray-100 text-gray-400 ${
        wrapperClassName || 'w-full h-full'
      }`}
    >
      {filePath ? <LoadingOutlined /> : '无图'}
    </div>
  );

  return (
    <div ref={containerRef} className={wrapperClassName || 'w-full h-full'}>
      {preview ? (
        <div className="relative w-full h-full">
          <Image
            src={src}
            alt={alt}
            className={className}
            wrapperClassName="w-full h-full"
            preview={{
              src: filePath ? toAssetUrl(filePath) : undefined,
              mask: <EyeOutlined />,
            }}
          />
          {!src && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 text-gray-400">
              {filePath ? <LoadingOutlined /> : '无图'}
            </div>
          )}
        </div>
      ) : src ? (
        <img src={src} alt={alt} loading="lazy" className={className} />
      ) : (
        placeholder
      )}
    </div>
  );
};
