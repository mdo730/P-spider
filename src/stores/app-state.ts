import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriFileStorage } from './persist/tauri-file-storage';

export interface AppStateStore {
  cookieString: string;
  setCookieString: (cookieString: string) => void;

  searchHistory: string[];
  addSearchHistory: (keyword: string) => void;
  clearSearchHistory: () => void;

  systemProxyUrl: string;
  setSystemProxyUrl: (url: string) => void;

  /** 宠物彩蛋是否已解锁（放在主窗口 store，避免与桌面宠物窗抢写 pet.json） */
  petUnlocked: boolean;
  unlockPet: () => void;
  /** 是否启用桌面宠物（启用则随软件启动显示） */
  petEnabled: boolean;
  setPetEnabled: (enabled: boolean) => void;
}

export const useAppStateStore = create(
  persist<AppStateStore>(
    (set, get) => ({
      cookieString: '',
      setCookieString: (cookieString) => set({ cookieString }),
      searchHistory: [],
      addSearchHistory: (keyword) => {
        const history = get().searchHistory;
        const existsIndex = history.findIndex(
          (v) => v === keyword.toLowerCase(),
        );

        if (existsIndex >= 0) {
          history.splice(existsIndex, 1);
        }

        history.unshift(keyword.toLowerCase());
        set({ searchHistory: history });
      },
      clearSearchHistory: () => set({ searchHistory: [] }),
      systemProxyUrl: '',
      setSystemProxyUrl: (url) => {
        set({ systemProxyUrl: url });
      },
      petUnlocked: false,
      unlockPet: () => set({ petUnlocked: true }),
      petEnabled: false,
      setPetEnabled: (enabled) => set({ petEnabled: enabled }),
    }),
    {
      name: 'app-state',
      storage: createTauriFileStorage(),
      version: 1,
    },
  ),
);
