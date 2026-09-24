/* eslint-disable react/prop-types */
import React from 'react';
import { PlatformSource } from '../../platforms';
import pawchiveIcon from '../../assets/platform-icons/pawchive.png';
import xIcon from '../../assets/platform-icons/x.png';

const ICONS: Record<PlatformSource, string> = {
  twitter: xIcon,
  pawchive: pawchiveIcon,
};

interface Props {
  platform?: PlatformSource;
}

/** 文件夹卡片右下角的平台标记（X / Pawchive）；图标为内置静态资源，离线可用 */
export const PlatformBadge: React.FC<Props> = ({ platform }) => {
  if (!platform) return null;
  const label = platform === 'pawchive' ? 'Pawchive' : 'X（推特）';
  return (
    <span
      title={label}
      aria-label={label}
      className="absolute right-1 bottom-1 z-10 flex items-center justify-center w-5 h-5 rounded-full bg-white shadow"
    >
      <img
        src={ICONS[platform]}
        alt={label}
        className="w-3.5 h-3.5 object-contain"
      />
    </span>
  );
};
