import { create } from 'zustand';
import { GUIDE_CHAPTERS, type GuideChapter } from '../content/guide-tours';

/**
 * 分章「假界面」引导播放器状态。
 * - open(id)：只播某一章
 * - playAll()：按顺序连续播放全部章
 */
interface GuidePlayerStore {
  /** 当前要播放的章节列表（null=关闭）；单章=1 项，全流程=全部 */
  chapters: GuideChapter[] | null;
  open: (sectionId: string) => void;
  playAll: () => void;
  close: () => void;
}

export const useGuidePlayerStore = create<GuidePlayerStore>((set) => ({
  chapters: null,
  open: (sectionId) => {
    const chapter = GUIDE_CHAPTERS.find((c) => c.id === sectionId);
    if (chapter) set({ chapters: [chapter] });
  },
  playAll: () => {
    if (GUIDE_CHAPTERS.length) set({ chapters: [...GUIDE_CHAPTERS] });
  },
  close: () => set({ chapters: null }),
}));
