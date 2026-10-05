import { create } from 'zustand';
import { FigmemoListItem } from '../services/figmemo';
import {
  readVisualTags,
  requestVisionStop,
  runVisionForItems,
  VisionProgress,
} from '../services/figmemo-visual';

/**
 * WD14 视觉识别运行状态（全局 store）。
 * 放在 store 而非组件里：切换页面/标签、组件卸载重挂都不中断，进度也保留。
 */
interface VisionStore {
  running: boolean;
  progress: VisionProgress | null;
  /** 每轮跑完自增，供列表监听并刷新「已识别」角标 */
  version: number;
  start: (items: FigmemoListItem[]) => void;
  stop: () => void;
}

let _log: ICategoriedLogger | undefined;
function log() {
  if (!_log) _log = window.log.category('VIS');
  return _log;
}

export const useVisionStore = create<VisionStore>((set, get) => ({
  running: false,
  progress: null,
  version: 0,
  start: (items) => {
    if (get().running || items.length === 0) return;
    set({
      running: true,
      progress: { done: 0, total: items.length, index: 0, currentTitle: '' },
    });
    void (async () => {
      try {
        const existing = await readVisualTags();
        await runVisionForItems(items, (p) => set({ progress: p }), existing);
      } catch (err: any) {
        log().error('视觉识别失败', err);
      } finally {
        set((s) => ({
          running: false,
          progress: null,
          version: s.version + 1,
        }));
      }
    })();
  },
  stop: () => requestVisionStop(),
}));
