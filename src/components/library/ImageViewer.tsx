/* eslint-disable react/prop-types */
import { CloseOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Dropdown, MenuProps, Spin } from 'antd';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { toAssetUrl } from '../../utils/asset';

export interface ViewerImage {
  path: string;
  name: string;
}

interface Props {
  images: ViewerImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** 右侧让位宽度（px），如推文信息条展开时传 320，使图片在剩余区域居中 */
  rightInset?: number;
  /** 右键菜单（文件操作）；查看器会在前面追加「放大/缩小/旋转/重置」 */
  menuFor?: (image: ViewerImage) => MenuProps;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.15;
const DRAG_THRESHOLD = 6;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * 本地库自研图片查看器（替代 antd 预览）：
 * - 无底部操作栏；缩放/旋转/重置放进右键菜单
 * - 滚轮缩放、按住拖动自由平移（不回弹）
 * - 点击空白（或图片本身）退出，长图也好退；Esc 关闭
 * - 按右侧信息条宽度让位，使图片在剩余区域居中
 */
export const ImageViewer: React.FC<Props> = ({
  images,
  index,
  onIndexChange,
  onClose,
  rightInset = 0,
  menuFor,
}) => {
  const [scale, setScale] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const areaRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ dragging: false, lastX: 0, lastY: 0, moved: 0 });
  // 供只绑定一次的 wheel 监听读取最新值，避免闭包过期
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  const reset = useCallback(() => {
    setScale(1);
    setRotate(0);
    setOffset({ x: 0, y: 0 });
  }, []);

  const go = useCallback(
    (dir: number) => {
      if (images.length <= 1) return;
      onIndexChange((index + dir + images.length) % images.length);
    },
    [images.length, index, onIndexChange],
  );

  // 切图时重置视图与加载态
  useEffect(() => {
    reset();
    setLoaded(false);
  }, [index, reset]);

  // 键盘：Esc 关闭，左右切换
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, go]);

  // 滚轮缩放（非 passive 才能 preventDefault）；朝鼠标位置缩放
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const s0 = scaleRef.current;
      const s1 = clampScale(s0 * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
      if (s1 === s0) return;
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const o = offsetRef.current;
      const ratio = s1 / s0;
      setOffset({
        x: cx - ratio * (cx - o.x),
        y: cy - ratio * (cy - o.y),
      });
      setScale(s1);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const img = images[index];
  if (!img) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      dragging: true,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: 0,
    };
    setIsDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.dragging) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.moved += Math.abs(dx) + Math.abs(dy);
    setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
  };
  const onPointerUp = () => {
    drag.current.dragging = false;
    setIsDragging(false);
  };

  const viewItems: MenuProps['items'] = [
    { key: 'view:in', label: '放大' },
    { key: 'view:out', label: '缩小' },
    { key: 'view:left', label: '向左旋转' },
    { key: 'view:right', label: '向右旋转' },
    { key: 'view:reset', label: '重置视图' },
    { type: 'divider' },
  ];
  const base = menuFor?.(img);
  const menu: MenuProps = {
    items: [...viewItems, ...(base?.items || [])],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === 'view:in') setScale((s) => clampScale(s * ZOOM_STEP));
      else if (key === 'view:out') setScale((s) => clampScale(s / ZOOM_STEP));
      else if (key === 'view:left') setRotate((r) => r - 90);
      else if (key === 'view:right') setRotate((r) => r + 90);
      else if (key === 'view:reset') reset();
      else base?.onClick?.({ key, domEvent } as any);
    },
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[1000] bg-black/90 select-none">
      <Dropdown trigger={['contextMenu']} menu={menu}>
        <div
          ref={areaRef}
          className="absolute inset-y-0 left-0 flex items-center justify-center overflow-hidden"
          style={{
            right: rightInset,
            cursor: scale > 1 || offset.x || offset.y ? 'grab' : 'default',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => {
            if (drag.current.moved < DRAG_THRESHOLD) onClose();
          }}
        >
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Spin size="large" />
            </div>
          )}
          <img
            src={toAssetUrl(img.path)}
            alt={img.name}
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
            className="max-w-full max-h-full object-contain"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotate}deg)`,
              transition: isDragging
                ? 'none'
                : 'transform 0.16s cubic-bezier(0.22, 1, 0.36, 1)',
              willChange: 'transform',
            }}
          />
        </div>
      </Dropdown>

      {/* 右上角关闭（让开右侧信息条） */}
      <button
        type="button"
        aria-label="关闭"
        title="关闭 (Esc)"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="fixed top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white/90 hover:bg-black/70 border-0 cursor-pointer"
        style={{ right: rightInset + 16 }}
      >
        <CloseOutlined />
      </button>

      {/* 左右切换 */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label="上一张"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="fixed left-4 top-1/2 -translate-y-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white/90 hover:bg-black/70 border-0 cursor-pointer"
          >
            <LeftOutlined />
          </button>
          <button
            type="button"
            aria-label="下一张"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="fixed top-1/2 -translate-y-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white/90 hover:bg-black/70 border-0 cursor-pointer"
            style={{ right: rightInset + 16 }}
          >
            <RightOutlined />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
};
