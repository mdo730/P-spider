/* eslint-disable react/prop-types */
import { CloseOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { toAssetUrl } from '../../utils/asset';

interface Props {
  path: string;
  index: number;
  total: number;
  rightInset?: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

/**
 * 本地库视频播放器（自绘全屏遮罩，不用 antd Modal）：
 * 左右透明箭头在视频两侧，右上角透明关闭，Esc 关闭，方向键切换。
 */
export const VideoViewer: React.FC<Props> = ({
  path,
  index,
  total,
  rightInset = 0,
  onPrev,
  onNext,
  onClose,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev();
      else if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[1000] flex select-none bg-black/90">
      {/* 播放区（给右侧信息条让位）；点两侧空白退出 */}
      <div
        className="flex min-w-0 flex-1 items-center justify-center gap-2 px-2"
        style={{ marginRight: rightInset }}
        onClick={onClose}
      >
        <button
          type="button"
          aria-label="上一个"
          title="上一个"
          disabled={index <= 0}
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-2xl text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-20 disabled:hover:bg-transparent"
        >
          <LeftOutlined />
        </button>

        <div className="flex min-w-0 flex-1 items-center justify-center">
          <video
            src={toAssetUrl(path)}
            controls
            autoPlay
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-full bg-black"
          />
        </div>

        <button
          type="button"
          aria-label="下一个"
          title="下一个"
          disabled={index >= total - 1}
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-2xl text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-20 disabled:hover:bg-transparent"
        >
          <RightOutlined />
        </button>
      </div>

      {/* 右上角关闭 */}
      <button
        type="button"
        aria-label="关闭"
        title="关闭 (Esc)"
        onClick={onClose}
        className="fixed top-4 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-xl text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        style={{ right: rightInset + 16 }}
      >
        <CloseOutlined />
      </button>
    </div>,
    document.body,
  );
};
