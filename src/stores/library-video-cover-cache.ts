import { create } from 'zustand';
import {
  ThumbCacheProgress,
  ThumbCacheResult,
  runVideoCoverCache,
} from '../services/library-thumb-cache';

let controller: AbortController | null = null;

export interface VideoCoverCacheStore {
  running: boolean;
  phase: 'idle' | 'scanning' | 'generating';
  progress: ThumbCacheProgress | null;
  result: ThumbCacheResult | null;
  error: string | null;
  start: () => Promise<void>;
  cancel: () => void;
}

/** 一键「溯源本地库封面图」：给本地视频用在线封面填缩略图缓存（模块常驻，切页不中断） */
export const useVideoCoverCacheStore = create<VideoCoverCacheStore>(
  (set, get) => ({
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
        const result = await runVideoCoverCache((progress) => {
          set({ progress, phase: progress.phase });
        }, controller.signal);
        set({ running: false, phase: 'idle', progress: null, result });
      } catch (err: any) {
        log.error('溯源本地库封面失败', err);
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
  }),
);
