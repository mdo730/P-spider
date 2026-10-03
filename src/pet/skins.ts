/**
 * 皮肤（图鉴）：**纯成就解锁**，视觉走「AI 整图替换」。
 *
 * 整图放 `src/pet/assets/skins/<id>.png`（透明背景、同一画布/锚点），
 * 由下方 import.meta.glob 自动按 id 加载；没有图时回退到 `filter` 调色。
 * 解锁条件用数据描述（req），由 engine 判定；本文件不依赖 engine，避免循环引用。
 */

import type { PetStats } from './types';

export type SkinReq =
  | { kind: 'none' }
  | { kind: 'level'; value: number }
  | { kind: 'edu'; value: number }
  | { kind: 'collection'; value: number }
  | { kind: 'stat'; stat: keyof PetStats; value: number }
  | { kind: 'skill'; subject: string; value: number }
  | { kind: 'allSkills'; value: number }
  | { kind: 'coin'; value: number };

export interface Skin {
  id: string;
  name: string;
  emoji: string;
  /** 无整图时的调色兜底 */
  filter?: string;
  /** 解锁说明（图鉴展示用） */
  desc: string;
  req: SkinReq;
}

export const DEFAULT_SKIN = 'classic';

export const SKINS: Skin[] = [
  {
    id: 'classic',
    name: '原味蕉',
    emoji: '🍌',
    desc: '默认皮肤',
    req: { kind: 'none' },
  },
  {
    id: 'gold',
    name: '黄金蕉',
    emoji: '🥇',
    desc: '等级达到 15',
    req: { kind: 'level', value: 15 },
  },
  {
    id: 'lava',
    name: '熔岩蕉',
    emoji: '🌋',
    desc: '累计打工 100 次',
    req: { kind: 'stat', stat: 'works', value: 100 },
  },
  {
    id: 'bolt',
    name: '闪电蕉',
    emoji: '⚡',
    desc: '累计下载 500 次',
    req: { kind: 'stat', stat: 'downloads', value: 500 },
  },
  {
    id: 'sport',
    name: '运动蕉',
    emoji: '⚽',
    desc: '体育满级',
    req: { kind: 'skill', subject: 'sport', value: 5 },
  },
  {
    id: 'art',
    name: '艺术蕉',
    emoji: '🎨',
    desc: '绘画满级',
    req: { kind: 'skill', subject: 'art', value: 5 },
  },
  {
    id: 'code',
    name: '编程蕉',
    emoji: '💻',
    desc: '编程满级',
    req: { kind: 'skill', subject: 'code', value: 5 },
  },
  {
    id: 'music',
    name: '音乐蕉',
    emoji: '🎵',
    desc: '音乐满级',
    req: { kind: 'skill', subject: 'music', value: 5 },
  },
  {
    id: 'stardust',
    name: '星尘蕉',
    emoji: '✨',
    desc: '语言满级',
    req: { kind: 'skill', subject: 'lang', value: 5 },
  },
  {
    id: 'scholar',
    name: '学霸蕉',
    emoji: '🧠',
    desc: '五科全部满级',
    req: { kind: 'allSkills', value: 5 },
  },
  {
    id: 'crystal',
    name: '水晶蕉',
    emoji: '💎',
    desc: '物品图鉴收集 10 种',
    req: { kind: 'collection', value: 10 },
  },
  {
    id: 'diamond',
    name: '钻石蕉',
    emoji: '♦️',
    desc: '学历达到「博士后」',
    req: { kind: 'edu', value: 7 },
  },
  {
    id: 'delivery',
    name: '外卖蕉',
    emoji: '🛵',
    desc: '累计打工 10 次',
    req: { kind: 'stat', stat: 'works', value: 10 },
  },
  {
    id: 'rainbow',
    name: '彩虹蕉',
    emoji: '🌈',
    desc: '累计清洁 50 次',
    req: { kind: 'stat', stat: 'cleans', value: 50 },
  },
  {
    id: 'foodie',
    name: '吃货蕉',
    emoji: '🍔',
    desc: '累计喂食 100 次',
    req: { kind: 'stat', stat: 'feeds', value: 100 },
  },
  {
    id: 'gamer',
    name: '玩咖蕉',
    emoji: '🎮',
    desc: '累计玩耍 50 次',
    req: { kind: 'stat', stat: 'plays', value: 50 },
  },
  {
    id: 'tycoon',
    name: '富豪蕉',
    emoji: '💰',
    desc: '持有金币达到 10000',
    req: { kind: 'coin', value: 10000 },
  },
  {
    id: 'detective',
    name: '情报蕉',
    emoji: '🔍',
    desc: '累计搜索 200 次',
    req: { kind: 'stat', stat: 'searches', value: 200 },
  },
  {
    id: 'surfer',
    name: '冲浪蕉',
    emoji: '🏄',
    desc: '累计浏览 500 次',
    req: { kind: 'stat', stat: 'browses', value: 500 },
  },
  {
    id: 'pill',
    name: '药罐蕉',
    emoji: '💊',
    desc: '累计用药 20 次',
    req: { kind: 'stat', stat: 'heals', value: 20 },
  },
  {
    id: 'ultimate',
    name: '究极蕉',
    emoji: '👑',
    desc: '等级达到 30',
    req: { kind: 'level', value: 30 },
  },
];

export const SKIN_MAP: Record<string, Skin> = Object.fromEntries(
  SKINS.map((s) => [s.id, s]),
);

export function skinById(id: string): Skin {
  return SKIN_MAP[id] ?? SKINS[0];
}

/** 自动加载 `assets/skins/<id>.png` 整图（文件名即皮肤 id） */
const SKIN_IMAGES = import.meta.glob('./assets/skins/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 取某皮肤的整图 URL；没有则 undefined（走调色兜底） */
export function skinImage(id: string): string | undefined {
  const key = Object.keys(SKIN_IMAGES).find((k) => k.endsWith(`/${id}.png`));
  return key ? SKIN_IMAGES[key] : undefined;
}
