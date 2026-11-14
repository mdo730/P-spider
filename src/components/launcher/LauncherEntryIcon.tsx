import {
  AppstoreOutlined,
  FolderFilled,
  LinkOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api';
import React, { useEffect, useState } from 'react';
import { LauncherEntry } from '../../stores/launcher';
import { toAssetUrl } from '../../utils/asset';

type IconSource = Pick<
  LauncherEntry,
  'path' | 'kind' | 'iconMode' | 'customIcon'
>;

const iconCache = new Map<string, Promise<string>>();

function isTauri(): boolean {
  return '__TAURI__' in window || '__TAURI_INTERNALS__' in window;
}

function loadAutoIcon(path: string): Promise<string> {
  let pending = iconCache.get(path);
  if (!pending) {
    pending = invoke<string>('launcher_icon', { path }).then((file) =>
      toAssetUrl(file),
    );
    iconCache.set(path, pending);
    pending.catch(() => iconCache.delete(path));
  }
  return pending;
}

interface Props {
  entry: IconSource;
  size?: number;
  className?: string;
  /** 填满父容器并按 cover 裁切（卡片用） */
  fill?: boolean;
}

/** 启动器图标：自定义图片优先，否则提取系统图标，失败回退内置图标 */
export const LauncherEntryIcon: React.FC<Props> = ({
  entry,
  size = 56,
  className,
  fill,
}) => {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let alive = true;
    setSrc('');
    if (entry.iconMode === 'custom' && entry.customIcon) {
      setSrc(toAssetUrl(entry.customIcon));
      return () => {
        alive = false;
      };
    }
    if (!isTauri()) {
      return () => {
        alive = false;
      };
    }
    loadAutoIcon(entry.path)
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        if (alive) setSrc('');
      });
    return () => {
      alive = false;
    };
  }, [entry.iconMode, entry.customIcon, entry.path]);

  if (src) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        style={fill ? undefined : { width: size, height: size }}
        className={`${fill ? 'h-full w-full' : ''} ${
          fill ? 'object-cover' : 'object-contain'
        } ${className || ''}`}
      />
    );
  }

  return (
    <span
      className={`flex items-center justify-center text-gray-400 ${
        fill ? 'h-full w-full' : ''
      } ${className || ''}`}
      style={
        fill
          ? { fontSize: size }
          : { width: size, height: size, fontSize: size * 0.6 }
      }
    >
      {entry.kind === 'folder' ? (
        <FolderFilled />
      ) : entry.kind === 'shortcut' ? (
        <LinkOutlined />
      ) : (
        <AppstoreOutlined />
      )}
    </span>
  );
};
