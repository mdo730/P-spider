/**
 * 宠物彩蛋（香蕉君）类型定义。
 *
 * 本目录（src/pet）是自包含的特性模块，core 层为纯逻辑、零外部依赖，
 * 便于整体抽出。业务侧只通过 activity 事件与它耦合。
 */

/** 外部行为类型（由 activity-bridge 上报） */
export type PetActivityType = 'download' | 'search' | 'browse';

/** 心情视觉态 */
export type PetMood = 'happy' | 'normal' | 'sad';

/** 健康视觉态 */
export type PetHealth = 'healthy' | 'sick' | 'critical';

/** 动作视觉态（用于精灵图/CSS 反馈） */
export type PetAction =
  | 'idle'
  | 'pat'
  | 'eat'
  | 'clean'
  | 'play'
  | 'work'
  | 'study'
  | 'heal'
  | 'jump';

/** 成长阶段（中量扩展位） */
export type PetStage = 'child' | 'adult' | 'elder';

/** 进行中的日程类型 */
export type PetTaskType = 'work' | 'study';

/** 进行中的日程（打工/学习，占用一段时间，离线也推进） */
export interface PetTask {
  type: PetTaskType;
  startedAt: number;
  endsAt: number;
  /** 打工：工种 id */
  jobId?: string;
  /** 打工：时长（分钟） */
  minutes?: number;
  /** 学习：学科 id */
  subject?: string;
  /** 学习：完成时目标等级 */
  targetLevel?: number;
}

/** 行为计次（用于成就/统计扩展） */
export interface PetStats {
  downloads: number;
  searches: number;
  browses: number;
  pats: number;
  feeds: number;
  cleans: number;
  plays: number;
  heals: number;
  works: number;
  studies: number;
}

/**
 * 进食缓冲（借 VPet 的 Store 机制）：
 * 食物效果一半立刻生效，另一半存这里随时间缓慢释放，避免暴食。
 */
export interface PetBuffer {
  satiety: number;
  mood: number;
}

/** 宠物完整存档 */
export interface PetState {
  version: number;
  /** 是否已完成「领养」（首次命名） */
  adopted: boolean;
  name: string;

  // 三围 + 状态（0~100）
  satiety: number;
  cleanliness: number;
  mood: number;
  health: number;
  energy: number;

  // 成长
  exp: number;
  affinity: number;

  // 经济
  coin: number;
  /** 学科能力：subjectId -> 等级（0~SKILL_MAX） */
  skills: Record<string, number>;
  /** 当前皮肤 id */
  skin: string;
  /** 金币提示音开关 */
  soundOn: boolean;
  /** 随机短语开关 */
  phraseOn: boolean;
  /** 上海话模式（短语全部用上海话） */
  shanghaiOn: boolean;
  /** 产业：industryId -> 等级（0/不存在 = 未购买） */
  industries: Record<string, number>;
  /** 历史产业花费（资产总额 = 金币 + 该值） */
  assetSpent: number;
  /** 上次「揍滑」时间戳（每小时限一次） */
  lastHuaAt: number;
  /** 上次产业收益结算时间戳（整点结算） */
  lastIndustryPayoutAt: number;

  // 疾病：0 表示未生病，>0 为本次生病起始时间戳
  sickSince: number;

  // 进食缓冲
  buffer: PetBuffer;

  // 进行中的日程
  task: PetTask | null;

  // 时间锚点
  lastTickAt: number;
  lastFedAt: number;
  lastPatAt: number;
  lastCleanAt: number;
  lastPlayAt: number;
  lastWorkAt: number;
  lastStudyAt: number;
  lastSickAt: number;

  // 库存 / 玩具耐久 / 图鉴（物品收集）
  inventory: Record<string, number>;
  toys: Record<string, number>;
  collection: string[];

  stats: PetStats;
}
