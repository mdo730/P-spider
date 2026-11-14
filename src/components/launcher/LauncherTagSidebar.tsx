import {
  AppstoreOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  InboxOutlined,
  PlusOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, MenuProps } from 'antd';
import clsx from 'clsx';
import React, { useState } from 'react';
import { LauncherTag } from '../../stores/launcher';

export const LAUNCHER_ALL_ID = 'all';
export const LAUNCHER_UNCLASSIFIED_ID = 'unclassified';

interface Props {
  tags: LauncherTag[];
  selectedId: string;
  onSelect: (id: string) => void;
  counts: {
    all: number;
    unclassified: number;
    byId: Record<string, number>;
  };
  onAddRoot: () => void;
  onAddChild: (parent: LauncherTag) => void;
  onRename: (tag: LauncherTag) => void;
  onRemove: (tag: LauncherTag) => void;
  /** 把正在拖动的启动项放到该标签下 */
  onDropEntry: (tagId: string) => void;
}

/** 启动器标签树：层级结构与本地库标签栏一致的视觉风格 */
export const LauncherTagSidebar: React.FC<Props> = ({
  tags,
  selectedId,
  onSelect,
  counts,
  onAddRoot,
  onAddChild,
  onRename,
  onRemove,
  onDropEntry,
}) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderTags = (
    parentId: string | null,
    depth: number,
  ): React.ReactNode =>
    tags
      .filter((t) => t.parentId === parentId)
      .sort((a, b) => a.order - b.order)
      .map((tag) => {
        const children = tags.filter((t) => t.parentId === tag.id);
        const isCollapsed = collapsed.has(tag.id);
        return (
          <li key={tag.id}>
            <TagRow
              tag={tag}
              depth={depth}
              count={counts.byId[tag.id] || 0}
              active={selectedId === tag.id}
              hasChildren={children.length > 0}
              collapsed={isCollapsed}
              onToggle={() => toggle(tag.id)}
              onSelect={() => onSelect(tag.id)}
              onAddChild={() => onAddChild(tag)}
              onRename={() => onRename(tag)}
              onRemove={() => onRemove(tag)}
              onDropEntry={() => onDropEntry(tag.id)}
            />
            {!isCollapsed && children.length > 0 && (
              <ul>{renderTags(tag.id, depth + 1)}</ul>
            )}
          </li>
        );
      });

  return (
    <aside
      aria-label="标签树"
      className="w-56 shrink-0 flex flex-col bg-white border-[1px] border-gray-200 rounded-md overflow-hidden"
    >
      <div className="px-3 py-2 border-b-[1px] border-gray-100 text-xs text-gray-400">
        标签树
      </div>
      <ul className="flex-1 overflow-y-auto py-2">
        <li>
          <PseudoItem
            id={LAUNCHER_ALL_ID}
            active={selectedId === LAUNCHER_ALL_ID}
            icon={<AppstoreOutlined />}
            name="全部"
            count={counts.all}
            onClick={() => onSelect(LAUNCHER_ALL_ID)}
          />
        </li>
        <li>
          <PseudoItem
            id={LAUNCHER_UNCLASSIFIED_ID}
            active={selectedId === LAUNCHER_UNCLASSIFIED_ID}
            icon={<InboxOutlined />}
            name="未打标签"
            count={counts.unclassified}
            onClick={() => onSelect(LAUNCHER_UNCLASSIFIED_ID)}
          />
        </li>
        <li className="px-3 pt-3 pb-1 text-xs text-gray-400">自定义标签</li>
        {tags.some((t) => t.parentId === null) ? (
          renderTags(null, 0)
        ) : (
          <li className="px-3 py-1 text-xs text-gray-300">暂无标签</li>
        )}
      </ul>
      <div className="p-3 border-t-[1px] border-gray-100">
        <Button block icon={<PlusOutlined />} onClick={onAddRoot}>
          新建标签
        </Button>
      </div>
    </aside>
  );
};

interface TagRowProps {
  tag: LauncherTag;
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
  onDropEntry: () => void;
}

const TagRow: React.FC<TagRowProps> = ({
  tag,
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
  onDropEntry,
}) => {
  const [dragOver, setDragOver] = useState(false);
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
      data-launcher-tag-id={tag.id}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        onDropEntry();
      }}
      style={{ paddingLeft: 12 + depth * 14 }}
      className={clsx(
        'group w-full flex items-center pr-2 py-2 text-sm transition-colors cursor-pointer',
        dragOver
          ? 'bg-ant-color-primary-bg text-ant-color-primary ring-1 ring-inset ring-ant-color-primary'
          : active
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
      <span className="flex-1 truncate text-left" title={tag.name}>
        {tag.name}
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

interface PseudoItemProps {
  id: string;
  active: boolean;
  icon: React.ReactNode;
  name: string;
  count: number;
  onClick: () => void;
}

const PseudoItem: React.FC<PseudoItemProps> = ({
  id,
  active,
  icon,
  name,
  count,
  onClick,
}) => (
  <button
    data-launcher-tag-id={id}
    onClick={onClick}
    className={clsx(
      'w-full flex items-center px-3 py-2 text-sm transition-colors',
      active
        ? 'bg-ant-color-primary-bg text-ant-color-primary'
        : 'hover:bg-gray-50 text-gray-700',
    )}
  >
    <span className="mr-2 text-gray-400">{icon}</span>
    <span className="flex-1 text-left truncate">{name}</span>
    <span className="text-xs text-gray-400 ml-1">{count}</span>
  </button>
);
