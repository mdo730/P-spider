import {
  CopyOutlined,
  LinkOutlined,
  SearchOutlined,
  SelectOutlined,
} from '@ant-design/icons';
import { App, Menu } from 'antd';
import React, { useEffect, useState } from 'react';
import { openUrl } from '../utils/shell';

interface TextMenuState {
  x: number;
  y: number;
  text: string;
  anchor?: string;
  root: HTMLElement | null;
}

/**
 * 选中文字后的右键菜单：复制 / 全选 / 用选中文字搜索 Hpoi / 用选中文字搜索（Google）/ 打开链接。
 * 用法：在容器 onContextMenu 里调用 openTextMenu(e)；无选中文字时返回 false（交给调用方处理）。
 */
export function useTextSelectionMenu(): {
  openTextMenu: (e: React.MouseEvent) => boolean;
  textMenu: React.ReactNode;
} {
  const { message } = App.useApp();
  const [state, setState] = useState<TextMenuState | null>(null);

  useEffect(() => {
    if (!state) return;
    const close = () => setState(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [state]);

  const openTextMenu = (e: React.MouseEvent): boolean => {
    const text = (window.getSelection()?.toString() || '').trim();
    if (!text) return false;
    e.preventDefault();
    const a = (e.target as HTMLElement).closest('a');
    setState({
      x: e.clientX,
      y: e.clientY,
      text,
      anchor: a?.getAttribute('href') || undefined,
      root: e.currentTarget as HTMLElement,
    });
    return true;
  };

  const selectAll = () => {
    const root = state?.root;
    if (!root) return;
    const range = document.createRange();
    range.selectNodeContents(root);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const textMenu = state ? (
    <div
      className="fixed z-[1000]"
      style={{ left: state.x, top: state.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Menu
        className="min-w-[11rem] rounded-md border-[1px] border-gray-200 shadow-lg"
        items={[
          { key: 'copy', label: '复制', icon: <CopyOutlined /> },
          { key: 'selectAll', label: '全选', icon: <SelectOutlined /> },
          { type: 'divider' as const },
          {
            key: 'hpoi',
            label: '用选中文字搜索 Hpoi',
            icon: <SearchOutlined />,
          },
          ...(state.anchor
            ? [
                { type: 'divider' as const },
                {
                  key: 'openLink',
                  label: '打开链接',
                  icon: <LinkOutlined />,
                },
              ]
            : []),
        ]}
        onClick={async ({ key }) => {
          const { text, anchor } = state;
          try {
            if (key === 'copy') {
              await navigator.clipboard.writeText(text);
              message.success('已复制');
            } else if (key === 'selectAll') {
              selectAll();
              return;
            } else if (key === 'hpoi') {
              openUrl(
                `https://www.hpoi.net/search?keyword=${encodeURIComponent(
                  text,
                )}&category=100`,
              );
            } else if (key === 'openLink' && anchor) {
              openUrl(anchor);
            }
          } catch (err: any) {
            message.error(err?.message || '操作失败');
          }
          setState(null);
        }}
      />
    </div>
  ) : null;

  return { openTextMenu, textMenu };
}
