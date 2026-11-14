import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_ROOT_ID } from './library-roots';
import { createTauriFileStorage } from './persist/tauri-file-storage';

/** 本地库标签/分类：按「库根」分桶，每个根一套多级标签树 */
export interface LibraryCategory {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  folders: string[];
}

/** 同级标签（按 order 排序） */
export function categorySiblings(
  categories: LibraryCategory[],
  parentId: string | null,
): LibraryCategory[] {
  return categories
    .filter((c) => (c.parentId ?? null) === parentId)
    .sort((a, b) => a.order - b.order);
}

/** 标签自身 + 所有后代 id */
export function collectCategorySubtree(
  categories: LibraryCategory[],
  id: string,
): Set<string> {
  const out = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of categories) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        changed = true;
      }
    }
  }
  return out;
}

/** 标签完整路径：`父 / 子` */
export function categoryPath(
  categories: LibraryCategory[],
  id: string,
): string {
  const map = new Map(categories.map((c) => [c.id, c]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let current = map.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? map.get(current.parentId) : undefined;
  }
  return parts.join(' / ');
}

/** 稳定空数组，避免 selector 每次返回新引用导致重渲染 */
export const EMPTY_CATEGORIES: LibraryCategory[] = [];

interface LibraryStore {
  /** 库根 id → 该根的分类标签 */
  categoriesByRoot: Record<string, LibraryCategory[]>;
  /** 库根 id → (一级文件夹名 → 封面绝对路径) */
  coversByRoot: Record<string, Record<string, string>>;

  getCategories: (rootId: string) => LibraryCategory[];

  addCategory: (
    rootId: string,
    name: string,
    parentId?: string | null,
  ) => string;
  renameCategory: (rootId: string, id: string, name: string) => void;
  removeCategory: (rootId: string, id: string) => void;

  /** 给某根的一级文件夹添加一个标签（可多标签） */
  addFolderToCategory: (
    rootId: string,
    folderName: string,
    categoryId: string,
  ) => void;
  removeFolderFromCategory: (
    rootId: string,
    folderName: string,
    categoryId: string,
  ) => void;
  clearFolderCategories: (rootId: string, folderName: string) => void;
  getFolderCategoryIds: (rootId: string, folderName: string) => string[];

  setFolderCover: (
    rootId: string,
    folderName: string,
    filePath: string | null,
  ) => void;
  getFolderCover: (rootId: string, folderName: string) => string | undefined;
}

export const useLibraryStore = create(
  persist<LibraryStore>(
    (set, get) => ({
      categoriesByRoot: {},
      coversByRoot: {},

      getCategories: (rootId) =>
        get().categoriesByRoot[rootId] ?? EMPTY_CATEGORIES,

      addCategory: (rootId, name, parentId = null) => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('标签名不能为空');
        const cats = get().categoriesByRoot[rootId] ?? [];
        if (parentId && !cats.some((c) => c.id === parentId)) {
          throw new Error('父标签不存在');
        }
        const siblings = categorySiblings(cats, parentId);
        if (siblings.some((c) => c.name === trimmed)) {
          throw new Error('同级已存在同名标签');
        }
        const id = nanoid();
        const order =
          siblings.reduce((max, c) => Math.max(max, c.order), -1) + 1;
        set({
          categoriesByRoot: {
            ...get().categoriesByRoot,
            [rootId]: [
              ...cats,
              { id, name: trimmed, parentId, order, folders: [] },
            ],
          },
        });
        return id;
      },
      renameCategory: (rootId, id, name) => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('标签名不能为空');
        const cats = get().categoriesByRoot[rootId] ?? [];
        const target = cats.find((c) => c.id === id);
        const parentId = target?.parentId ?? null;
        if (
          categorySiblings(cats, parentId).some(
            (c) => c.id !== id && c.name === trimmed,
          )
        ) {
          throw new Error('同级已存在同名标签');
        }
        set({
          categoriesByRoot: {
            ...get().categoriesByRoot,
            [rootId]: cats.map((c) =>
              c.id === id ? { ...c, name: trimmed } : c,
            ),
          },
        });
      },
      removeCategory: (rootId, id) => {
        const cats = get().categoriesByRoot[rootId] ?? [];
        const subtree = collectCategorySubtree(cats, id);
        set({
          categoriesByRoot: {
            ...get().categoriesByRoot,
            [rootId]: cats.filter((c) => !subtree.has(c.id)),
          },
        });
      },
      addFolderToCategory: (rootId, folderName, categoryId) => {
        const cats = get().categoriesByRoot[rootId] ?? [];
        set({
          categoriesByRoot: {
            ...get().categoriesByRoot,
            [rootId]: cats.map((c) => {
              if (c.id !== categoryId) return c;
              if (c.folders.includes(folderName)) return c;
              return { ...c, folders: [...c.folders, folderName] };
            }),
          },
        });
      },
      removeFolderFromCategory: (rootId, folderName, categoryId) => {
        const cats = get().categoriesByRoot[rootId] ?? [];
        set({
          categoriesByRoot: {
            ...get().categoriesByRoot,
            [rootId]: cats.map((c) => {
              if (c.id !== categoryId) return c;
              if (!c.folders.includes(folderName)) return c;
              return {
                ...c,
                folders: c.folders.filter((f) => f !== folderName),
              };
            }),
          },
        });
      },
      clearFolderCategories: (rootId, folderName) => {
        const cats = get().categoriesByRoot[rootId] ?? [];
        set({
          categoriesByRoot: {
            ...get().categoriesByRoot,
            [rootId]: cats.map((c) =>
              c.folders.includes(folderName)
                ? {
                    ...c,
                    folders: c.folders.filter((f) => f !== folderName),
                  }
                : c,
            ),
          },
        });
      },
      getFolderCategoryIds: (rootId, folderName) =>
        (get().categoriesByRoot[rootId] ?? [])
          .filter((c) => c.folders.includes(folderName))
          .map((c) => c.id),

      setFolderCover: (rootId, folderName, filePath) => {
        const covers = { ...(get().coversByRoot[rootId] ?? {}) };
        if (filePath) covers[folderName] = filePath;
        else delete covers[folderName];
        set({
          coversByRoot: { ...get().coversByRoot, [rootId]: covers },
        });
      },
      getFolderCover: (rootId, folderName) =>
        get().coversByRoot[rootId]?.[folderName],
    }),
    {
      name: 'library',
      storage: createTauriFileStorage(),
      version: 3,
      migrate(state: any, version) {
        let next = state;
        if (version < 2) {
          next = {
            categoriesByRoot: { [DEFAULT_ROOT_ID]: state?.categories ?? [] },
            coversByRoot: { [DEFAULT_ROOT_ID]: state?.folderCovers ?? {} },
          };
        }
        if (version < 3) {
          const categoriesByRoot: Record<string, LibraryCategory[]> = {};
          for (const [rootId, cats] of Object.entries(
            next?.categoriesByRoot ?? {},
          )) {
            categoriesByRoot[rootId] = (cats as LibraryCategory[]).map(
              (c, index) => ({
                ...c,
                parentId: c.parentId ?? null,
                order: typeof c.order === 'number' ? c.order : index,
              }),
            );
          }
          next = { ...next, categoriesByRoot };
        }
        return next;
      },
    },
  ),
);
