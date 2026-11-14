import { getErrorMessage } from '../../utils/error';
import {
  AppstoreOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  InboxOutlined,
  PlusOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { App, Button, Dropdown, Input, MenuProps, Modal } from 'antd';
import clsx from 'clsx';
import React, { useState } from 'react';
import {
  EMPTY_CATEGORIES,
  LibraryCategory,
  categorySiblings,
  collectCategorySubtree,
  useLibraryStore,
} from '../../stores/library';

export const ALL_CATEGORY_ID = 'all';
export const UNCLASSIFIED_CATEGORY_ID = 'unclassified';

interface Props {
  rootId: string;
  selectedId: string;
  onSelect: (id: string) => void;
  counts: { all: number; unclassified: number; byId: Record<string, number> };
  /** 侧栏顶部插槽（库根切换器等） */
  header?: React.ReactNode;
}

type EditState =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'rename'; category: LibraryCategory };

/** 本地库标签树（多级） */
export const CategorySidebar: React.FC<Props> = ({
  rootId,
  selectedId,
  onSelect,
  counts,
  header,
}) => {
  const { modal, message } = App.useApp();
  const categories = useLibraryStore(
    (s) => s.categoriesByRoot[rootId] ?? EMPTY_CATEGORIES,
  );
  const addCategory = useLibraryStore((s) => s.addCategory);
  const renameCategory = useLibraryStore((s) => s.renameCategory);
  const removeCategory = useLibraryStore((s) => s.removeCategory);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editState, setEditState] = useState<EditState | null>(null);
  const [nameInput, setNameInput] = useState('');

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreate = (parentId: string | null) => {
    setNameInput('');
    setEditState({ mode: 'create', parentId });
  };

  const openRename = (category: LibraryCategory) => {
    setNameInput(category.name);
    setEditState({ mode: 'rename', category });
  };

  const confirmEdit = () => {
    if (!editState) return;
    try {
      if (editState.mode === 'create') {
        const id = addCategory(rootId, nameInput, editState.parentId);
        onSelect(id);
      } else {
        renameCategory(rootId, editState.category.id, nameInput);
      }
      setEditState(null);
    } catch (err: unknown) {
      message.error(getErrorMessage(err) || '操作失败');
    }
  };

  const confirmDelete = (category: LibraryCategory) => {
    const subtree = collectCategorySubtree(categories, category.id);
    modal.confirm({
      title: `删除标签「${category.name}」？`,
      content:
        subtree.size > 1
          ? '其所有子标签也会被删除；文件夹只会解除关联，不会被删除。'
          : '仅删除标签，文件夹本身不会被删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        removeCategory(rootId, category.id);
        if (subtree.has(selectedId)) onSelect(ALL_CATEGORY_ID);
      },
    });
  };

  const renderNodes = (
    parentId: string | null,
    depth: number,
  ): React.ReactNode =>
    categorySiblings(categories, parentId).map((category) => {
      const children = categorySiblings(categories, category.id);
      const isCollapsed = collapsed.has(category.id);
      return (
        <li key={category.id}>
          <TagRow
            category={category}
            depth={depth}
            count={counts.byId[category.id] || 0}
            active={selectedId === category.id}
            hasChildren={children.length > 0}
            collapsed={isCollapsed}
            onToggle={() => toggle(category.id)}
            onSelect={() => onSelect(category.id)}
            onAddChild={() => openCreate(category.id)}
            onRename={() => openRename(category)}
            onRemove={() => confirmDelete(category)}
          />
          {!isCollapsed && children.length > 0 && (
            <ul>{renderNodes(category.id, depth + 1)}</ul>
          )}
        </li>
      );
    });

  const isCreatingChild =
    editState?.mode === 'create' && editState.parentId !== null;

  return (
    <aside
      aria-label="本地库标签"
      className="w-56 shrink-0 flex flex-col bg-white border-[1px] border-gray-200 rounded-md overflow-hidden"
    >
      {header && (
        <div className="p-2 border-b-[1px] border-gray-100">{header}</div>
      )}
      <ul className="flex-1 overflow-y-auto py-2">
        <li>
          <CategoryItem
            active={selectedId === ALL_CATEGORY_ID}
            icon={<AppstoreOutlined />}
            name="全部"
            count={counts.all}
            onClick={() => onSelect(ALL_CATEGORY_ID)}
          />
        </li>
        <li>
          <CategoryItem
            active={selectedId === UNCLASSIFIED_CATEGORY_ID}
            icon={<InboxOutlined />}
            name="未打标签"
            count={counts.unclassified}
            onClick={() => onSelect(UNCLASSIFIED_CATEGORY_ID)}
          />
        </li>
        <li className="px-3 pt-3 pb-1 text-xs text-gray-400">自定义标签</li>
        {categories.some((c) => (c.parentId ?? null) === null) ? (
          renderNodes(null, 0)
        ) : (
          <li className="px-3 py-1 text-xs text-gray-300">暂无标签</li>
        )}
      </ul>
      <div className="p-3 border-t-[1px] border-gray-100">
        <Button block icon={<PlusOutlined />} onClick={() => openCreate(null)}>
          新建标签
        </Button>
      </div>

      <Modal
        open={!!editState}
        title={
          editState?.mode === 'rename'
            ? '重命名标签'
            : isCreatingChild
              ? '新建子标签'
              : '新建标签'
        }
        okText={editState?.mode === 'rename' ? '保存' : '创建'}
        cancelText="取消"
        onOk={confirmEdit}
        onCancel={() => setEditState(null)}
        destroyOnClose
      >
        <Input
          autoFocus
          value={nameInput}
          placeholder="分类名，如 真人cos"
          onChange={(e) => setNameInput(e.target.value)}
          onPressEnter={confirmEdit}
        />
        {isCreatingChild && (
          <p className="mt-2 text-xs text-gray-400">
            将创建为「
            {
              categories.find(
                (c) =>
                  editState?.mode === 'create' && c.id === editState.parentId,
              )?.name
            }
            」的子标签
          </p>
        )}
      </Modal>
    </aside>
  );
};

interface TagRowProps {
  category: LibraryCategory;
  depth: number;
  count: number;
  active: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onAddChild: () => void;
  onRename: () => void;
  onRemove: () => void;
}

const TagRow: React.FC<TagRowProps> = ({
  category,
  depth,
  count,
  active,
  hasChildren,
  collapsed,
  onToggle,
  onSelect,
  onAddChild,
  onRename,
  onRemove,
}) => {
  const menu: MenuProps = {
    items: [
      { key: 'child', label: '新建子标签', icon: <PlusOutlined /> },
      { key: 'rename', label: '重命名', icon: <EditOutlined /> },
      {
        key: 'delete',
        label: '删除',
        icon: <DeleteOutlined />,
        danger: true,
      },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === 'child') onAddChild();
      if (key === 'rename') onRename();
      if (key === 'delete') onRemove();
    },
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect();
      }}
      style={{ paddingLeft: 12 + depth * 14 }}
      className={clsx(
        'group w-full flex items-center pr-2 py-2 text-sm transition-colors cursor-pointer',
        active
          ? 'bg-ant-color-primary-bg text-ant-color-primary'
          : 'hover:bg-gray-50 text-gray-700',
      )}
    >
      <button
        type="button"
        aria-label={collapsed ? '展开' : '折叠'}
        className={clsx(
          'mr-1 flex h-4 w-4 shrink-0 items-center justify-center text-[10px]',
          hasChildren ? 'text-gray-400 hover:text-gray-700' : 'invisible',
        )}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {collapsed ? <RightOutlined /> : <DownOutlined />}
      </button>
      <span className="mr-2 text-gray-400">
        <AppstoreOutlined />
      </span>
      <span className="flex-1 truncate text-left" title={category.name}>
        {category.name}
      </span>
      <span className="ml-1 text-xs text-gray-400">{count}</span>
      <Dropdown trigger={['click']} menu={menu}>
        <button
          type="button"
          aria-label="标签操作"
          className="ml-1 px-1 text-gray-400 opacity-0 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          ⋯
        </button>
      </Dropdown>
    </div>
  );
};

interface CategoryItemProps {
  active: boolean;
  icon: React.ReactNode;
  name: string;
  count: number;
  onClick: () => void;
}

const CategoryItem: React.FC<CategoryItemProps> = ({
  active,
  icon,
  name,
  count,
  onClick,
}) => {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'group w-full flex items-center px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-ant-color-primary-bg text-ant-color-primary'
          : 'hover:bg-gray-50 text-gray-700',
      )}
    >
      <span className="mr-2 text-gray-400">{icon}</span>
      <span className="flex-1 text-left truncate" title={name}>
        {name}
      </span>
      <span className="text-xs text-gray-400 ml-1">{count}</span>
    </button>
  );
};
