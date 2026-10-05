/**
 * 宠物 store（薄封装）：只负责持久化 + 调用 core。
 *
 * ⚠️ 本 store 只在**桌面宠物窗**里实例化（独占写入 pet.json），
 * 主窗口不要 import 本模块，避免两个 webview 抢写存档。
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriFileStorage } from '../stores/persist/tauri-file-storage';
import { PET_STORAGE_NAME, PET_STATE_VERSION } from './constants';
import * as engine from './engine';
import type { PetResult } from './engine';
import type { PetActivityType, PetState } from './types';

export interface PetStore extends PetState {
  adopt: (name: string, now?: number) => PetResult;
  rename: (name: string, now?: number) => PetResult;
  sync: (now?: number) => void;
  reset: () => void;

  pat: (now?: number) => PetResult;
  feed: (itemId: string, now?: number) => PetResult;
  clean: (itemId: string, now?: number) => PetResult;
  play: (itemId: string, now?: number) => PetResult;
  heal: (itemId: string, now?: number) => PetResult;
  buy: (itemId: string, qty: number, now?: number) => PetResult;
  startWork: (jobId: string, minutes: number, now?: number) => PetResult;
  startStudy: (subjectId: string, now?: number) => PetResult;
  setSkin: (skinId: string, now?: number) => PetResult;
  setSoundOn: (on: boolean) => void;
  setPhraseOn: (on: boolean) => void;
  setShanghaiOn: (on: boolean) => void;
  buyIndustry: (id: string, now?: number) => PetResult;
  rewardHua: (now?: number) => PetResult;
  addActivity: (type: PetActivityType, now?: number) => PetResult;
}

export const usePetStore = create(
  persist<PetStore>(
    (set, get) => ({
      ...engine.createInitialState(Date.now()),

      adopt: (name, now) => {
        const r = engine.adopt(get(), name, now ?? Date.now());
        set(r.state);
        return r;
      },
      rename: (name, now) => {
        const r = engine.rename(get(), name, now ?? Date.now());
        set(r.state);
        return r;
      },
      sync: (now) => set(engine.settle(get(), now ?? Date.now())),
      reset: () => set(engine.createInitialState(Date.now())),

      pat: (now) => {
        const r = engine.pat(get(), now ?? Date.now());
        set(r.state);
        return r;
      },
      feed: (itemId, now) => {
        const r = engine.feed(get(), itemId, now ?? Date.now());
        set(r.state);
        return r;
      },
      clean: (itemId, now) => {
        const r = engine.clean(get(), itemId, now ?? Date.now());
        set(r.state);
        return r;
      },
      play: (itemId, now) => {
        const r = engine.play(get(), itemId, now ?? Date.now());
        set(r.state);
        return r;
      },
      heal: (itemId, now) => {
        const r = engine.heal(get(), itemId, now ?? Date.now());
        set(r.state);
        return r;
      },
      buy: (itemId, qty, now) => {
        const r = engine.buy(get(), itemId, qty, now ?? Date.now());
        set(r.state);
        return r;
      },
      startWork: (jobId, minutes, now) => {
        const r = engine.startWork(get(), jobId, minutes, now ?? Date.now());
        set(r.state);
        return r;
      },
      startStudy: (subjectId, now) => {
        const r = engine.startStudy(get(), subjectId, now ?? Date.now());
        set(r.state);
        return r;
      },
      setSkin: (skinId, now) => {
        const r = engine.setSkin(get(), skinId, now ?? Date.now());
        set(r.state);
        return r;
      },
      setSoundOn: (on) => set({ soundOn: on }),
      setPhraseOn: (on) => set({ phraseOn: on }),
      setShanghaiOn: (on) => set({ shanghaiOn: on }),
      buyIndustry: (id, now) => {
        const r = engine.buyIndustry(get(), id, now ?? Date.now());
        set(r.state);
        return r;
      },
      rewardHua: (now) => {
        const r = engine.rewardHua(get(), now ?? Date.now());
        set(r.state);
        return r;
      },
      addActivity: (type, now) => {
        const r = engine.addActivity(get(), type, now ?? Date.now());
        set(r.state);
        return r;
      },
    }),
    {
      name: PET_STORAGE_NAME,
      storage: createTauriFileStorage(),
      version: PET_STATE_VERSION,
    },
  ),
);
