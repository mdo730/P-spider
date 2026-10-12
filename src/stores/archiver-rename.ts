import { getErrorMessage } from '../utils/error';
import { create } from 'zustand';
import {
  RenameProgress,
  RenameResult,
  runArchiverRename,
} from '../services/archiver-rename';

let controller: AbortController | null = null;

export interface ArchiverRenameStore {
  running: boolean;
  progress: RenameProgress | null;
  result: RenameResult | null;
  error: string | null;
  start: () => Promise<void>;
  cancel: () => void;
}

/** 归档站文件名回溯（联网）的运行状态（模块常驻，切页不中断） */
export const useArchiverRenameStore = create<ArchiverRenameStore>(
  (set, get) => ({
    running: false,
    progress: null,
    result: null,
    error: null,
    start: async () => {
      if (get().running) return;
      controller = new AbortController();
      set({ running: true, error: null, result: null, progress: null });
      try {
        const result = await runArchiverRename(
          (progress) => set({ progress }),
          controller.signal,
        );
        set({ running: false, progress: null, result });
      } catch (err: unknown) {
        log.error('归档站文件名回溯失败', err);
        set({
          running: false,
          progress: null,
          error: getErrorMessage(err) || '回溯失败',
        });
      } finally {
        controller = null;
      }
    },
    cancel: () => controller?.abort(),
  }),
);
