import { useCallback, useState } from 'react';

export interface Selection<T> {
  selected: Set<T>;
  isSelected: (key: T) => boolean;
  toggle: (key: T) => void;
  toggleAll: () => void;
  clear: () => void;
  selectedCount: number;
  allSelected: boolean;
}

/**
 * 多选状态管理：基于一份「可见项」列表计算选中数与是否全选。
 * 切换视图/目录时调用 `clear()` 即可。
 */
export function useSelection<T>(visibleKeys: T[]): Selection<T> {
  const [selected, setSelected] = useState<Set<T>>(new Set());

  const isSelected = useCallback((key: T) => selected.has(key), [selected]);

  const toggle = useCallback((key: T) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const allVisibleSelected =
        visibleKeys.length > 0 && visibleKeys.every((k) => prev.has(k));
      return allVisibleSelected ? new Set<T>() : new Set(visibleKeys);
    });
  }, [visibleKeys]);

  const clear = useCallback(() => setSelected(new Set<T>()), []);

  const selectedCount = visibleKeys.filter((k) => selected.has(k)).length;
  const allSelected =
    visibleKeys.length > 0 && selectedCount === visibleKeys.length;

  return {
    selected,
    isSelected,
    toggle,
    toggleAll,
    clear,
    selectedCount,
    allSelected,
  };
}
