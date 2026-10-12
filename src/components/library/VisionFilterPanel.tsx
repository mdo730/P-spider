import { CloseOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { Button, Segmented } from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import {
  visionCatChipActiveStyle,
  visionCatChipStyle,
} from '../../utils/tag-color';

export type VisionGroup = [
  string,
  { cat: string; zh: string; count: number }[],
];

interface Props {
  open: boolean;
  onClose: () => void;
  groups: VisionGroup[];
  selected: string[];
  onToggle: (key: string) => void;
  rule: 'or' | 'and';
  onRuleChange: (r: 'or' | 'and') => void;
  onClear: () => void;
  subtitle?: string;
  emptyText?: string;
}

const POS_KEY = 'vision-filter-panel-pos';

function loadPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
  return { x: Math.max(40, w - 340), y: 84 };
}

function clampPos(x: number, y: number) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    x: Math.min(Math.max(0, x), Math.max(0, w - 120)),
    y: Math.min(Math.max(0, y), Math.max(0, h - 40)),
  };
}

/**
 * 视觉标签筛选浮窗：可拖动（拖标题栏）、可折叠（收起为一条标题）、可关闭。
 * 位置记忆到 localStorage。用于本地库（文件夹级/文件级）等。
 */
export const VisionFilterPanel: React.FC<Props> = ({
  open,
  onClose,
  groups,
  selected,
  onToggle,
  rule,
  onRuleChange,
  onClear,
  subtitle,
  emptyText,
}) => {
  const [pos, setPos] = useState(loadPos);
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      // ignore
    }
  }, [pos]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setPos((p) => clampPos(p.x, p.y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  const onHeaderDown = (e: React.MouseEvent) => {
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos(clampPos(ev.clientX - d.dx, ev.clientY - d.dy));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!open) return null;

  return (
    <div
      className="fixed z-40 w-[19rem] rounded-md border border-gray-200 bg-white/95 shadow-2xl backdrop-blur"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 cursor-move select-none"
        onMouseDown={onHeaderDown}
      >
        <span className="text-sm font-medium">视觉标签</span>
        {selected.length > 0 && (
          <span className="rounded-full bg-[#1677ff] px-1.5 text-[11px] text-white">
            {selected.length}
          </span>
        )}
        {subtitle && <span className="text-xs text-gray-400">{subtitle}</span>}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center text-gray-400 hover:text-gray-700"
            title={collapsed ? '展开' : '折叠'}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <UpOutlined /> : <DownOutlined />}
          </button>
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center text-gray-400 hover:text-gray-700"
            title="关闭"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onClose}
          >
            <CloseOutlined />
          </button>
        </span>
      </div>

      {!collapsed && (
        <div className="max-h-[60vh] overflow-y-auto p-3 text-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Segmented
              size="small"
              value={rule}
              onChange={(v) => onRuleChange(v as 'or' | 'and')}
              options={[
                { label: '任一', value: 'or' },
                { label: '同时', value: 'and' },
              ]}
            />
            {selected.length > 0 && (
              <Button size="small" onClick={onClear}>
                清空（{selected.length}）
              </Button>
            )}
          </div>
          {groups.length === 0 ? (
            <div className="text-xs text-gray-400">
              {emptyText || '还没有识别结果'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {groups.map(([cat, tags]) => (
                <div key={cat} className="flex items-start gap-2">
                  <span className="w-10 shrink-0 pt-0.5 text-xs text-gray-400">
                    {cat}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => {
                      const key = `${t.cat}|${t.zh}`;
                      const on = selected.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => onToggle(key)}
                          className="rounded-full border px-2 py-0.5 text-xs transition-colors"
                          style={
                            on
                              ? visionCatChipActiveStyle(t.cat)
                              : visionCatChipStyle(t.cat)
                          }
                        >
                          {t.zh}
                          <span className="ml-1 opacity-70">{t.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
