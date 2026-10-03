/**
 * 学习学科 & 打工工种（数据驱动）。
 *
 * 学科 = 能力：学习某学科提升对应能力；工种有学科门槛，收益受对应能力加成。
 */

export interface Subject {
  id: string;
  name: string;
  emoji: string;
}

export const SUBJECTS: Subject[] = [
  { id: 'code', name: '编程', emoji: '💻' },
  { id: 'art', name: '绘画', emoji: '🎨' },
  { id: 'lang', name: '语言', emoji: '🌐' },
  { id: 'music', name: '音乐', emoji: '🎵' },
  { id: 'sport', name: '体育', emoji: '🏃' },
];

export const SUBJECT_MAP: Record<string, Subject> = Object.fromEntries(
  SUBJECTS.map((s) => [s.id, s]),
);

/** 学科等级上限 */
export const SKILL_MAX = 5;

/** 学科从 level 升到 level+1 的学费 */
export function skillTuition(level: number): number {
  return 150 * (level + 1);
}

export interface Job {
  id: string;
  name: string;
  emoji: string;
  /** 依赖的学科（空字符串 = 无门槛体力活） */
  subject: string;
  /** 门槛：对应学科等级需达到 */
  minSkill: number;
  /** 基础工资 */
  base: number;
}

export const JOBS: Job[] = [
  {
    id: 'flyer',
    name: '发传单',
    emoji: '📄',
    subject: '',
    minSkill: 0,
    base: 6,
  },
  {
    id: 'deliver',
    name: '跑腿外卖',
    emoji: '🛵',
    subject: 'sport',
    minSkill: 1,
    base: 12,
  },
  {
    id: 'sing',
    name: '街头演出',
    emoji: '🎤',
    subject: 'music',
    minSkill: 1,
    base: 14,
  },
  {
    id: 'draw',
    name: '插画接单',
    emoji: '🖼️',
    subject: 'art',
    minSkill: 2,
    base: 20,
  },
  {
    id: 'tutor',
    name: '家教',
    emoji: '📖',
    subject: 'lang',
    minSkill: 2,
    base: 22,
  },
  {
    id: 'codejob',
    name: '程序外包',
    emoji: '⌨️',
    subject: 'code',
    minSkill: 2,
    base: 26,
  },
];

export const JOB_MAP: Record<string, Job> = Object.fromEntries(
  JOBS.map((j) => [j.id, j]),
);

export function jobById(id?: string): Job | undefined {
  if (!id) return undefined;
  return JOB_MAP[id];
}

/** 打工人可选时长（分钟） */
export interface WorkShift {
  minutes: number;
  label: string;
}

export const WORK_SHIFTS: WorkShift[] = [
  { minutes: 30, label: '30分' },
  { minutes: 60, label: '60分' },
  { minutes: 120, label: '2小时' },
  { minutes: 240, label: '4小时' },
];
