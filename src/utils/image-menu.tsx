import {
  CopyOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  ScissorOutlined,
} from '@ant-design/icons';
import { MenuProps } from 'antd';
import { useSettingsStore } from '../stores/settings';
import {
  copyImageUrlToClipboard,
  copyLocalImageToClipboard,
} from './clipboard';
import { openUrl, showInFolder } from './shell';
import { copySplitImageToClipboard } from './split-image';

export interface ImageMenuCtx {
  /** 本地文件路径（有则「复制图像」走本地，并提供「打开本地储存位置」） */
  localPath?: string;
  /** 远程原图 URL（无本地时「复制图像」用它） */
  remoteUrl?: string;
  /** 原网页 URL */
  postUrl?: string;
}

interface Msg {
  success: (content: string) => void;
  error: (content: string) => void;
}

export const IMAGE_MENU = {
  copy: 'img:copy',
  split: 'img:split',
  reveal: 'img:reveal',
  post: 'img:post',
} as const;

/**
 * 统一的图片右键菜单项：复制图像 / 复制切割图像 / 打开本地储存位置 / 打开原网页。
 * 按可用性显示：无图源则不显示前两项；无本地路径不显示「打开本地储存位置」；无原网页不显示「打开原网页」。
 */
export function imageMenuItems(
  ctx: ImageMenuCtx,
): NonNullable<MenuProps['items']> {
  const split = useSettingsStore.getState().split;
  const hasSrc = !!(ctx.localPath || ctx.remoteUrl);
  return [
    ...(hasSrc
      ? [
          {
            key: IMAGE_MENU.copy,
            label: '复制图像',
            icon: <CopyOutlined />,
          },
          {
            key: IMAGE_MENU.split,
            label: `复制切割图像（${split.parts} 条）`,
            icon: <ScissorOutlined />,
          },
        ]
      : []),
    ...(ctx.localPath
      ? [
          {
            key: IMAGE_MENU.reveal,
            label: '打开本地储存位置',
            icon: <FolderOpenOutlined />,
          },
        ]
      : []),
    ...(ctx.postUrl
      ? [
          {
            key: IMAGE_MENU.post,
            label: '打开原网页',
            icon: <LinkOutlined />,
          },
        ]
      : []),
  ];
}

/** 处理统一图片菜单键；命中（含出错）返回 true，未命中返回 false 交调用方处理扩展项 */
export async function handleImageMenuKey(
  key: string,
  ctx: ImageMenuCtx,
  message: Msg,
): Promise<boolean> {
  try {
    if (key === IMAGE_MENU.copy) {
      if (ctx.localPath) await copyLocalImageToClipboard(ctx.localPath);
      else if (ctx.remoteUrl) await copyImageUrlToClipboard(ctx.remoteUrl);
      else return true;
      message.success('图片已复制到剪贴板');
      return true;
    }
    if (key === IMAGE_MENU.split) {
      const src = ctx.localPath || ctx.remoteUrl;
      if (!src) return true;
      const split = useSettingsStore.getState().split;
      const n = await copySplitImageToClipboard(
        src,
        split.direction,
        split.parts,
      );
      message.success(`已复制 ${n} 条切割图像到剪贴板`);
      return true;
    }
    if (key === IMAGE_MENU.reveal) {
      if (ctx.localPath) await showInFolder(ctx.localPath);
      return true;
    }
    if (key === IMAGE_MENU.post) {
      if (ctx.postUrl) openUrl(ctx.postUrl);
      return true;
    }
    return false;
  } catch (err: any) {
    message.error(err?.message || '操作失败');
    return true;
  }
}
