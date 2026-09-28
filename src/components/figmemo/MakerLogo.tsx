/* eslint-disable react/prop-types */
import React from 'react';
import { useMakerLogo } from '../../hooks/useMakerLogo';

/** 厂商图标：无来源/加载中/失败时用首字母占位 */
export const MakerLogo: React.FC<{
  name: string;
  size?: number;
  className?: string;
}> = ({ name, size = 20, className }) => {
  const src = useMakerLogo(name);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={`shrink-0 rounded object-cover bg-gray-50 ${className || ''}`}
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      className={`shrink-0 inline-flex items-center justify-center rounded bg-gray-100 text-gray-400 leading-none ${className || ''}`}
    >
      {name.slice(0, 1)}
    </span>
  );
};
