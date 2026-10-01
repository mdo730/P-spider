import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { refreshHpoiIntel } from '../services/hpoi-intel';
import { syncHpoiIncremental } from '../services/hpoi-delta';
import { createTauriFileStorage } from './persist/tauri-file-storage';

/**
 * hpoi 情报（只读浏览，无建库/下载）。
 * `featureEnabled` 决定左侧是否显示「hpoi」选项卡，以及时间流是否纳入 hpoi 情报。
 */
export interface HpoiIntelStore {
  /** 是否启用 hpoi 情报功能（时间流独立开关 + 侧栏选项卡显隐） */
  featureEnabled: boolean;
  /** 进时间流的分类 id（多选；**空数组 = 不进时间流**） */
  categoryIds: number[];
  /** 时间流只显示与收藏相关的情报（收藏的词条 / 其关联的厂商·作品·角色等） */
  favoritesOnly: boolean;
  /** 实体页词条展示：详细（封面+名称+厂商分类）/ 简略（小缩略图） */
  entityView: 'detail' | 'compact';
  setFeatureEnabled: (enabled: boolean) => void;
  setCategoryIds: (ids: number[]) => void;
  setFavoritesOnly: (v: boolean) => void;
  setEntityView: (v: 'detail' | 'compact') => void;
}

export const useHpoiIntelStore = create(
  persist<HpoiIntelStore>(
    (set, get) => ({
      featureEnabled: false,
      categoryIds: [100],
      favoritesOnly: false,
      entityView: 'detail',
      setFavoritesOnly: (favoritesOnly) => set({ favoritesOnly }),
      setEntityView: (entityView) => set({ entityView }),
      setFeatureEnabled: (featureEnabled) => {
        set({ featureEnabled });
        // 首次启用即后台抓一次（同 moeyo），否则时间流只读缓存会一直空
        if (featureEnabled) {
          refreshHpoiIntel(30, get().categoryIds).catch(() => {
            // ignore
          });
          // 顺便增量补齐新词条（距上次 <12h 会自动跳过）
          syncHpoiIncremental(false).catch(() => {
            // ignore
          });
        }
      },
      setCategoryIds: (categoryIds) => {
        set({ categoryIds });
        if (get().featureEnabled) {
          refreshHpoiIntel(30, categoryIds).catch(() => {
            // ignore
          });
        }
      },
    }),
    {
      name: 'hpoi-intel-state',
      storage: createTauriFileStorage(),
      version: 1,
    },
  ),
);
