import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriFileStorage } from './persist/tauri-file-storage';

/** 本地库标签/分类：标签名 → 一级文件夹名列表（saveDirBase 下的一级目录） */
export interface LibraryCategory {
  id: string;
  name: string;
  folders: string[];
}

export interface LibraryStore {
  categories: LibraryCategory[];
  addCategory: (name: string) => string;
  renameCategory: (id: string, name: string) => void;
  removeCategory: (id: string) => void;
  /** 给文件夹添加一个标签（可多标签） */
  addFolderToCategory: (folderName: string, categoryId: string) => void;
  /** 移除文件夹的某个标签 */
  removeFolderFromCategory: (folderName: string, categoryId: string) => void;
  /** 清空文件夹的全部标签 */
  clearFolderCategories: (folderName: string) => void;
  /** 取文件夹所属的全部标签 id */
  getFolderCategoryIds: (folderName: string) => string[];
}

export const useLibraryStore = create(
  persist<LibraryStore>(
    (set, get) => ({
      categories: [],
      addCategory: (name) => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('标签名不能为空');
        const exists = get().categories.some((c) => c.name === trimmed);
        if (exists) throw new Error('已存在同名标签');
        const id = nanoid();
        set({
          categories: [...get().categories, { id, name: trimmed, folders: [] }],
        });
        return id;
      },
      renameCategory: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('标签名不能为空');
        const duplicated = get().categories.some(
          (c) => c.id !== id && c.name === trimmed,
        );
        if (duplicated) throw new Error('已存在同名标签');
        set({
          categories: get().categories.map((c) =>
            c.id === id ? { ...c, name: trimmed } : c,
          ),
        });
      },
      removeCategory: (id) => {
        set({ categories: get().categories.filter((c) => c.id !== id) });
      },
      addFolderToCategory: (folderName, categoryId) => {
        set({
          categories: get().categories.map((c) => {
            if (c.id !== categoryId) return c;
            if (c.folders.includes(folderName)) return c;
            return { ...c, folders: [...c.folders, folderName] };
          }),
        });
      },
      removeFolderFromCategory: (folderName, categoryId) => {
        set({
          categories: get().categories.map((c) => {
            if (c.id !== categoryId) return c;
            if (!c.folders.includes(folderName)) return c;
            return { ...c, folders: c.folders.filter((f) => f !== folderName) };
          }),
        });
      },
      clearFolderCategories: (folderName) => {
        set({
          categories: get().categories.map((c) =>
            c.folders.includes(folderName)
              ? { ...c, folders: c.folders.filter((f) => f !== folderName) }
              : c,
          ),
        });
      },
      getFolderCategoryIds: (folderName) => {
        return get()
          .categories.filter((c) => c.folders.includes(folderName))
          .map((c) => c.id);
      },
    }),
    {
      name: 'library',
      storage: createTauriFileStorage(),
      version: 1,
    },
  ),
);
