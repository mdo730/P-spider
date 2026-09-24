/* eslint-disable react/prop-types */
import { Modal, Tree } from 'antd';
import type { DataNode, TreeProps } from 'antd/es/tree';
import React, { useEffect, useMemo, useState } from 'react';
import { useLibraryStore } from '../../stores/library';
import { TagNode, buildTagIndex } from '../../utils/library';

interface Props {
  open: boolean;
  /** 目标文件夹相对路径集合 */
  targets: string[];
  /** 展示用标题（如文件夹名/“N 个文件夹”） */
  label?: string;
  onClose: () => void;
}

function toCheckData(nodes: TagNode[]): DataNode[] {
  return nodes.map((n) => ({
    key: `t_${n.id}`,
    title: n.name,
    children: n.children.length ? toCheckData(n.children) : undefined,
  }));
}

/**
 * 打标签弹窗：树形多选。
 * 单选文件夹=覆盖；多选文件夹=追加（并集，不取消已有）。
 */
export const TagAssignModal: React.FC<Props> = ({
  open,
  targets,
  label,
  onClose,
}) => {
  const tags = useLibraryStore((s) => s.tags);
  const index = useMemo(() => buildTagIndex(tags), [tags]);
  const treeData = useMemo(() => toCheckData(index.roots), [index]);
  const [checked, setChecked] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const store = useLibraryStore.getState();
    let ids: string[];
    if (targets.length <= 1) {
      ids = targets[0] ? store.getFolderTagIds(targets[0]) : [];
    } else {
      ids = targets.reduce<string[]>((acc, t, i) => {
        const s = store.getFolderTagIds(t);
        return i === 0 ? s : acc.filter((id) => s.includes(id));
      }, []);
    }
    setChecked(ids.map((id) => `t_${id}`));
  }, [open, targets]);

  const onCheck: TreeProps['onCheck'] = (keys) => {
    const arr = Array.isArray(keys) ? keys : keys.checked;
    setChecked(arr.map((k) => String(k)));
  };

  const onOk = () => {
    const store = useLibraryStore.getState();
    const ids = checked.map((k) => k.slice(2));
    if (targets.length <= 1) {
      if (targets[0]) store.setFolderTags(targets[0], ids);
    } else {
      store.addFolderTags(targets, ids);
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      title={label ? `标签：${label}` : '打标签'}
      okText="确定"
      cancelText="取消"
      onOk={onOk}
      onCancel={onClose}
      destroyOnClose
    >
      {targets.length > 1 && (
        <p className="text-xs text-gray-400 mb-2">
          多选批量：仅追加勾选的标签，不会取消已有标签
        </p>
      )}
      {index.roots.length === 0 ? (
        <p className="text-sm text-gray-400">还没有标签，请先在左侧新建</p>
      ) : (
        <div className="max-h-80 overflow-y-auto">
          <Tree
            checkable
            checkStrictly
            defaultExpandAll
            treeData={treeData}
            checkedKeys={{ checked, halfChecked: [] }}
            onCheck={onCheck}
          />
        </div>
      )}
    </Modal>
  );
};
