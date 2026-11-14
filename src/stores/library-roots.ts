import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriFileStorage } from './persist/tauri-file-storage';
import { useSettingsStore } from './settings';

/** 默认库根：恒存在、路径动态取「设置 → 下载 → 保存路径」 */
export const DEFAULT_ROOT_ID = 'default';

export interface LibraryRoot {
  id: string;
  /** 显示名 */
  name: string;
  /** 绝对路径（默认根存空串，动态取 saveDirBase） */
  path: string;
  /** true = 外部根：不参与联网溯源 / 平台标记 / 时间流本地标签匹配 */
  external: boolean;
}

interface LibraryRootsStore {
  /** 外部库根（默认根不在此列表，虚拟存在） */
  roots: LibraryRoot[];
  activeRootId: string;
  setActiveRoot: (id: string) => void;
  addRoot: (name: string, path: string) => string;
  renameRoot: (id: string, name: string) => void;
  /** 仅删除配置，绝不删除磁盘文件 */
  removeRoot: (id: string) => void;
}

export const useLibraryRootsStore = create(
  persist<LibraryRootsStore>(
    (set, get) => ({
      roots: [],
      activeRootId: DEFAULT_ROOT_ID,
      setActiveRoot: (id) => set({ activeRootId: id }),
      addRoot: (name, path) => {
        const id = nanoid();
        const trimmed = name.trim() || path;
        set({
          roots: [...get().roots, { id, name: trimmed, path, external: true }],
        });
        return id;
      },
      renameRoot: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set({
          roots: get().roots.map((r) =>
            r.id === id ? { ...r, name: trimmed } : r,
          ),
        });
      },
      removeRoot: (id) => {
        const { activeRootId } = get();
        set({
          roots: get().roots.filter((r) => r.id !== id),
          activeRootId: activeRootId === id ? DEFAULT_ROOT_ID : activeRootId,
        });
      },
    }),
    {
      name: 'library-roots',
      storage: createTauriFileStorage(),
      version: 1,
    },
  ),
);

/** 解析库根的真实绝对路径（默认根跟随设置的下载目录） */
export function resolveRootPath(rootId: string): string {
  if (rootId === DEFAULT_ROOT_ID) {
    return useSettingsStore.getState().download.saveDirBase || '';
  }
  return (
    useLibraryRootsStore.getState().roots.find((r) => r.id === rootId)?.path ||
    ''
  );
}
