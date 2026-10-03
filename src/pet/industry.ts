/**
 * 产业系统（数据驱动）：购买/升级产业，整点产出金币。
 *
 * - 解锁：按「资产总额 = 持有金币 + 历史产业花费」达标解锁；未解锁显示 ？？？。
 * - 无等级上限：价格随等级指数上涨（越多越贵）；收益同样指数增长但更快。
 * - 滑：线性收益（每级 +5/时），但价格也逐级上涨（不再恒定）。
 * - 集团：达到指定等级起显示老黄整图。
 */

import huaImg from './assets/hua.png';
import laohuangImg from './assets/laohuang.png';

export const INDUSTRY_IMAGES: Record<string, string> = {
  hua: huaImg,
  laohuang: laohuangImg,
};

export interface Industry {
  id: string;
  name: string;
  emoji: string;
  /** 资产达到该值解锁；0 = 初始可用 */
  unlockAssets: number;
  /** 升到 1 级的价格 */
  basePrice: number;
  /** 每级价格倍率（>1 = 越买越贵） */
  priceGrowth: number;
  /** 1 级收益 /小时 */
  baseIncome: number;
  /** 每级收益倍率（linear 时忽略） */
  incomeGrowth: number;
  /** 线性收益：收益 = baseIncome × 等级（用于「滑」按只数计） */
  linear?: boolean;
  /** 使用整图（滑） */
  useImage?: boolean;
  /** 达到该等级起显示整图 */
  topImageLevel?: number;
  /** 该整图的 key */
  topImageKey?: string;
}

export const INDUSTRIES: Industry[] = [
  {
    id: 'hua',
    name: '滑',
    emoji: '🤚',
    unlockAssets: 0,
    basePrice: 388,
    priceGrowth: 1.2,
    baseIncome: 5,
    incomeGrowth: 1,
    linear: true,
    useImage: true,
  },
  {
    id: 'breakfast',
    name: '早餐铺',
    emoji: '🍳',
    unlockAssets: 1500,
    basePrice: 500,
    priceGrowth: 1.15,
    baseIncome: 5,
    incomeGrowth: 1.2,
  },
  {
    id: 'store',
    name: '小卖部',
    emoji: '🏪',
    unlockAssets: 6000,
    basePrice: 2000,
    priceGrowth: 1.15,
    baseIncome: 12,
    incomeGrowth: 1.2,
  },
  {
    id: 'noodle',
    name: '面馆',
    emoji: '🍜',
    unlockAssets: 25000,
    basePrice: 8000,
    priceGrowth: 1.15,
    baseIncome: 30,
    incomeGrowth: 1.2,
  },
  {
    id: 'dessert',
    name: '甜品店',
    emoji: '🍰',
    unlockAssets: 100000,
    basePrice: 30000,
    priceGrowth: 1.15,
    baseIncome: 70,
    incomeGrowth: 1.2,
  },
  {
    id: 'inn',
    name: '旅馆',
    emoji: '🏨',
    unlockAssets: 400000,
    basePrice: 120000,
    priceGrowth: 1.15,
    baseIncome: 160,
    incomeGrowth: 1.2,
  },
  {
    id: 'mall',
    name: '商场',
    emoji: '🏬',
    unlockAssets: 1500000,
    basePrice: 500000,
    priceGrowth: 1.15,
    baseIncome: 380,
    incomeGrowth: 1.2,
  },
  {
    id: 'corp',
    name: '集团',
    emoji: '🏢',
    unlockAssets: 6000000,
    basePrice: 2000000,
    priceGrowth: 1.15,
    baseIncome: 850,
    incomeGrowth: 1.2,
    topImageLevel: 10,
    topImageKey: 'laohuang',
  },
];

export const INDUSTRY_MAP: Record<string, Industry> = Object.fromEntries(
  INDUSTRIES.map((i) => [i.id, i]),
);

export function industryById(id: string): Industry | undefined {
  return INDUSTRY_MAP[id];
}

/** 升到 toLevel 需要的价格 */
export function industryPrice(ind: Industry, toLevel: number): number {
  return Math.round(ind.basePrice * Math.pow(ind.priceGrowth, toLevel - 1));
}

/** 某等级每小时产出 */
export function industryIncome(ind: Industry, level: number): number {
  if (level <= 0) return 0;
  if (ind.linear) return Math.round(ind.baseIncome * level);
  return Math.round(ind.baseIncome * Math.pow(ind.incomeGrowth, level - 1));
}
