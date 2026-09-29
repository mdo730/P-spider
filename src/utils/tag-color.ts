import type { CSSProperties } from 'react';

/**
 * 分类/标签的**低饱和度固定色**：按名字 hash 到一组预设色板，保证同一名字永远同色。
 * 统一用于：时间流的分类标注 + fig-memo / moeyo 侧栏的分类标签；以及筛选浮窗胶囊。
 */
const PALETTE = [
  '#7f9cc0', // 雾蓝
  '#8fae94', // 苔绿
  '#c0a08a', // 浅赭
  '#b58fb0', // 藕紫
  '#a6a0c6', // 灰紫
  '#c3b184', // 米金
  '#84b0b3', // 灰青
  '#c69a9a', // 豆沙
  '#9dae7d', // 橄榄
  '#a9a3a0', // 暖灰
  '#8fa8a0', // 松石灰
  '#bda88f', // 驼
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** 名字 → 固定低饱和主色（hex） */
export function tagColor(name: string): string {
  const key = (name || '').trim();
  if (!key) return PALETTE[0];
  return PALETTE[hashString(key) % PALETTE.length];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 标签/胶囊的「淡底 + 同色描边 + 深字」样式（低饱和、可读） */
export function tagChipStyle(name: string): CSSProperties {
  const c = tagColor(name);
  return {
    color: '#3f3f46',
    backgroundColor: rgba(c, 0.16),
    borderColor: rgba(c, 0.45),
  };
}

/** 选中态胶囊（用同色实底） */
export function tagChipActiveStyle(name: string): CSSProperties {
  const c = tagColor(name);
  return {
    color: '#ffffff',
    backgroundColor: c,
    borderColor: c,
  };
}
