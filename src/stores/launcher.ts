import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriFileStorage } from './persist/tauri-file-storage';

export type LauncherEntryKind = 'exe' | 'folder' | 'shortcut';

export interface LauncherEntry {
  id: string;
  path: string;
  name: string;
  kind: LauncherEntryKind;
  iconMode: 'auto' | 'custom';
  /** 自定义图标文件绝对路径（iconMode === 'custom' 时有效） */
  customIcon?: string;
  tagIds: string[];
  order: number;
  createdAt: number;
}

export interface LauncherTag {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
}

interface LauncherStore {
  /** 功能总开关：默认关闭，在设置里开启后才显示侧栏入口 */
  featureEnabled: boolean;
  entries: LauncherEntry[];
  tags: LauncherTag[];
  setFeatureEnabled: (enabled: boolean) => void;
  addEntry: (input: {
    path: string;
    name: string;
    kind: LauncherEntryKind;
  }) => string;
  updateEntry: (id: string, patch: Partial<Omit<LauncherEntry, 'id'>>) => void;
  removeEntry: (id: string) => void;
  setEntryTags: (id: string, tagIds: string[]) => void;
  /** 把 draggedId 移到 targetId 前面（全局顺序） */
  moveEntry: (draggedId: string, targetId: string) => void;
  addTag: (name: string, parentId?: string | null) => string;
  renameTag: (id: string, name: string) => void;
  /** 删除标签及其所有子标签；条目只解除关联，不删除 */
  removeTag: (id: string) => void;
}

function nextEntryOrder(entries: LauncherEntry[]): number {
  return entries.reduce((max, e) => Math.max(max, e.order), -1) + 1;
}

function nextTagOrder(tags: LauncherTag[], parentId: string | null): number {
  return (
    tags
      .filter((t) => t.parentId === parentId)
      .reduce((max, t) => Math.max(max, t.order), -1) + 1
  );
}

/** 标签自身 + 所有后代 id */
export function collectTagSubtree(
  tags: LauncherTag[],
  id: string,
): Set<string> {
  const out = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const tag of tags) {
      if (tag.parentId && out.has(tag.parentId) && !out.has(tag.id)) {
        out.add(tag.id);
        changed = true;
      }
    }
  }
  return out;
}

type PersistedLauncher = Pick<
  LauncherStore,
  'featureEnabled' | 'entries' | 'tags'
>;

export const useLauncherStore = create(
  persist<LauncherStore, [], [], PersistedLauncher>(
    (set, get) => ({
      featureEnabled: false,
      entries: [],
      tags: [],
      setFeatureEnabled: (enabled) => set({ featureEnabled: enabled }),
      addEntry: ({ path, name, kind }) => {
        const id = nanoid();
        const trimmed = name.trim() || path.split(/[\\/]/).pop() || path;
        set((s) => ({
          entries: [
            ...s.entries,
            {
              id,
              path,
              name: trimmed,
              kind,
              iconMode: 'auto',
              tagIds: [],
              order: nextEntryOrder(s.entries),
              createdAt: Date.now(),
            },
          ],
        }));
        return id;
      },
      updateEntry: (id, patch) => {
        set((s) => ({
          entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        }));
      },
      removeEntry: (id) => {
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
      },
      setEntryTags: (id, tagIds) => {
        const unique = [...new Set(tagIds)];
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === id ? { ...e, tagIds: unique } : e,
          ),
        }));
      },
      moveEntry: (draggedId, targetId) => {
        if (draggedId === targetId) return;
        const entries = [...get().entries].sort((a, b) => a.order - b.order);
        const from = entries.findIndex((e) => e.id === draggedId);
        if (from < 0) return;
        const [moved] = entries.splice(from, 1);
        const to = entries.findIndex((e) => e.id === targetId);
        entries.splice(to < 0 ? entries.length : to, 0, moved);
        set({ entries: entries.map((e, i) => ({ ...e, order: i })) });
      },
      addTag: (name, parentId = null) => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('标签名不能为空');
        if (parentId && !get().tags.some((t) => t.id === parentId)) {
          throw new Error('父标签不存在');
        }
        const id = nanoid();
        set((s) => ({
          tags: [
            ...s.tags,
            {
              id,
              name: trimmed,
              parentId,
              order: nextTagOrder(s.tags, parentId),
            },
          ],
        }));
        return id;
      },
      renameTag: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((s) => ({
          tags: s.tags.map((t) => (t.id === id ? { ...t, name: trimmed } : t)),
        }));
      },
      removeTag: (id) => {
        const descendants = collectTagSubtree(get().tags, id);
        set((s) => ({
          tags: s.tags.filter((t) => !descendants.has(t.id)),
          entries: s.entries.map((e) =>
            e.tagIds.some((t) => descendants.has(t))
              ? { ...e, tagIds: e.tagIds.filter((t) => !descendants.has(t)) }
              : e,
          ),
        }));
      },
    }),
    {
      name: 'launcher',
      storage: createTauriFileStorage(),
      version: 1,
      partialize: (state) => ({
        featureEnabled: state.featureEnabled,
        entries: state.entries,
        tags: state.tags,
      }),
    },
  ),
);
