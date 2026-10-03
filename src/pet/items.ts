/**
 * 物品表（数据驱动）。
 *
 * 新增物品 = 往 ITEMS 里加一条数据，逻辑无需改动。
 * category 决定在商店里的归类与「使用」时的行为。
 */

import type { PetState } from './types';

export type ItemCategory = 'food' | 'clean' | 'toy' | 'medicine';

export interface PetItem {
  id: string;
  name: string;
  category: ItemCategory;
  price: number;
  emoji: string;
  desc: string;
  /** 玩具可用次数（其余类别为一次性消耗） */
  durability?: number;
  effects?: Partial<{
    satiety: number;
    cleanliness: number;
    mood: number;
    health: number;
    affinity: number;
    exp: number;
    energy: number;
  }>;
}

export const ITEMS: PetItem[] = [
  // 食物
  {
    id: 'banana',
    name: '香蕉',
    category: 'food',
    price: 5,
    emoji: '🍌',
    desc: '朴素主食，饱腹 +40',
    effects: { satiety: 40 },
  },
  {
    id: 'bread',
    name: '面包',
    category: 'food',
    price: 8,
    emoji: '🍞',
    desc: '管饱，饱腹 +60',
    effects: { satiety: 60 },
  },
  {
    id: 'snack',
    name: '高级零食',
    category: 'food',
    price: 20,
    emoji: '🍮',
    desc: '不太顶饱但很讨喜：饱腹 +15、心情 +25',
    effects: { satiety: 15, mood: 25 },
  },
  {
    id: 'cake',
    name: '草莓蛋糕',
    category: 'food',
    price: 30,
    emoji: '🍰',
    desc: '奢侈品：饱腹 +30、心情 +30、好感 +2',
    effects: { satiety: 30, mood: 30, affinity: 2 },
  },
  // 清洁
  {
    id: 'soap',
    name: '清洁用品',
    category: 'clean',
    price: 4,
    emoji: '🧼',
    desc: '洗香香，清洁 +50',
    effects: { cleanliness: 50 },
  },
  {
    id: 'spa',
    name: '高级洗护',
    category: 'clean',
    price: 12,
    emoji: '🛁',
    desc: '清洁 +60、心情 +10',
    effects: { cleanliness: 60, mood: 10 },
  },
  // 玩具
  {
    id: 'wand',
    name: '逗猫棒',
    category: 'toy',
    price: 15,
    emoji: '🪶',
    desc: '可玩 5 次，每次心情 +25',
    durability: 5,
    effects: { mood: 25 },
  },
  {
    id: 'ball',
    name: '弹力球',
    category: 'toy',
    price: 30,
    emoji: '⚽',
    desc: '可玩 8 次，每次心情 +30',
    durability: 8,
    effects: { mood: 30 },
  },
  // 医疗
  {
    id: 'pill',
    name: '感冒药',
    category: 'medicine',
    price: 20,
    emoji: '💊',
    desc: '轻症：健康 +30',
    effects: { health: 30 },
  },
  {
    id: 'elixir',
    name: '特效药',
    category: 'medicine',
    price: 40,
    emoji: '🧪',
    desc: '重症：健康 +60',
    effects: { health: 60 },
  },
];

export const ITEM_MAP: Record<string, PetItem> = Object.fromEntries(
  ITEMS.map((it) => [it.id, it]),
);

export function getItem(id: string): PetItem | undefined {
  return ITEM_MAP[id];
}

export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  food: '食物',
  clean: '清洁',
  toy: '玩具',
  medicine: '医疗',
};

/** 该物品当前的库存展示数量（玩具看剩余次数） */
export function itemCount(state: PetState, item: PetItem): number {
  if (item.category === 'toy') return state.toys[item.id] ?? 0;
  return state.inventory[item.id] ?? 0;
}
