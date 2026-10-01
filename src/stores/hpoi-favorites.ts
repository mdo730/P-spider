import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriFileStorage } from './persist/tauri-file-storage';

/**
 * hpoi 收藏（词条 / 厂商 / 系列 / 作品 / 角色 / 原型 统一一个收藏）。
 * key 形如 `<kind>:<id>`，存 `%APPDATA%\p-spider\hpoi-favorites.json`。
 */
export const hpoiFavKey = (kind: string, id: number | string) =>
  `${kind}:${id}`;

interface HpoiFavoritesStore {
  ids: string[];
  has: (key: string) => boolean;
  toggle: (key: string) => void;
  remove: (key: string) => void;
  clear: () => void;
}

export const useHpoiFavoritesStore = create(
  persist<HpoiFavoritesStore>(
    (set, get) => ({
      ids: [],
      has: (key) => get().ids.includes(key),
      toggle: (key) =>
        set({
          ids: get().ids.includes(key)
            ? get().ids.filter((x) => x !== key)
            : [...get().ids, key],
        }),
      remove: (key) => set({ ids: get().ids.filter((x) => x !== key) }),
      clear: () => set({ ids: [] }),
    }),
    {
      name: 'hpoi-favorites',
      storage: createTauriFileStorage(),
      version: 1,
    },
  ),
);
