import { create } from 'zustand';

/**
 * 设置页 UI 状态（非持久化）：当前激活的分组（左栏二级导航）。
 * 放在 store 里是为了让「新手引导」能从外部切到指定分组。
 */
interface SettingsUiStore {
  /** 当前分组：general / download / platform / sites / tools */
  tab: string;
  setTab: (tab: string) => void;
}

export const useSettingsUiStore = create<SettingsUiStore>((set) => ({
  tab: 'general',
  setTab: (tab) => set({ tab }),
}));
