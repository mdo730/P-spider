/* eslint-disable react/prop-types */
import {
  AppstoreOutlined,
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { App, Button, Dropdown, Input, Modal } from 'antd';
import clsx from 'clsx';
import React, { useState } from 'react';
import { LibraryCategory, useLibraryStore } from '../../stores/library';

export const ALL_CATEGORY_ID = 'all';
export const UNCLASSIFIED_CATEGORY_ID = 'unclassified';

interface Props {
  selectedId: string;
  onSelect: (id: string) => void;
  counts: { all: number; unclassified: number; byId: Record<string, number> };
}

export const CategorySidebar: React.FC<Props> = ({
  selectedId,
  onSelect,
  counts,
}) => {
  const { modal, message } = App.useApp();
  const categories = useLibraryStore((s) => s.categories);
  const addCategory = useLibraryStore((s) => s.addCategory);
  const renameCategory = useLibraryStore((s) => s.renameCategory);
  const removeCategory = useLibraryStore((s) => s.removeCategory);

  const [editModal, setEditModal] = useState<
    { mode: 'create' } | { mode: 'rename'; category: LibraryCategory } | null
  >(null);
  const [nameInput, setNameInput] = useState('');

  const openCreate = () => {
    setNameInput('');
    setEditModal({ mode: 'create' });
  };

  const openRename = (category: LibraryCategory) => {
    setNameInput(category.name);
    setEditModal({ mode: 'rename', category });
  };

  const confirmEdit = () => {
    if (!editModal) return;
    try {
      if (editModal.mode === 'create') {
        const id = addCategory(nameInput);
        onSelect(id);
      } else {
        renameCategory(editModal.category.id, nameInput);
      }
      setEditModal(null);
    } catch (err: any) {
      message.error(err?.message || '操作失败');
    }
  };

  const confirmDelete = (category: LibraryCategory) => {
    modal.confirm({
      title: `删除标签「${category.name}」？`,
      content: '仅删除标签，文件夹本身不会被删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        removeCategory(category.id);
        if (selectedId === category.id) onSelect(ALL_CATEGORY_ID);
      },
    });
  };

  return (
    <aside
      aria-label="本地库标签"
      className="w-56 shrink-0 flex flex-col bg-white border-[1px] border-gray-200 rounded-md overflow-hidden"
    >
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
        {categories.map((category) => (
          <li key={category.id}>
            <CategoryItem
              active={selectedId === category.id}
              icon={<AppstoreOutlined />}
              name={category.name}
              count={counts.byId[category.id] || 0}
              onClick={() => onSelect(category.id)}
              actions={
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      {
                        key: 'rename',
                        label: '重命名',
                        icon: <EditOutlined />,
                      },
                      {
                        key: 'delete',
                        label: '删除',
                        icon: <DeleteOutlined />,
                        danger: true,
                      },
                    ],
                    onClick: ({ key, domEvent }) => {
                      domEvent.stopPropagation();
                      if (key === 'rename') openRename(category);
                      if (key === 'delete') confirmDelete(category);
                    },
                  }}
                >
                  <button
                    aria-label="标签操作"
                    className="px-1 text-gray-400 hover:text-gray-700"
                    onClick={(e) => e.stopPropagation()}
                  >
                    ⋯
                  </button>
                </Dropdown>
              }
            />
          </li>
        ))}
        {categories.length === 0 && (
          <li className="px-3 py-1 text-xs text-gray-300">暂无标签</li>
        )}
      </ul>
      <div className="p-3 border-t-[1px] border-gray-100">
        <Button block icon={<PlusOutlined />} onClick={openCreate}>
          新建标签
        </Button>
      </div>

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
          placeholder="分类名，如 真人cos"
          onChange={(e) => setNameInput(e.target.value)}
          onPressEnter={confirmEdit}
        />
      </Modal>
    </aside>
  );
};

interface CategoryItemProps {
  active: boolean;
  icon: React.ReactNode;
  name: string;
  count: number;
  onClick: () => void;
  actions?: React.ReactNode;
}

const CategoryItem: React.FC<CategoryItemProps> = ({
  active,
  icon,
  name,
  count,
  onClick,
  actions,
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
      {actions && (
        <span className="ml-1 opacity-0 group-hover:opacity-100">
          {actions}
        </span>
      )}
    </button>
  );
};
