import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriFileStorage } from './persist/tauri-file-storage';

/** fig-memo 文章收藏（postId 集合，独立于标签，存 %APPDATA%\p-spider\figmemo-favorites.json） */
interface FigmemoFavoritesStore {
  ids: string[];
  isFavorite: (postId: string) => boolean;
  toggle: (postId: string) => void;
  remove: (postId: string) => void;
}

export const useFigmemoFavoritesStore = create(
  persist<FigmemoFavoritesStore>(
    (set, get) => ({
      ids: [],
      isFavorite: (postId) => get().ids.includes(String(postId)),
      toggle: (postId) => {
        const id = String(postId);
        const has = get().ids.includes(id);
        set({
          ids: has ? get().ids.filter((x) => x !== id) : [...get().ids, id],
        });
      },
      remove: (postId) => {
        const id = String(postId);
        set({ ids: get().ids.filter((x) => x !== id) });
      },
    }),
    {
      name: 'figmemo-favorites',
      storage: createTauriFileStorage(),
      version: 1,
    },
  ),
);
