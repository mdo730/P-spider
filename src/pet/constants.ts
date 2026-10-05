/**
 * 宠物彩蛋数值配置。
 *
 * 所有可调数值集中在这里：想改手感/经济平衡，只动这个文件。
 */

export const PET_STORAGE_NAME = 'pet';
export const PET_STATE_VERSION = 1;

export const DEFAULT_PET_NAME = '西西';

export const VITAL_MAX = 100;
export const ENERGY_MAX = 100;

/** 三围离线/在线衰减（每小时），极慢/挂机向：饱腹约 3 天见底 */
export const DECAY_PER_HOUR = {
  satiety: 1.4,
  cleanliness: 0.83,
  mood: 0.7,
};

/** 三围低于此值算「不足」 */
export const LOW_THRESHOLD = 30;
/** 三围不足时心情额外下降（每小时） */
export const LOW_MOOD_EXTRA_PER_HOUR = 0.5;

/** 心情档位：>= 高兴阈值 为高兴；< 失落阈值 为失落；其间普通 */
export const MOOD_HAPPY = 90;
export const MOOD_SAD = 60;
/** 任务时长倍率（完成时间）：高兴更快、失落/生病/饿了更慢 */
export const SPEED = {
  happy: 0.7,
  sad: 1.3,
  sick: 1.5,
  hungry: 1.3,
};
/** 饱腹低于此值与「失落」同样拖慢任务 */
export const HUNGRY_SPEED_THRESHOLD = 40;
/** 清洁度惩罚：低于 基准线×比例 时打工收益打折（四舍五入前） */
export const CLEAN_BASELINE = 70;
export const CLEAN_LOW_RATIO = 0.4;
export const CLEAN_INCOME_PENALTY = 0.7;

/** 体力自然恢复（每小时） */
export const ENERGY_REGEN_PER_HOUR = 12;

/** 进食缓冲释放：约几小时放完一批 */
export const BUFFER_RELEASE_HOURS = 2;

// ---- 健康 ----
/** 三围都健康时，健康恢复（每小时） */
export const HEALTH_REGEN_PER_HOUR = 1.5;
/** 三围不足时，健康流失系数 */
export const HEALTH_DRAIN_FACTOR = 0.8;
/** 健康低于此值 → 生病 */
export const SICK_HEALTH = 40;
/** 健康低于此值 → 重症 */
export const CRITICAL_HEALTH = 15;
/** 康复判定：健康回到 SICK_HEALTH + 此值 以上即痊愈 */
export const RECOVER_MARGIN = 5;
/** 每日最多生病次数 */
export const MAX_SICK_PER_DAY = 1;
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
/** 三围不足时的突发生病基础概率（每小时，按不足项数叠加） */
export const SICK_BASE_CHANCE_PER_HOUR = 0.03;

// ---- 经济 ----
/** 每次下载产金基数 */
export const COIN_PER_DOWNLOAD = 1;
/** 每级学历对下载收益的加成（+50%/级） */
export const EDU_INCOME_BONUS = 0.5;
/** 每级学历对打工工资的加成 */
export const EDU_WAGE_BONUS = 0.4;
/** 搜索/浏览的奖励经验 */
export const EXP_PER_SEARCH = 0.5;
export const EXP_PER_BROWSE = 0.2;

// ---- 等级 ----
/** 升到 (level+1) 所需累计经验（VPet 公式） */
export function expToNext(level: number): number {
  return (level * 10) ** 2;
}

// ---- 打工 ----
// 数值按「30 分钟」一档为基准，长班按倍数放大
export const WORK = {
  durationMs: 30 * 60 * 1000,
  energyCost: 12,
  satietyCost: 6,
  moodCost: 4,
  exp: 4,
};

// ---- 学习 ----
export const STUDY = {
  durationMs: 2 * 60 * 60 * 1000,
  energyCost: 40,
  exp: 8,
  cooldownMs: 0,
};

// ---- 学历 ----
export const EDU_LEVELS = [
  '幼儿园',
  '小学',
  '初中',
  '高中',
  '大学',
  '硕士',
  '博士',
  '博士后',
];
/** 学历由「学科总等级」换算：每 EDU_PER_SKILL 点总等级升一级学历 */
export const EDU_PER_SKILL = 3;

// ---- 互动 ----
export const PAT = {
  cooldownMs: 60 * 1000,
  affinity: 1,
  mood: 1,
};

/** 改名花费金币（首次领养命名免费） */
export const RENAME_COST = 100;
