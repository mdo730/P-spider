import { LibraryTag } from '../../stores/library';

/** 路径归一：反斜杠→正斜杠、去首尾斜杠 */
export function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** 绝对路径 → 相对 saveDirBase 的路径（正斜杠，无首尾斜杠） */
export function toRelPath(absPath: string, saveDirBase: string): string {
  let a = normalizeRel(absPath);
  const base = normalizeRel(saveDirBase);
  if (base && a.toLowerCase().startsWith(`${base}/`.toLowerCase())) {
    a = a.slice(base.length + 1);
  }
  return normalizeRel(a);
}

export interface TagNode extends LibraryTag {
  children: TagNode[];
}

export interface TagIndex {
  byId: Map<string, LibraryTag>;
  roots: TagNode[];
  /** 自身 + 全部子孙 id */
  subtreeIds: (id: string) => Set<string>;
  /** 祖先 id 列表（根 → 直接父级） */
  ancestorIds: (id: string) => string[];
  /** 祖先链名称（含自身），如 ["厂商","GSC"] */
  chainNames: (id: string) => string[];
}

export function buildTagIndex(tags: LibraryTag[]): TagIndex {
  const byId = new Map<string, LibraryTag>();
  for (const t of tags) byId.set(t.id, t);

  const childrenMap = new Map<string | null, LibraryTag[]>();
  for (const t of tags) {
    const key = t.parentId ?? null;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(t);
  }
  for (const list of childrenMap.values()) {
    list.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
  }

  const toNode = (t: LibraryTag): TagNode => ({
    ...t,
    children: (childrenMap.get(t.id) || []).map(toNode),
  });
  const roots = (childrenMap.get(null) || []).map(toNode);

  const ancestorIds = (id: string): string[] => {
    const out: string[] = [];
    let cur = byId.get(id)?.parentId ?? null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      out.unshift(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    return out;
  };

  const subtreeIds = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (out.has(cur)) continue;
      out.add(cur);
      for (const c of childrenMap.get(cur) || []) stack.push(c.id);
    }
    return out;
  };

  const chainNames = (id: string): string[] => {
    const names = ancestorIds(id)
      .map((aid) => byId.get(aid)?.name)
      .filter((n): n is string => !!n);
    const self = byId.get(id)?.name;
    if (self) names.push(self);
    return names;
  };

  return { byId, roots, subtreeIds, ancestorIds, chainNames };
}

/** 某标签的「含子孙」覆盖文件夹集合（含路径自身及其所有祖先目录） */
export function tagCoveredSet(index: TagIndex, tagId: string): Set<string> {
  const set = new Set<string>();
  for (const id of index.subtreeIds(tagId)) {
    const tag = index.byId.get(id);
    if (!tag) continue;
    for (const p of tag.paths) {
      const np = normalizeRel(p);
      if (!np) continue;
      set.add(np);
      const parts = np.split('/');
      for (let i = 1; i < parts.length; i += 1) {
        set.add(parts.slice(0, i).join('/'));
      }
    }
  }
  return set;
}

export type FilterRule = 'intersect' | 'union';

/** 本地库当前筛选状态 */
export interface LibraryFilter {
  kind: 'all' | 'unclassified' | 'tags';
  tagIds: string[];
  rule: FilterRule;
  multi: boolean;
}

export const DEFAULT_LIBRARY_FILTER: LibraryFilter = {
  kind: 'all',
  tagIds: [],
  rule: 'intersect',
  multi: false,
};

/** 单文件夹是否命中标签筛选（union=任一命中，intersect=全部命中，默认 intersect） */
export function matchesFilter(
  index: TagIndex,
  tagIds: string[],
  rule: FilterRule,
  relPath: string,
): boolean {
  if (tagIds.length === 0) return true;
  const np = normalizeRel(relPath);
  const results = tagIds.map((id) => tagCoveredSet(index, id).has(np));
  return rule === 'union' ? results.some(Boolean) : results.every(Boolean);
}

/**
 * 末端标签（xibao 逻辑）：只保留「不是同集合内其它标签的祖先」的标签，避免父+子冗余。
 * 返回顺序沿用输入顺序。
 */
export function terminalTagIds(index: TagIndex, ids: string[]): string[] {
  return ids.filter(
    (id) =>
      !ids.some(
        (other) => other !== id && index.ancestorIds(other).includes(id),
      ),
  );
}

/** 标签链显示文本，如 "厂商 > GSC" */
export function tagChainLabel(index: TagIndex, id: string): string {
  return index.chainNames(id).join(' > ');
}

/** 多选筛选去同链冗余：若已选某标签的祖先/后代，只保留更精确者 */
export function dedupeTagSelection(index: TagIndex, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    const ancestors = index.ancestorIds(id);
    const descendants = index.subtreeIds(id);
    descendants.delete(id);
    return (
      !ancestors.some((a) => set.has(a)) &&
      ![...descendants].some((d) => set.has(d))
    );
  });
}
