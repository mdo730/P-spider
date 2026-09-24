import { create } from 'zustand';
import {
  TraceProgress,
  TraceResult,
  runLibraryTrace,
} from '../services/library-trace';

let controller: AbortController | null = null;

export interface LibraryTraceStore {
  running: boolean;
  phase: 'idle' | 'scanning' | 'tracing';
  progress: TraceProgress | null;
  result: TraceResult | null;
  error: string | null;
  start: () => Promise<void>;
  cancel: () => void;
}

/** 本地库联网溯源（方向 B）的进度状态（模块常驻，切页不中断） */
export const useLibraryTraceStore = create<LibraryTraceStore>((set, get) => ({
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
      const result = await runLibraryTrace((progress) => {
        set({ progress, phase: progress.phase });
      }, controller.signal);
      set({ running: false, phase: 'idle', progress: null, result });
    } catch (err: any) {
      log.error('联网溯源失败', err);
      set({
        running: false,
        phase: 'idle',
        progress: null,
        error: err?.message || '溯源失败',
      });
    } finally {
      controller = null;
    }
  },
  cancel: () => {
    controller?.abort();
  },
}));
