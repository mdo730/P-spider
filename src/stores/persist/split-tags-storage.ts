import { PersistStorage } from 'zustand/middleware';
import { createTauriFileStorage } from './tauri-file-storage';

/** 带「自动/手动」来源标记的标签 */
export interface OriginTag {
  origin?: 'auto' | 'user';
}

/** 标签 store 中会被持久化的字段 */
export interface TagsPersistShape {
  tags: OriginTag[];
  folderCovers?: Record<string, string>;
}

/**
 * 标签持久化：把标签按 origin 拆成两个文件
 * - `<baseName>.json`      → 自动标签（站点同步写入）
 * - `<baseName>-user.json` → 手动标签 + 文件夹封面（同步不写）
 * 内存里仍是一个合并数组，UI/索引无需改。
 */
export function createSplitTagsStorage<S extends TagsPersistShape>(
  baseName: string,
): PersistStorage<S> {
  const auto = createTauriFileStorage<S>()!;
  const user = createTauriFileStorage<S>()!;
  const autoName = baseName;
  const userName = `${baseName}-user`;

  const withOrigin = (tags: OriginTag[] | undefined, origin: 'auto' | 'user') =>
    (tags || []).map((t) => ({ ...t, origin })) as OriginTag[];

  return {
    async getItem() {
      const [a, u] = await Promise.all([
        auto.getItem(autoName),
        user.getItem(userName),
      ]);
      if (!a && !u) return null;
      const base = (a?.state || u?.state) as S;
      return {
        state: {
          ...base,
          tags: [
            ...withOrigin(a?.state?.tags, 'auto'),
            ...withOrigin(u?.state?.tags, 'user'),
          ],
          folderCovers: {
            ...(a?.state?.folderCovers || {}),
            ...(u?.state?.folderCovers || {}),
          },
        } as unknown as S,
        version: a?.version ?? u?.version ?? 0,
      };
    },

    async setItem(_name, value) {
      const state = value.state;
      const tags = (state.tags || []) as OriginTag[];
      const autoTags = tags.filter((t) => (t.origin ?? 'auto') !== 'user');
      const userTags = tags.filter((t) => t.origin === 'user');
      await Promise.all([
        auto.setItem(autoName, {
          state: { ...state, tags: autoTags, folderCovers: {} } as unknown as S,
          version: value.version,
        }),
        user.setItem(userName, {
          state: {
            ...state,
            tags: userTags,
            folderCovers: (state as TagsPersistShape).folderCovers || {},
          } as unknown as S,
          version: value.version,
        }),
      ]);
    },

    async removeItem() {
      await Promise.all([auto.removeItem(autoName), user.removeItem(userName)]);
    },
  };
}
