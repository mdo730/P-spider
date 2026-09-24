import dayjs from 'dayjs';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  FIGMEMO_SOURCE,
  FigmemoProgress,
  fetchNewestPostDate,
  runFigmemoBuild,
  runFigmemoCheck,
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
  enabled: boolean;
  /** 开启时间基线 */
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

  setEnabled: (enabled: boolean) => Promise<void>;
  build: () => Promise<{ posts: number; images: number } | void>;
}

export const useFigmemoStore = create(
  persist<FigmemoStore>(
    (set, get) => ({
      enabled: false,
      startedAt: null,
      lastCheckedAt: null,
      baselineDate: null,
      dailyStats: {},
      downloadedCount: 0,
      lastError: null,
      running: false,
      progress: null,

      setEnabled: async (enabled) => {
        if (!enabled) {
          set({ enabled: false });
          return;
        }
        // 开启：记录基线（当前最新帖），从此刻起算，不回补历史
        set({
          enabled: true,
          startedAt: Date.now(),
          lastCheckedAt: Date.now(),
          lastError: null,
        });
        try {
          const newest = await fetchNewestPostDate();
          set({ baselineDate: newest });
        } catch (err: any) {
          log().error('fig-memo 初始化基线失败', err);
          set({ lastError: err?.message || '初始化失败' });
        }
      },

      build: async () => {
        if (get().running) return;
        set({
          running: true,
          lastError: null,
          progress: { phase: 'building', total: 0, done: 0 },
        });
        const controller = new AbortController();
        try {
          const result = await runFigmemoBuild(
            (p) => set({ progress: p }),
            controller.signal,
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
    }),
    {
      name: 'figmemo-state',
      storage: createTauriFileStorage(),
      version: 1,
      partialize: (state) =>
        ({
          enabled: state.enabled,
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

// 下载完成 → 计入 fig-memo 统计（独立项）
onTaskCompleted.listen((task) => {
  if (task.source !== FIGMEMO_SOURCE) return;
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
  if (state.enabled && !state.running) {
    const due =
      !state.lastCheckedAt ||
      Date.now() - state.lastCheckedAt >= CHECK_INTERVAL;
    if (due) {
      useFigmemoStore.setState({
        running: true,
        lastError: null,
        progress: { phase: 'checking', total: 0, done: 0 },
      });
      const controller = new AbortController();
      try {
        const res = await runFigmemoCheck(
          state.baselineDate,
          (p) => useFigmemoStore.setState({ progress: p }),
          controller.signal,
        );
        useFigmemoStore.setState({
          running: false,
          progress: null,
          lastCheckedAt: Date.now(),
          baselineDate: res.newestDate ?? state.baselineDate,
        });
      } catch (err: any) {
        log().error('fig-memo 追新失败', err);
        useFigmemoStore.setState({
          running: false,
          progress: null,
          lastCheckedAt: Date.now(),
          lastError: err?.message || '检查失败',
        });
      }
    }
  }
  setTimeout(tick, 60 * 1000);
}

tick();
