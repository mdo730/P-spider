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

/** 视觉识别分类的**低饱和粉彩**色板（含 E08D83/E083DC/9D83E0/83B0E0 等） */
const VISION_PALETTE = [
  '#E08D83', // 珊瑚
  '#E083DC', // 玫粉
  '#9D83E0', // 紫
  '#83B0E0', // 蓝
  '#83E0C0', // 青绿
  '#B0E083', // 黄绿
  '#E0C783', // 杏黄
  '#E0839D', // 粉
  '#83D0E0', // 天青
  '#C783E0', // 紫罗兰
  '#E0A983', // 浅橙
  '#A0A8C0', // 蓝灰
];

const VISION_CATS = [
  '体型',
  '服装',
  '姿势',
  '元素',
  '道具',
  '发型',
  '头发',
  '眼睛',
  '表情',
  '构图',
  '配饰',
  '背景',
  '画质',
  '角色',
  '通用',
  '内容',
  'R18',
];

/** 视觉分类 → 固定粉彩色（已知类按顺序，未知类按名字 hash） */
export function visionCatColor(cat: string): string {
  const i = VISION_CATS.indexOf((cat || '').trim());
  if (i >= 0) return VISION_PALETTE[i % VISION_PALETTE.length];
  return VISION_PALETTE[hashString(cat || '') % VISION_PALETTE.length];
}

/** 视觉分类胶囊（淡底 + 同色描边 + 深字） */
export function visionCatChipStyle(cat: string): CSSProperties {
  const c = visionCatColor(cat);
  return {
    color: '#3f3f46',
    backgroundColor: rgba(c, 0.16),
    borderColor: rgba(c, 0.5),
  };
}

/** 视觉分类胶囊·选中（同色实底） */
export function visionCatChipActiveStyle(cat: string): CSSProperties {
  const c = visionCatColor(cat);
  return {
    color: '#ffffff',
    backgroundColor: c,
    borderColor: c,
  };
}

/** 视觉分类胶囊·深色底（用于深色背景，如右侧推文条） */
export function visionCatChipStyleDark(cat: string): CSSProperties {
  const c = visionCatColor(cat);
  return {
    color: '#e5e7eb',
    backgroundColor: rgba(c, 0.24),
    borderColor: rgba(c, 0.6),
  };
}
