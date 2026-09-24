/* eslint-disable react/prop-types */
import { FolderFilled, PlayCircleFilled } from '@ant-design/icons';
import React from 'react';
import { LibraryMediaKind } from '../../utils/library';
import { LocalThumb } from './LocalThumb';

interface Props {
  name: string;
  coverPath?: string;
  coverKind?: LibraryMediaKind;
  /** 图片元素 class */
  className?: string;
  /** 外层容器 class（尺寸） */
  wrapperClassName?: string;
}

/** 文件夹封面：图片走缩略图缓存，视频/无媒体降级为占位图标 */
export const FolderCover: React.FC<Props> = ({
  name,
  coverPath,
  coverKind,
  className,
  wrapperClassName,
}) => {
  const wrapper = wrapperClassName || 'w-full h-full';

  if (coverPath && coverKind === 'image') {
    return (
      <LocalThumb
        filePath={coverPath}
        alt={name}
        className={className}
        wrapperClassName={wrapper}
      />
    );
  }

  if (coverPath && coverKind === 'video') {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gray-900 text-gray-300 ${wrapper}`}
      >
        <PlayCircleFilled className="text-4xl" />
        <span className="mt-1 text-xs">视频</span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center bg-gray-100 text-gray-400 ${wrapper}`}
    >
      <FolderFilled className="text-4xl" />
      <span className="mt-1 text-xs">无媒体</span>
    </div>
  );
};
