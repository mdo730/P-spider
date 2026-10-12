import { VisionTagItem } from './wd14';

/**
 * 视觉标签（WD14）公共核心：fig-memo 文章 与 本地库文件 共用同一套记录结构、
 * 手动覆盖层与「是否已识别」判定。键（`postId` 字段）在 fig-memo 是文章 id，
 * 在本地库是**文件路径**——字段名沿用历史以兼容已落盘的索引文件。
 */

export const VISUAL_MAP_VERSION = 1;
/** 默认模型 id（基础种子用的就是它） */
export const DEFAULT_MODEL = 'wd-swinv2-tagger-v3';
/** 可识别的图片扩展名 */
export const IMAGE_EXT = /\.(jpe?g|png|webp|bmp|gif)$/i;

export interface VisualRecord {
  /** 键：fig-memo 为文章 id，本地库为文件绝对路径 */
  postId: string;
  /** 自动识别结果（WD14） */
  items: VisionTagItem[];
  unknown: string[];
  /** 实际使用图片数 */
  images: number;
  /** 当时使用的取图数上限（1/5/60），用于设置调大后自动重跑 */
  k: number;
  engine: string;
  mapVersion: number;
  updatedAt: number;
  /** 打标失败的图片（便于排查） */
  errors?: string[];
  /** 手动补充的标签（重扫不覆盖） */
  added?: VisionTagItem[];
  /** 手动删除的标签 key（cat|zh；重扫不覆盖） */
  removed?: string[];
}

export interface VisionProgress {
  done: number;
  total: number;
  currentTitle: string;
  /** 当前是第几个（1-based） */
  index: number;
}

export function tagKey(it: { cat: string; zh: string }): string {
  return `${it.cat}|${it.zh}`;
}

/** 有效视觉标签 = (auto − removed) ∪ added */
export function effectiveItems(rec: VisualRecord): VisionTagItem[] {
  const removed = new Set(rec.removed || []);
  const map = new Map<string, VisionTagItem>();
  for (const it of rec.items) {
    const key = tagKey(it);
    if (removed.has(key)) continue;
    map.set(key, it);
  }
  for (const it of rec.added || []) {
    map.set(tagKey(it), it);
  }
  return [...map.values()];
}

/**
 * 是否已成功识别：
 * - 无图（images=0）→ 完成；
 * - 有图但零标签 → 失败，重试；
 * - 已识别的取图数 k 需 ≥ 当前设置（设置调大则重跑）。
 */
export function isDone(
  rec: VisualRecord | undefined,
  k: number,
  model: string,
): boolean {
  if (!rec) return false;
  const tagged = rec.items.length + rec.unknown.length > 0;
  // 报错且无标签 → 失败，可重试
  if (!tagged && rec.errors && rec.errors.length > 0) return false;
  if (rec.images === 0) return true; // 真无图
  if (!tagged) return false; // 有图但零标签 → 失败，可重试
  // 模型不同 → 需要重跑（升级到更好模型）；旧记录 engine='wd14-moat-v2' 视为默认模型
  const recModel =
    !rec.engine || rec.engine === 'wd14-moat-v2' ? DEFAULT_MODEL : rec.engine;
  if (recModel !== model) return false;
  return (rec.k || 0) >= k;
}

export function makeRecord(
  key: string,
  items: VisionTagItem[],
  unknown: string[],
  images: number,
  k: number,
  errors?: string[],
  added?: VisionTagItem[],
  removed?: string[],
  model?: string,
): VisualRecord {
  return {
    postId: key,
    items,
    unknown: [...new Set(unknown)].slice(0, 200),
    images,
    k,
    engine: model || DEFAULT_MODEL,
    mapVersion: VISUAL_MAP_VERSION,
    updatedAt: Date.now(),
    ...(errors && errors.length ? { errors: errors.slice(0, 10) } : {}),
    ...(added && added.length ? { added } : {}),
    ...(removed && removed.length ? { removed } : {}),
  };
}
