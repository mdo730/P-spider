import { create } from 'zustand';

/**
 * 站点缓存版本号：时间流刷新 fig-memo / moeyo 站点列表后 +1，
 * 用来让 fig-memo / moeyo 页的会话级列表缓存失效（否则跳过去还是旧列表）。
 */
interface SiteCacheStore {
  version: number;
  bump: () => void;
}

export const useSiteCacheStore = create<SiteCacheStore>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
