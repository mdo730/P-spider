/**
 * 宠物核心逻辑（pure core）。
 *
 * 不依赖 React / zustand / Tauri / window —— 全部是
 * `(state, ...args, now) => state` 形式的纯函数，可单测、可移植。
 */

import {
  jobById,
  SKILL_MAX,
  skillTuition,
  SUBJECT_MAP,
  SUBJECTS,
  WORK_SHIFTS,
  type Job,
} from './career';
import {
  BUFFER_RELEASE_HOURS,
  COIN_PER_DOWNLOAD,
  CLEAN_BASELINE,
  CLEAN_INCOME_PENALTY,
  CLEAN_LOW_RATIO,
  CRITICAL_HEALTH,
  DECAY_PER_HOUR,
  DEFAULT_PET_NAME,
  EDU_INCOME_BONUS,
  EDU_LEVELS,
  EDU_PER_SKILL,
  EDU_WAGE_BONUS,
  ENERGY_MAX,
  ENERGY_REGEN_PER_HOUR,
  EXP_PER_BROWSE,
  EXP_PER_SEARCH,
  HEALTH_DRAIN_FACTOR,
  HEALTH_REGEN_PER_HOUR,
  HUNGRY_SPEED_THRESHOLD,
  LOW_MOOD_EXTRA_PER_HOUR,
  LOW_THRESHOLD,
  MAX_SICK_PER_DAY,
  MOOD_HAPPY,
  MOOD_SAD,
  ONE_DAY_MS,
  PAT,
  PET_STATE_VERSION,
  RECOVER_MARGIN,
  RENAME_COST,
  SICK_BASE_CHANCE_PER_HOUR,
  SICK_HEALTH,
  SPEED,
  STUDY,
  VITAL_MAX,
  WORK,
  expToNext,
} from './constants';
import { getItem, type PetItem } from './items';
import {
  INDUSTRIES,
  industryById,
  industryIncome,
  industryPrice,
  type Industry,
} from './industry';
import { DEFAULT_SKIN, SKINS, skinById, type Skin } from './skins';
import type {
  PetActivityType,
  PetHealth,
  PetMood,
  PetStage,
  PetState,
  PetTask,
} from './types';

export interface PetResult {
  ok: boolean;
  message?: string;
  state: PetState;
}

function clamp(v: number, min = 0, max = VITAL_MAX): number {
  return Math.min(max, Math.max(min, v));
}

function cloneState(s: PetState): PetState {
  return {
    ...s,
    skills: { ...s.skills },
    industries: { ...s.industries },
    buffer: { ...s.buffer },
    task: s.task ? { ...s.task } : null,
    inventory: { ...s.inventory },
    toys: { ...s.toys },
    collection: [...s.collection],
    stats: { ...s.stats },
  };
}

export function createInitialState(now: number): PetState {
  return {
    version: PET_STATE_VERSION,
    adopted: false,
    name: DEFAULT_PET_NAME,

    satiety: 80,
    cleanliness: 80,
    mood: 80,
    health: 100,
    energy: 100,

    exp: 0,
    affinity: 0,
    coin: 0,
    skills: {},
    skin: DEFAULT_SKIN,
    soundOn: true,
    phraseOn: true,
    industries: {},
    assetSpent: 0,
    lastHuaAt: 0,
    lastIndustryPayoutAt: now,

    sickSince: 0,
    buffer: { satiety: 0, mood: 0 },
    task: null,

    lastTickAt: now,
    lastFedAt: 0,
    lastPatAt: 0,
    lastCleanAt: 0,
    lastPlayAt: 0,
    lastWorkAt: 0,
    lastStudyAt: 0,
    lastSickAt: 0,

    inventory: {},
    toys: {},
    collection: [],

    stats: {
      downloads: 0,
      searches: 0,
      browses: 0,
      pats: 0,
      feeds: 0,
      cleans: 0,
      plays: 0,
      heals: 0,
      works: 0,
      studies: 0,
    },
  };
}

// ---------- 派生量 ----------

export function computeLevel(exp: number): number {
  if (exp <= 0) return 1;
  return Math.floor(Math.sqrt(exp) / 10) + 1;
}

export function levelProgress(exp: number): {
  level: number;
  cur: number;
  need: number;
  ratio: number;
} {
  const level = computeLevel(exp);
  const base = expToNext(level - 1);
  const next = expToNext(level);
  const span = Math.max(1, next - base);
  const cur = Math.max(0, exp - base);
  return { level, cur, need: span, ratio: clamp(cur / span, 0, 1) };
}

export function skillLevel(s: PetState, subjectId?: string): number {
  if (!subjectId) return 0;
  return s.skills[subjectId] ?? 0;
}

export function totalSkill(s: PetState): number {
  return Object.values(s.skills).reduce((a, b) => a + b, 0);
}

/** 学历由学科总等级换算 */
export function eduLevelOf(s: PetState): number {
  return Math.min(
    EDU_LEVELS.length - 1,
    Math.floor(totalSkill(s) / EDU_PER_SKILL),
  );
}

export function eduName(s: PetState): string {
  return EDU_LEVELS[eduLevelOf(s)] ?? EDU_LEVELS[0];
}

export function coinPerDownload(s: PetState): number {
  return COIN_PER_DOWNLOAD * (1 + EDU_INCOME_BONUS * eduLevelOf(s));
}

export function jobWage(s: PetState, job: Job): number {
  const ability = skillLevel(s, job.subject);
  return Math.round(
    (job.base + ability * 5) * (1 + EDU_WAGE_BONUS * eduLevelOf(s)),
  );
}

/** 按 30 分钟档位换算「时长 × 工资」；长班有小幅加成；清洁度过低打折 */
export function jobPay(s: PetState, job: Job, minutes: number): number {
  const unit = minutes / 30;
  const bonus = unit >= 8 ? 1.2 : unit >= 4 ? 1.08 : unit >= 2 ? 1.04 : 1;
  let pay = jobWage(s, job) * unit * bonus;
  if (s.cleanliness < CLEAN_BASELINE * CLEAN_LOW_RATIO) {
    pay *= CLEAN_INCOME_PENALTY;
  }
  return Math.round(pay);
}

export function isJobQualified(s: PetState, job: Job): boolean {
  return skillLevel(s, job.subject) >= job.minSkill;
}

// ---------- 产业 ----------

/** 资产总额 = 持有金币 + 历史产业花费 */
export function assets(s: PetState): number {
  return Math.floor(s.coin) + s.assetSpent;
}

export function industryLevel(s: PetState, id: string): number {
  return s.industries[id] ?? 0;
}

export function industryIncomePerHour(s: PetState): number {
  let sum = 0;
  for (const ind of INDUSTRIES) {
    sum += industryIncome(ind, industryLevel(s, ind.id));
  }
  return sum;
}

export function isIndustryUnlocked(s: PetState, ind: Industry): boolean {
  return assets(s) >= ind.unlockAssets;
}

export function buyIndustry(
  input: PetState,
  id: string,
  now: number,
): PetResult {
  const s = settle(input, now);
  const ind = industryById(id);
  if (!ind) return fail(s, '没有这个产业');
  if (!isIndustryUnlocked(s, ind)) return fail(s, '这个产业还没解锁');
  const level = industryLevel(s, id);
  const price = industryPrice(ind, level + 1);
  if (s.coin < price) return fail(s, `金币不够（需要 ${price}）`);
  s.coin -= price;
  s.assetSpent += price;
  s.industries[id] = level + 1;
  clampVitals(s);
  return ok(s, `「${ind.name}」升到 ${level + 1} 级，花费 ${price} 金币`);
}

/** 揍滑彩蛋奖励（每小时限一次） */
export function rewardHua(input: PetState, now: number): PetResult {
  const s = settle(input, now);
  if (now - s.lastHuaAt < 3600_000) {
    return fail(s, '滑刚被揍过，歇一会儿');
  }
  s.lastHuaAt = now;
  s.mood += 5;
  s.coin += 10;
  clampVitals(s);
  return ok(s, '揍了滑一顿！心情 +5，金币 +10');
}

export function isSick(s: PetState): boolean {
  return s.sickSince > 0 || s.health < SICK_HEALTH;
}

export function getMood(s: PetState): PetMood {
  if (s.health < SICK_HEALTH) return 'sad';
  if (s.mood >= MOOD_HAPPY) return 'happy';
  if (s.mood < MOOD_SAD) return 'sad';
  return 'normal';
}

export function getHealth(s: PetState): PetHealth {
  if (s.health < CRITICAL_HEALTH) return 'critical';
  if (s.health < SICK_HEALTH) return 'sick';
  return 'healthy';
}

export function getStage(s: PetState): PetStage {
  const lv = computeLevel(s.exp);
  if (lv < 5) return 'child';
  if (lv < 15) return 'adult';
  return 'elder';
}

export function taskRemaining(task: PetTask | null, now: number): number {
  if (!task) return 0;
  return Math.max(0, task.endsAt - now);
}

/**
 * 任务完成时长倍率：高兴更快；失落/生病/饿更慢（可叠乘）。
 * 例：1 小时 → 高兴 42 分；失落 78 分；生病 90 分。
 */
export function taskDurationFactor(s: PetState): number {
  let f = 1;
  if (s.mood >= MOOD_HAPPY) f *= SPEED.happy;
  else if (s.mood < MOOD_SAD) f *= SPEED.sad;
  if (isSick(s)) f *= SPEED.sick;
  if (s.satiety < HUNGRY_SPEED_THRESHOLD) f *= SPEED.hungry;
  return f;
}

// ---------- 皮肤（纯成就） ----------

export function isSkinUnlocked(s: PetState, skin: Skin): boolean {
  const req = skin.req;
  switch (req.kind) {
    case 'none':
      return true;
    case 'level':
      return computeLevel(s.exp) >= req.value;
    case 'edu':
      return eduLevelOf(s) >= req.value;
    case 'collection':
      return s.collection.length >= req.value;
    case 'coin':
      return s.coin >= req.value;
    case 'skill':
      return skillLevel(s, req.subject) >= req.value;
    case 'allSkills':
      return SUBJECTS.every((sub) => skillLevel(s, sub.id) >= req.value);
    case 'stat':
      return s.stats[req.stat] >= req.value;
    default:
      return false;
  }
}

export function skinProgress(s: PetState, skin: Skin): string {
  const req = skin.req;
  switch (req.kind) {
    case 'level':
      return `${computeLevel(s.exp)}/${req.value}`;
    case 'edu':
      return `${eduName(s)}/${EDU_LEVELS[req.value] ?? ''}`;
    case 'collection':
      return `${s.collection.length}/${req.value}`;
    case 'coin':
      return `${Math.floor(s.coin)}/${req.value}`;
    case 'skill':
      return `Lv${skillLevel(s, req.subject)}/${req.value}`;
    case 'allSkills': {
      const min = Math.min(...SUBJECTS.map((sub) => skillLevel(s, sub.id)));
      return `最低 Lv${min}/${req.value}`;
    }
    case 'stat':
      return `${s.stats[req.stat]}/${req.value}`;
    default:
      return '';
  }
}

// ---------- 结算 ----------

function clampVitals(s: PetState): void {
  s.satiety = clamp(s.satiety);
  s.cleanliness = clamp(s.cleanliness);
  s.mood = clamp(s.mood);
  s.health = clamp(s.health);
  s.energy = clamp(s.energy, 0, ENERGY_MAX);
  s.affinity = Math.max(0, s.affinity);
  s.buffer.satiety = Math.max(0, s.buffer.satiety);
  s.buffer.mood = Math.max(0, s.buffer.mood);
  for (const k of Object.keys(s.skills)) {
    s.skills[k] = clamp(s.skills[k], 0, SKILL_MAX);
  }
}

function canGetSickToday(s: PetState, now: number): boolean {
  if (s.lastSickAt === 0) return true;
  return now - s.lastSickAt >= ONE_DAY_MS / Math.max(1, MAX_SICK_PER_DAY);
}

function completeTask(s: PetState, task: PetTask): void {
  if (task.type === 'work') {
    const job = jobById(task.jobId);
    const minutes = task.minutes ?? 30;
    s.coin += job ? jobPay(s, job, minutes) : 0;
    s.exp += Math.round(WORK.exp * (minutes / 30));
    s.affinity += 0.5;
    s.stats.works += 1;
  } else {
    if (task.subject) {
      const cur = s.skills[task.subject] ?? 0;
      s.skills[task.subject] = Math.min(SKILL_MAX, task.targetLevel ?? cur + 1);
    }
    s.exp += STUDY.exp;
    s.stats.studies += 1;
  }
}

/**
 * 时间结算：离线衰减 + 缓冲释放 + 体力恢复 + 健康/疾病 + 日程完成。
 * 若检测到时间回拨（now <= lastTickAt），不扣不加，仅对齐锚点。
 */
export function settle(input: PetState, now: number): PetState {
  const s = cloneState(input);
  if (now <= s.lastTickAt) {
    s.lastTickAt = now;
    return s;
  }
  const hours = (now - s.lastTickAt) / 3600000;
  s.lastTickAt = now;

  if (s.task && now >= s.task.endsAt) {
    completeTask(s, s.task);
    s.task = null;
  }

  s.satiety -= DECAY_PER_HOUR.satiety * hours;
  s.cleanliness -= DECAY_PER_HOUR.cleanliness * hours;
  let moodDecay = DECAY_PER_HOUR.mood * hours;
  if (s.satiety < LOW_THRESHOLD || s.cleanliness < LOW_THRESHOLD) {
    moodDecay += LOW_MOOD_EXTRA_PER_HOUR * hours;
  }
  s.mood -= moodDecay;

  const release = Math.min(1, hours / BUFFER_RELEASE_HOURS);
  const relSat = s.buffer.satiety * release;
  const relMood = s.buffer.mood * release;
  s.satiety += relSat;
  s.buffer.satiety -= relSat;
  s.mood += relMood;
  s.buffer.mood -= relMood;

  s.energy += ENERGY_REGEN_PER_HOUR * hours;

  // 产业收益：每满 1 小时结算一次（不在每次操作时按秒结算）
  const industryInc = industryIncomePerHour(s);
  if (industryInc > 0) {
    const payoutHours = Math.floor((now - s.lastIndustryPayoutAt) / 3600000);
    if (payoutHours >= 1) {
      s.coin += industryInc * payoutHours;
      s.lastIndustryPayoutAt += payoutHours * 3600000;
    }
  } else {
    // 还没有产业：保持锚点在当前，避免未来购买时把购买前的时间也算进去
    s.lastIndustryPayoutAt = now;
  }

  clampVitals(s);

  const lowCount = [s.satiety, s.cleanliness, s.mood].filter(
    (v) => v < LOW_THRESHOLD,
  ).length;
  if (lowCount === 0 && s.satiety > 60 && s.cleanliness > 60) {
    s.health += HEALTH_REGEN_PER_HOUR * hours;
  } else if (lowCount > 0) {
    let drain = 0;
    for (const v of [s.satiety, s.cleanliness, s.mood]) {
      if (v < LOW_THRESHOLD) drain += (LOW_THRESHOLD - v) / LOW_THRESHOLD;
    }
    s.health -= drain * HEALTH_DRAIN_FACTOR * hours;
  }

  if (lowCount > 0 && s.health >= SICK_HEALTH && canGetSickToday(s, now)) {
    if (Math.random() < SICK_BASE_CHANCE_PER_HOUR * lowCount * hours) {
      s.health -= 15;
      s.lastSickAt = now;
    }
  }
  clampVitals(s);

  if (s.health < SICK_HEALTH) {
    if (s.sickSince === 0) s.sickSince = now;
  } else if (s.sickSince !== 0 && s.health >= SICK_HEALTH + RECOVER_MARGIN) {
    s.sickSince = 0;
  }

  return s;
}

// ---------- 行为 ----------

function ok(state: PetState, message?: string): PetResult {
  return { ok: true, message, state };
}

function fail(state: PetState, message: string): PetResult {
  return { ok: false, message, state };
}

function applyEffects(s: PetState, item: PetItem, split: boolean): void {
  const e = item.effects ?? {};
  if (e.satiety) {
    if (split) {
      const half = e.satiety / 2;
      s.satiety += half;
      s.buffer.satiety += e.satiety - half;
    } else {
      s.satiety += e.satiety;
    }
  }
  if (e.cleanliness) s.cleanliness += e.cleanliness;
  if (e.mood) {
    if (split) {
      const half = e.mood / 2;
      s.mood += half;
      s.buffer.mood += e.mood - half;
    } else {
      s.mood += e.mood;
    }
  }
  if (e.health) s.health += e.health;
  if (e.affinity) s.affinity += e.affinity;
  if (e.exp) s.exp += e.exp;
  if (e.energy) s.energy += e.energy;
}

export function feed(input: PetState, itemId: string, now: number): PetResult {
  const s = settle(input, now);
  const item = getItem(itemId);
  if (!item || item.category !== 'food') return fail(s, '这不是能吃的东西');
  if ((s.inventory[itemId] ?? 0) <= 0)
    return fail(s, `库存里没有「${item.name}」`);
  s.inventory[itemId] -= 1;
  applyEffects(s, item, true);
  s.lastFedAt = now;
  s.stats.feeds += 1;
  s.exp += 1;
  clampVitals(s);
  return ok(s, `${s.name} 吃掉了「${item.name}」`);
}

export function clean(input: PetState, itemId: string, now: number): PetResult {
  const s = settle(input, now);
  const item = getItem(itemId);
  if (!item || item.category !== 'clean') return fail(s, '这不是清洁用品');
  if ((s.inventory[itemId] ?? 0) <= 0)
    return fail(s, `库存里没有「${item.name}」`);
  s.inventory[itemId] -= 1;
  applyEffects(s, item, false);
  s.lastCleanAt = now;
  s.stats.cleans += 1;
  clampVitals(s);
  return ok(s, `${s.name} 洗香香了`);
}

export function play(input: PetState, itemId: string, now: number): PetResult {
  const s = settle(input, now);
  const item = getItem(itemId);
  if (!item || item.category !== 'toy') return fail(s, '这不是玩具');
  if ((s.toys[itemId] ?? 0) <= 0) return fail(s, `「${item.name}」已经玩坏了`);
  s.toys[itemId] -= 1;
  if (s.toys[itemId] <= 0) delete s.toys[itemId];
  applyEffects(s, item, false);
  s.affinity += 1;
  s.exp += 1;
  s.lastPlayAt = now;
  s.stats.plays += 1;
  clampVitals(s);
  return ok(s, `${s.name} 玩得很开心`);
}

export function heal(input: PetState, itemId: string, now: number): PetResult {
  const s = settle(input, now);
  const item = getItem(itemId);
  if (!item || item.category !== 'medicine') return fail(s, '这不是药品');
  if ((s.inventory[itemId] ?? 0) <= 0)
    return fail(s, `库存里没有「${item.name}」`);
  s.inventory[itemId] -= 1;
  applyEffects(s, item, false);
  s.stats.heals += 1;
  if (s.health >= SICK_HEALTH + RECOVER_MARGIN) s.sickSince = 0;
  clampVitals(s);
  return ok(s, `给 ${s.name} 用了「${item.name}」`);
}

export function pat(input: PetState, now: number): PetResult {
  const s = settle(input, now);
  if (now - s.lastPatAt < PAT.cooldownMs) {
    return fail(s, `${s.name} 刚被摸过，喘口气～`);
  }
  s.mood += PAT.mood;
  s.affinity += PAT.affinity;
  s.lastPatAt = now;
  s.stats.pats += 1;
  clampVitals(s);
  return ok(s, '你摸了摸它，它偷偷开心了一下');
}

/** 首次领养命名（免费） */
export function adopt(input: PetState, name: string, now: number): PetResult {
  const s = settle(input, now);
  if (s.adopted) return fail(s, '已经领养过了');
  const v = name.trim();
  s.name = v.length > 0 ? v.slice(0, 12) : DEFAULT_PET_NAME;
  s.adopted = true;
  return ok(s, `欢迎新成员「${s.name}」！`);
}

/** 改名（花费金币） */
export function rename(input: PetState, name: string, now: number): PetResult {
  const s = settle(input, now);
  if (!s.adopted) return fail(s, '还没领养呢');
  const v = name.trim();
  if (!v) return fail(s, '名字不能为空');
  if (s.coin < RENAME_COST) return fail(s, `改名需要 ${RENAME_COST} 金币`);
  s.coin -= RENAME_COST;
  s.name = v.slice(0, 12);
  clampVitals(s);
  return ok(s, `改名成功，花掉 ${RENAME_COST} 金币`);
}

export function buy(
  input: PetState,
  itemId: string,
  qty: number,
  now: number,
): PetResult {
  const s = settle(input, now);
  const item = getItem(itemId);
  if (!item) return fail(s, '没有这件商品');
  const count = Math.max(1, Math.floor(qty));
  const cost = item.price * count;
  if (s.coin < cost) return fail(s, `金币不够（需要 ${cost}）`);
  s.coin -= cost;
  if (item.category === 'toy') {
    s.toys[item.id] = (s.toys[item.id] ?? 0) + count * (item.durability ?? 1);
  } else {
    s.inventory[item.id] = (s.inventory[item.id] ?? 0) + count;
  }
  if (!s.collection.includes(item.id)) s.collection.push(item.id);
  clampVitals(s);
  return ok(s, `购买了 ${count}×「${item.name}」，花费 ${cost} 金币`);
}

export function addActivity(
  input: PetState,
  type: PetActivityType,
  now: number,
): PetResult {
  const s = settle(input, now);
  if (type === 'download') {
    const gain = coinPerDownload(s);
    s.coin += gain;
    s.stats.downloads += 1;
    return ok(s, `下载完成，+${gain} 金币`);
  }
  if (type === 'search') {
    s.exp += EXP_PER_SEARCH;
    s.stats.searches += 1;
    return ok(s);
  }
  s.exp += EXP_PER_BROWSE;
  s.stats.browses += 1;
  return ok(s);
}

export function startWork(
  input: PetState,
  jobId: string,
  minutes: number,
  now: number,
): PetResult {
  const s = settle(input, now);
  const job = jobById(jobId);
  if (!job) return fail(s, '没有这个工种');
  if (!WORK_SHIFTS.some((x) => x.minutes === minutes))
    return fail(s, '没有这个时长');
  if (s.task) return fail(s, `${s.name} 正在忙`);
  if (isSick(s)) return fail(s, `${s.name} 生病了，没法打工`);
  if (!isJobQualified(s, job))
    return fail(s, `能力不够，干不了「${job.name}」`);
  const unit = minutes / 30;
  const energyCost = Math.round(WORK.energyCost * unit);
  if (s.energy < energyCost) return fail(s, '体力不够，先歇歇');
  s.energy -= energyCost;
  s.satiety -= Math.round(WORK.satietyCost * unit);
  s.mood -= Math.round(WORK.moodCost * unit);
  s.lastWorkAt = now;
  const factor = taskDurationFactor(s);
  const realMinutes = Math.max(1, Math.round(minutes * factor));
  s.task = {
    type: 'work',
    startedAt: now,
    endsAt: now + realMinutes * 60000,
    jobId,
    minutes,
  };
  clampVitals(s);
  return ok(s, `${s.name} 去「${job.name}」了，${realMinutes} 分钟后领工资`);
}

export function startStudy(
  input: PetState,
  subjectId: string,
  now: number,
): PetResult {
  const s = settle(input, now);
  const subject = SUBJECT_MAP[subjectId];
  if (!subject) return fail(s, '没有这个学科');
  if (s.task) return fail(s, `${s.name} 正在忙`);
  if (isSick(s)) return fail(s, `${s.name} 生病了，学不进去`);
  const level = skillLevel(s, subjectId);
  if (level >= SKILL_MAX) return fail(s, `「${subject.name}」已经满级了`);
  const cost = skillTuition(level);
  if (s.energy < STUDY.energyCost) return fail(s, '体力不够，先歇歇');
  if (s.coin < cost) return fail(s, `学费不够（需要 ${cost}）`);
  s.coin -= cost;
  s.energy -= STUDY.energyCost;
  s.lastStudyAt = now;
  const factor = taskDurationFactor(s);
  const realMinutes = Math.max(
    1,
    Math.round((STUDY.durationMs / 60000) * factor),
  );
  s.task = {
    type: 'study',
    startedAt: now,
    endsAt: now + realMinutes * 60000,
    subject: subjectId,
    targetLevel: level + 1,
  };
  clampVitals(s);
  return ok(
    s,
    `${s.name} 开始学「${subject.name}」，学费 ${cost}，${realMinutes} 分钟后完成`,
  );
}

export function setSkin(
  input: PetState,
  skinId: string,
  now: number,
): PetResult {
  const s = settle(input, now);
  const skin = skinById(skinId);
  if (skin.id !== skinId) return fail(s, '没有这个皮肤');
  if (!isSkinUnlocked(s, skin)) return fail(s, `「${skin.name}」还没解锁`);
  s.skin = skinId;
  return ok(s, `换上「${skin.name}」啦`);
}

/** 便于 UI 展示：所有皮肤（含解锁状态） */
export { SKINS };
