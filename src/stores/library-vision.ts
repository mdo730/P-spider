import { create } from 'zustand';
import {
  readLibraryVisualTags,
  requestLibraryVisionStop,
  runLibraryVision,
} from '../services/library-visual';
import { VisionProgress } from '../services/vision-core';

/**
 * 本地库 WD14 视觉识别运行状态（全局 store）。
 * 放在 store 而非组件里：切文件夹/切页、组件卸载重挂都不中断，进度也保留。
 */
interface LibraryVisionStore {
  running: boolean;
  progress: VisionProgress | null;
  /** 每轮跑完自增，供列表监听并刷新「已识别」角标 */
  version: number;
  start: (paths: string[]) => void;
  stop: () => void;
}

let _log: ICategoriedLogger | undefined;
function log() {
  if (!_log) _log = window.log.category('VIS');
  return _log;
}

export const useLibraryVisionStore = create<LibraryVisionStore>((set, get) => ({
  running: false,
  progress: null,
  version: 0,
  start: (paths) => {
    if (get().running || paths.length === 0) return;
    set({
      running: true,
      progress: { done: 0, total: paths.length, index: 0, currentTitle: '' },
    });
    void (async () => {
      try {
        const existing = await readLibraryVisualTags();
        await runLibraryVision(paths, (p) => set({ progress: p }), existing);
      } catch (err: unknown) {
        log().error('本地库视觉识别失败', err);
      } finally {
        set((s) => ({
          running: false,
          progress: null,
          version: s.version + 1,
        }));
      }
    })();
  },
  stop: () => requestLibraryVisionStop(),
}));
