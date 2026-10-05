import { create } from 'zustand';

export interface Wd14PromptSource {
  localPath?: string;
  remoteUrl?: string;
  headers?: Record<string, string>;
}

interface Wd14PromptStore {
  open: boolean;
  source: Wd14PromptSource | null;
  openWith: (source: Wd14PromptSource) => void;
  close: () => void;
}

/** 全局「WD14 提示词反推」弹窗状态（图片右键菜单触发） */
export const useWd14PromptStore = create<Wd14PromptStore>((set) => ({
  open: false,
  source: null,
  openWith: (source) => set({ open: true, source }),
  close: () => set({ open: false, source: null }),
}));
