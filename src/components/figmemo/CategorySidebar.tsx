/* eslint-disable react/prop-types */
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Dropdown,
  Input,
  Modal,
  Segmented,
  Tag,
  Tree,
  TreeSelect,
} from 'antd';
import type { DataNode, TreeProps } from 'antd/es/tree';
import React, { useMemo, useState } from 'react';
import { useFigmemoTagsStore } from '../../stores/figmemo-tags';
import {
  FilterRule,
  LibraryFilter,
  TagNode,
  buildTagIndex,
  dedupeTagSelection,
} from '../../utils/library';

interface Props {
  filter: LibraryFilter;
  counts: { all: number; unclassified: number; byId: Record<string, number> };
  onChange: (filter: LibraryFilter) => void;
}

function toTreeData(nodes: TagNode[]): DataNode[] {
  return nodes.map((n) => ({
    key: `t_${n.id}`,
    title: n.name,
    children: n.children.length ? toTreeData(n.children) : undefined,
  }));
}

/** 本地库左栏：标签树（多级、可拖拽改父级）+ 全部/未打标签 + 多选筛选（交集/并集） */
export const CategorySidebar: React.FC<Props> = ({
  filter,
  counts,
  onChange,
}) => {
  const { modal, message } = App.useApp();
  const tags = useFigmemoTagsStore((s) => s.tags);
  const addTag = useFigmemoTagsStore((s) => s.addTag);
  const renameTag = useFigmemoTagsStore((s) => s.renameTag);
  const removeTag = useFigmemoTagsStore((s) => s.removeTag);
  const moveTag = useFigmemoTagsStore((s) => s.moveTag);

  const index = useMemo(() => buildTagIndex(tags), [tags]);
  const treeData = useMemo(() => toTreeData(index.roots), [index]);

  const [editModal, setEditModal] = useState<
    | { mode: 'create'; parentId: string | null }
    | { mode: 'rename'; id: string; initial: string }
    | null
  >(null);
  const [nameInput, setNameInput] = useState('');
  const [moveId, setMoveId] = useState<string | null>(null);
  const [moveParent, setMoveParent] = useState<string | null>(null);

  const setFilter = (patch: Partial<LibraryFilter>) =>
    onChange({ ...filter, ...patch });

  const selectedKeys = filter.tagIds.map((id) => `t_${id}`);

  const onSelect: TreeProps['onSelect'] = (keys) => {
    const ids = (keys as string[]).map((k) => String(k).slice(2));
    if (filter.multi) {
      const deduped = dedupeTagSelection(index, ids);
      setFilter({ tagIds: deduped });
    } else {
      const one = ids.length ? [ids[ids.length - 1]] : [];
      setFilter({ tagIds: one });
    }
  };

  // 「移动到…」可选的目标父级（排除自身及其子孙）
  const moveOptions = useMemo(() => {
    if (!moveId) return [];
    const exclude = index.subtreeIds(moveId);
    const build = (nodes: TagNode[]): any[] =>
      nodes
        .filter((n) => !exclude.has(n.id))
        .map((n) => ({
          value: n.id,
          title: n.name,
          children: n.children.length ? build(n.children) : undefined,
        }));
    return build(index.roots);
  }, [moveId, index]);

  const confirmMove = () => {
    if (!moveId) return;
    try {
      const childCount = tags.filter(
        (t) => (t.parentId ?? null) === moveParent,
      ).length;
      moveTag(moveId, moveParent, childCount);
      setMoveId(null);
    } catch (err: any) {
      message.error(err?.message || '移动失败');
    }
  };

  const confirmDelete = (id: string) => {
    const node = index.byId.get(id);
    modal.confirm({
      title: `删除标签「${node?.name || ''}」？`,
      content: '将同时删除其所有子标签；文件夹本身不会被删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        const removed = index.subtreeIds(id);
        removeTag(id);
        if (filter.tagIds.some((tid) => removed.has(tid))) {
          setFilter({ tagIds: [] });
        }
      },
    });
  };

  const openCreateRoot = () => {
    setNameInput('');
    setEditModal({ mode: 'create', parentId: null });
  };

  const onNodeAction = (key: string, id: string) => {
    if (key === 'child') {
      setNameInput('');
      setEditModal({ mode: 'create', parentId: id });
    } else if (key === 'rename') {
      const node = index.byId.get(id);
      setNameInput(node?.name || '');
      setEditModal({ mode: 'rename', id, initial: node?.name || '' });
    } else if (key === 'move') {
      setMoveParent(index.byId.get(id)?.parentId ?? null);
      setMoveId(id);
    } else if (key === 'delete') {
      confirmDelete(id);
    }
  };

  const confirmEdit = () => {
    if (!editModal) return;
    try {
      if (editModal.mode === 'create') {
        addTag(nameInput, editModal.parentId);
      } else {
        renameTag(editModal.id, nameInput);
      }
      setEditModal(null);
    } catch (err: any) {
      message.error(err?.message || '操作失败');
    }
  };

  const renderTitle: TreeProps['titleRender'] = (node) => {
    const id = String(node.key).slice(2);
    const name = index.byId.get(id)?.name || '';
    const count = counts.byId[id] || 0;
    return (
      <span className="group flex w-full items-center gap-1 pr-1 min-w-0">
        <span className="truncate" title={name}>
          {name}
        </span>
        {count > 0 && <span className="text-xs text-gray-400">{count}</span>}
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'child', label: '新建子标签', icon: <PlusOutlined /> },
              { key: 'rename', label: '重命名', icon: <EditOutlined /> },
              { key: 'move', label: '移动到…' },
              { type: 'divider' },
              {
                key: 'delete',
                label: '删除',
                icon: <DeleteOutlined />,
                danger: true,
              },
            ],
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation();
              onNodeAction(key, id);
            },
          }}
        >
          <button
            aria-label="标签操作"
            className="ml-auto opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            ⋯
          </button>
        </Dropdown>
      </span>
    );
  };

  return (
    <aside
      aria-label="本地库标签"
      className="w-60 shrink-0 flex flex-col bg-white border-[1px] border-gray-200 rounded-md overflow-hidden"
    >
      <div className="p-2 flex items-center gap-1 flex-wrap border-b-[1px] border-gray-100">
        <Button
          size="small"
          type={
            !filter.unclassifiedOnly && filter.tagIds.length === 0
              ? 'primary'
              : 'default'
          }
          onClick={() => setFilter({ tagIds: [], unclassifiedOnly: false })}
        >
          全部 <span className="opacity-60 ml-1">{counts.all}</span>
        </Button>
        <Button
          size="small"
          type={filter.unclassifiedOnly ? 'primary' : 'default'}
          onClick={() =>
            setFilter({ unclassifiedOnly: !filter.unclassifiedOnly })
          }
        >
          未打标签{' '}
          <span className="opacity-60 ml-1">{counts.unclassified}</span>
        </Button>
      </div>

      <div className="p-2 flex items-center gap-1 flex-wrap border-b-[1px] border-gray-100">
        <Button size="small" icon={<PlusOutlined />} onClick={openCreateRoot}>
          新建标签
        </Button>
        <Button
          size="small"
          type={filter.multi ? 'primary' : 'default'}
          onClick={() => {
            const nextMulti = !filter.multi;
            const tagIds =
              !nextMulti && filter.tagIds.length > 1
                ? [filter.tagIds[filter.tagIds.length - 1]]
                : filter.tagIds;
            setFilter({ multi: nextMulti, tagIds });
          }}
        >
          多标签
        </Button>
        {filter.multi && (
          <Segmented
            size="small"
            value={filter.rule}
            onChange={(v) => setFilter({ rule: v as FilterRule })}
            options={[
              { label: '交集', value: 'intersect' },
              { label: '并集', value: 'union' },
            ]}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {index.roots.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-300">暂无标签</p>
        ) : (
          <Tree
            blockNode
            multiple={filter.multi}
            selectable
            selectedKeys={selectedKeys}
            treeData={treeData}
            titleRender={renderTitle}
            onSelect={onSelect}
          />
        )}
      </div>

      {filter.multi && filter.tagIds.length > 0 && (
        <div className="p-2 border-t-[1px] border-gray-100 flex flex-wrap gap-1">
          {filter.tagIds.map((id) => (
            <Tag
              key={id}
              closable
              onClose={(e) => {
                e.preventDefault();
                const next = filter.tagIds.filter((x) => x !== id);
                setFilter({ tagIds: next });
              }}
            >
              {index.byId.get(id)?.name}
            </Tag>
          ))}
        </div>
      )}

      <Modal
        open={!!editModal}
        title={editModal?.mode === 'rename' ? '重命名标签' : '新建标签'}
        okText={editModal?.mode === 'rename' ? '保存' : '创建'}
        cancelText="取消"
        onOk={confirmEdit}
        onCancel={() => setEditModal(null)}
        destroyOnClose
      >
        <Input
          autoFocus
          value={nameInput}
          placeholder="标签名，如 ALTER"
          onChange={(e) => setNameInput(e.target.value)}
          onPressEnter={confirmEdit}
        />
      </Modal>

      <Modal
        open={!!moveId}
        title={`移动「${moveId ? index.byId.get(moveId)?.name : ''}」到`}
        okText="移动"
        cancelText="取消"
        onOk={confirmMove}
        onCancel={() => setMoveId(null)}
        destroyOnClose
      >
        <TreeSelect
          style={{ width: '100%' }}
          value={moveParent ?? '__root__'}
          treeDefaultExpandAll
          treeData={[{ value: '__root__', title: '（顶层）' }, ...moveOptions]}
          onChange={(v) => setMoveParent(v === '__root__' ? null : v)}
        />
      </Modal>
    </aside>
  );
};
