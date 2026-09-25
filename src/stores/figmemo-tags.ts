import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriFileStorage } from './persist/tauri-file-storage';

/** 本地库标签（多级树） */
export interface LibraryTag {
  id: string;
  name: string;
  /** 父标签 id；null = 根标签 */
  parentId: string | null;
  /** 直接挂到该标签的文件夹（相对 saveDirBase 的正斜杠路径，可含子文件夹） */
  paths: string[];
  /** 同级排序 */
  sortOrder: number;
}

export interface LibraryStore {
  tags: LibraryTag[];
  /** 自定义缩略图：一级文件夹名 → 用作封面的图片绝对路径 */
  folderCovers: Record<string, string>;

  /** 新建标签（parentId 为 null 表示根标签）；同级重名报错 */
  addTag: (name: string, parentId?: string | null) => string;
  renameTag: (id: string, name: string) => void;
  /** 删除标签（含其所有子孙标签及关联） */
  removeTag: (id: string) => void;
  /** 移动标签到新父级 + 同级位置（order 为 0-based） */
  moveTag: (id: string, parentId: string | null, order: number) => void;

  /** 覆盖某文件夹（相对路径）的标签集合 */
  setFolderTags: (relPath: string, tagIds: string[]) => void;
  /** 批量给文件夹追加标签（多选追加=并集） */
  addFolderTags: (relPaths: string[], tagIds: string[]) => void;
  /** 取某文件夹（相对路径）的标签 id 列表 */
  getFolderTagIds: (relPath: string) => string[];

  /** 批量取/建标签（已存在则复用），返回 `parentId\u0000name` → id */
  addTagsBatch: (
    specs: { name: string; parentId: string | null }[],
  ) => Record<string, string>;
  /** 批量设置文件夹→标签关系（一次写入，取并集） */
  applyFolderTags: (entries: { relPath: string; tagIds: string[] }[]) => void;
  /** 批量移除文件夹与标签的关联 */
  removeFolderTags: (relPaths: string[], tagIds: string[]) => void;

  /** 设置一级文件夹的自定义缩略图（传 null 恢复默认） */
  setFolderCover: (folderName: string, filePath: string | null) => void;
  /** 取一级文件夹的自定义缩略图路径 */
  getFolderCover: (folderName: string) => string | undefined;
}

/** 取某标签及其全部子孙的 id 集合（含自身） */
function descendantIds(tags: LibraryTag[], id: string): Set<string> {
  const childrenOf = new Map<string | null, string[]>();
  for (const t of tags) {
    const key = t.parentId ?? null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(t.id);
  }
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const c of childrenOf.get(cur) || []) stack.push(c);
  }
  return out;
}

export const useFigmemoTagsStore = create(
  persist<LibraryStore>(
    (set, get) => ({
      tags: [],
      folderCovers: {},

      addTag: (name, parentId = null) => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('标签名不能为空');
        const pid = parentId ?? null;
        const siblings = get().tags.filter((t) => (t.parentId ?? null) === pid);
        if (siblings.some((t) => t.name === trimmed)) {
          throw new Error('同级已存在同名标签');
        }
        const id = nanoid();
        const sortOrder = siblings.length
          ? Math.max(...siblings.map((t) => t.sortOrder)) + 1
          : 0;
        set({
          tags: [
            ...get().tags,
            { id, name: trimmed, parentId: pid, paths: [], sortOrder },
          ],
        });
        return id;
      },

      renameTag: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('标签名不能为空');
        const node = get().tags.find((t) => t.id === id);
        if (!node) return;
        const pid = node.parentId ?? null;
        const duplicated = get().tags.some(
          (t) =>
            t.id !== id && (t.parentId ?? null) === pid && t.name === trimmed,
        );
        if (duplicated) throw new Error('同级已存在同名标签');
        set({
          tags: get().tags.map((t) =>
            t.id === id ? { ...t, name: trimmed } : t,
          ),
        });
      },

      removeTag: (id) => {
        const ids = descendantIds(get().tags, id);
        set({ tags: get().tags.filter((t) => !ids.has(t.id)) });
      },

      moveTag: (id, parentId, order) => {
        const tags = get().tags;
        const node = tags.find((t) => t.id === id);
        if (!node) return;
        const pid = parentId ?? null;
        if (pid) {
          if (pid === id || descendantIds(tags, id).has(pid)) {
            throw new Error('不能移动到自身或其子标签下');
          }
        }
        const siblings = tags
          .filter((t) => t.id !== id && (t.parentId ?? null) === pid)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        const insertAt = Math.max(0, Math.min(order, siblings.length));
        siblings.splice(insertAt, 0, node);
        const orderMap = new Map(siblings.map((t, i) => [t.id, i]));
        set({
          tags: tags.map((t) => {
            if (t.id === id) {
              return { ...t, parentId: pid, sortOrder: orderMap.get(id) ?? 0 };
            }
            if (orderMap.has(t.id)) {
              return { ...t, sortOrder: orderMap.get(t.id)! };
            }
            return t;
          }),
        });
      },

      setFolderTags: (relPath, tagIds) => {
        let changed = false;
        const next = get().tags.map((t) => {
          const should = tagIds.includes(t.id);
          const has = t.paths.includes(relPath);
          if (should && !has) {
            changed = true;
            return { ...t, paths: [...t.paths, relPath] };
          }
          if (!should && has) {
            changed = true;
            return { ...t, paths: t.paths.filter((p) => p !== relPath) };
          }
          return t;
        });
        if (changed) set({ tags: next });
      },

      addFolderTags: (relPaths, tagIds) => {
        if (relPaths.length === 0 || tagIds.length === 0) return;
        let changed = false;
        const next = get().tags.map((t) => {
          if (!tagIds.includes(t.id)) return t;
          const missing = relPaths.filter((p) => !t.paths.includes(p));
          if (missing.length === 0) return t;
          changed = true;
          return { ...t, paths: [...t.paths, ...missing] };
        });
        if (changed) set({ tags: next });
      },

      getFolderTagIds: (relPath) =>
        get()
          .tags.filter((t) => t.paths.includes(relPath))
          .map((t) => t.id),

      addTagsBatch: (specs) => {
        const tagKey = (pid: string | null, name: string) =>
          `${pid ?? ''}\u0000${name}`;
        const tags = get().tags;
        const result: Record<string, string> = {};
        const byKey = new Map<string, string>();
        for (const t of tags) {
          byKey.set(tagKey(t.parentId ?? null, t.name), t.id);
        }
        const nextOrder = new Map<string | null, number>();
        for (const t of tags) {
          const k = t.parentId ?? null;
          nextOrder.set(k, Math.max(nextOrder.get(k) ?? -1, t.sortOrder));
        }
        const created: LibraryTag[] = [];
        for (const spec of specs) {
          const name = spec.name.trim();
          if (!name) continue;
          const pid = spec.parentId ?? null;
          const k = tagKey(pid, name);
          if (byKey.has(k)) {
            result[k] = byKey.get(k)!;
            continue;
          }
          const id = nanoid();
          const sortOrder = (nextOrder.get(pid) ?? -1) + 1;
          nextOrder.set(pid, sortOrder);
          created.push({ id, name, parentId: pid, paths: [], sortOrder });
          byKey.set(k, id);
          result[k] = id;
        }
        if (created.length) set({ tags: [...tags, ...created] });
        return result;
      },

      applyFolderTags: (entries) => {
        if (entries.length === 0) return;
        let changed = false;
        const next = get().tags.map((t) => {
          const adds: string[] = [];
          for (const e of entries) {
            if (e.tagIds.includes(t.id) && !t.paths.includes(e.relPath)) {
              adds.push(e.relPath);
            }
          }
          if (adds.length) {
            changed = true;
            return { ...t, paths: [...t.paths, ...adds] };
          }
          return t;
        });
        if (changed) set({ tags: next });
      },

      removeFolderTags: (relPaths, tagIds) => {
        if (relPaths.length === 0 || tagIds.length === 0) return;
        let changed = false;
        const next = get().tags.map((t) => {
          if (!tagIds.includes(t.id)) return t;
          const filtered = t.paths.filter((p) => !relPaths.includes(p));
          if (filtered.length === t.paths.length) return t;
          changed = true;
          return { ...t, paths: filtered };
        });
        if (changed) set({ tags: next });
      },

      setFolderCover: (folderName, filePath) => {
        set((state) => {
          const next = { ...state.folderCovers };
          if (filePath) next[folderName] = filePath;
          else delete next[folderName];
          return { folderCovers: next };
        });
      },
      getFolderCover: (folderName) => get().folderCovers[folderName],
    }),
    {
      name: 'figmemo-tags',
      storage: createTauriFileStorage(),
      version: 2,
      migrate(state: any, version) {
        if (version < 2) {
          state.tags = (state.categories || []).map(
            (c: any, index: number) => ({
              id: c.id,
              name: c.name,
              parentId: null,
              paths: c.folders || [],
              sortOrder: index,
            }),
          );
          delete state.categories;
        }
        return state;
      },
    },
  ),
);
