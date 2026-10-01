import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { loginHpoi, setHpoiCookie } from '../services/hpoi-album';
import { createTauriFileStorage } from './persist/tauri-file-storage';

/**
 * hpoi 登录态（仅存 `utoken`，不存密码）。
 * 登录 / 退出 / 启动 rehydrate 时把 cookie 注入 `services/hpoi-album`（相册 R18 等需登录）。
 */
export interface HpoiAuthStore {
  utoken: string;
  userName: string;
  userId: number | null;
  login: (
    account: string,
    password: string,
    useEmail: boolean,
  ) => Promise<void>;
  logout: () => void;
}

function applyCookie(utoken: string) {
  setHpoiCookie(utoken ? `utoken=${utoken}` : '');
}

export const useHpoiAuthStore = create(
  persist<HpoiAuthStore>(
    (set) => ({
      utoken: '',
      userName: '',
      userId: null,
      login: async (account, password, useEmail) => {
        const { utoken, raw } = await loginHpoi(account, password, useEmail);
        applyCookie(utoken);
        set({
          utoken,
          userName: raw?.nickname || raw?.name || '',
          userId: raw?.userId ?? raw?.id ?? null,
        });
      },
      logout: () => {
        applyCookie('');
        set({ utoken: '', userName: '', userId: null });
      },
    }),
    {
      name: 'hpoi-auth',
      storage: createTauriFileStorage(),
      version: 1,
      partialize: (s) =>
        ({ utoken: s.utoken, userName: s.userName, userId: s.userId }) as any,
      onRehydrateStorage: () => (state) => {
        if (state?.utoken) applyCookie(state.utoken);
      },
    },
  ),
);
