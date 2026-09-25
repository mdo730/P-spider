import dayjs from 'dayjs';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  FIGMEMO_FEED_ID,
  FIGMEMO_SOURCE,
  FigmemoProgress,
  fetchNewestPostDate,
  runFigmemoBuild,
  runFigmemoCheck,
  syncLocalTags,
} from '../services/figmemo';
import { onTaskCompleted } from './download';
import { createTauriFileStorage } from './persist/tauri-file-storage';

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('FIG');
  return _log;
}

/** 追新检查间隔：24 小时 */
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

export interface FigmemoStore {
  /** 是否启用 fig-memo 功能（决定左侧选项卡是否显示） */
  featureEnabled: boolean;
  /** 已开启的分类（开关=订阅该分类） */
  enabledCategories: number[];
  /** 首次开启的时间基线 */
  startedAt: number | null;
  /** 上次检查时间 */
  lastCheckedAt: number | null;
  /** 追新基线（最新已处理的帖子发布时间 ISO） */
  baselineDate: string | null;
  dailyStats: Record<string, { count: number; bytes: number }>;
  downloadedCount: number;
  lastError: string | null;

  /** 运行时（不持久化） */
  running: boolean;
  progress: FigmemoProgress | null;

  /** 开启/关闭某分类的订阅 */
  setCategoryEnabled: (categoryId: number, enabled: boolean) => Promise<void>;
  /** 启用/停用 fig-memo 功能（选项卡显隐） */
  setFeatureEnabled: (enabled: boolean) => void;
  /** 建库：下载已开启分类的现存文章（可限定年份） */
  build: (opts?: {
    fromYear?: number;
    toYear?: number;
  }) => Promise<{ posts: number; images: number } | void>;
  /** 立即检查已开启分类的新文章（刷新按钮 / 24h 调度共用） */
  checkNow: () => Promise<void>;
  /** 按本地文件夹同步标签（补标签按钮用） */
  syncTags: () => Promise<number>;
}

export const useFigmemoStore = create(
  persist<FigmemoStore>(
    (set, get) => ({
      featureEnabled: false,
      enabledCategories: [],
      startedAt: null,
      lastCheckedAt: null,
      baselineDate: null,
      dailyStats: {},
      downloadedCount: 0,
      lastError: null,
      running: false,
      progress: null,

      setFeatureEnabled: (enabled) => {
        set({ featureEnabled: enabled });
      },

      setCategoryEnabled: async (categoryId, enabled) => {
        const cur = get().enabledCategories;
        const next = enabled
          ? cur.includes(categoryId)
            ? cur
            : [...cur, categoryId]
          : cur.filter((id) => id !== categoryId);
        const wasEmpty = cur.length === 0;
        set({ enabledCategories: next, lastError: null });
        // 首次开启：记录基线（从此刻起算新文章，不回补历史）
        if (enabled && wasEmpty) {
          set({ startedAt: Date.now(), lastCheckedAt: Date.now() });
          try {
            const newest = await fetchNewestPostDate();
            set({ baselineDate: newest });
          } catch (err: any) {
            log().error('fig-memo 初始化基线失败', err);
            set({ lastError: err?.message || '初始化失败' });
          }
        }
      },

      build: async (opts) => {
        if (get().running) return;
        const ids = get().enabledCategories;
        if (ids.length === 0) {
          set({ lastError: '请先开启至少一个分类' });
          return;
        }
        set({
          running: true,
          lastError: null,
          progress: { phase: 'building', total: 0, done: 0 },
        });
        try {
          const result = await runFigmemoBuild(
            ids,
            { fromYear: opts?.fromYear, toYear: opts?.toYear },
            (p) => set({ progress: p }),
            new AbortController().signal,
          );
          const newest = await fetchNewestPostDate().catch(() => null);
          set({
            running: false,
            progress: null,
            lastCheckedAt: Date.now(),
            baselineDate: newest ?? get().baselineDate,
          });
          return result;
        } catch (err: any) {
          log().error('fig-memo 建库失败', err);
          set({
            running: false,
            progress: null,
            lastError: err?.message || '建库失败',
          });
        }
      },

      checkNow: async () => {
        if (get().running) return;
        const ids = get().enabledCategories;
        if (ids.length === 0) {
          set({ lastError: '请先开启至少一个分类' });
          return;
        }
        set({
          running: true,
          lastError: null,
          progress: { phase: 'checking', total: 0, done: 0 },
        });
        try {
          const res = await runFigmemoCheck(
            get().baselineDate,
            ids,
            (p) => set({ progress: p }),
            new AbortController().signal,
          );
          set({
            running: false,
            progress: null,
            lastCheckedAt: Date.now(),
            baselineDate: res.newestDate ?? get().baselineDate,
          });
        } catch (err: any) {
          log().error('fig-memo 追新失败', err);
          set({
            running: false,
            progress: null,
            lastCheckedAt: Date.now(),
            lastError: err?.message || '检查失败',
          });
        }
      },

      syncTags: async () => {
        return await syncLocalTags();
      },
    }),
    {
      name: 'figmemo-state',
      storage: createTauriFileStorage(),
      version: 1,
      partialize: (state) =>
        ({
          featureEnabled: state.featureEnabled,
          enabledCategories: state.enabledCategories,
          startedAt: state.startedAt,
          lastCheckedAt: state.lastCheckedAt,
          baselineDate: state.baselineDate,
          dailyStats: state.dailyStats,
          downloadedCount: state.downloadedCount,
          lastError: state.lastError,
        }) as any,
    },
  ),
);

// 下载完成 → 计入 fig-memo 统计（只计「追新」任务，建库不计）
onTaskCompleted.listen((task) => {
  if (
    task.source !== FIGMEMO_SOURCE ||
    task.subscriptionId !== FIGMEMO_FEED_ID
  ) {
    return;
  }
  const key = dayjs(task.updatedAt).format('YYYY-MM-DD');
  const state = useFigmemoStore.getState();
  const daily = { ...state.dailyStats };
  const cur = daily[key] || { count: 0, bytes: 0 };
  daily[key] = {
    count: cur.count + 1,
    bytes: cur.bytes + (Number.isFinite(task.totalSize) ? task.totalSize : 0),
  };
  useFigmemoStore.setState({
    dailyStats: daily,
    downloadedCount: state.downloadedCount + 1,
  });
});

// 后台调度：每分钟看一次是否到点（24h）
async function tick() {
  const state = useFigmemoStore.getState();
  if (state.enabledCategories.length > 0 && !state.running) {
    const due =
      !state.lastCheckedAt ||
      Date.now() - state.lastCheckedAt >= CHECK_INTERVAL;
    if (due) {
      await state.checkNow();
    }
  }
  setTimeout(tick, 60 * 1000);
}

tick();
