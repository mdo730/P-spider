import { create } from 'zustand';
import {
  ThumbCacheProgress,
  ThumbCacheResult,
  runThumbCache,
} from '../services/library-thumb-cache';

let controller: AbortController | null = null;

export interface ThumbCacheStore {
  running: boolean;
  phase: 'idle' | 'scanning' | 'generating';
  progress: ThumbCacheProgress | null;
  result: ThumbCacheResult | null;
  error: string | null;
  start: () => Promise<void>;
  cancel: () => void;
}

/** 一键生成缩略图缓存的进度状态（模块常驻，切页不中断） */
export const useThumbCacheStore = create<ThumbCacheStore>((set, get) => ({
  running: false,
  phase: 'idle',
  progress: null,
  result: null,
  error: null,
  start: async () => {
    if (get().running) return;
    controller = new AbortController();
    set({
      running: true,
      error: null,
      result: null,
      phase: 'scanning',
      progress: null,
    });
    try {
      const result = await runThumbCache((progress) => {
        set({ progress, phase: progress.phase });
      }, controller.signal);
      set({ running: false, phase: 'idle', progress: null, result });
    } catch (err: any) {
      log.error('生成缩略图缓存失败', err);
      set({
        running: false,
        phase: 'idle',
        progress: null,
        error: err?.message || '生成失败',
      });
    } finally {
      controller = null;
    }
  },
  cancel: () => {
    controller?.abort();
  },
}));
