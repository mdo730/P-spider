/* eslint-disable react/prop-types */
import {
  CheckOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  MenuProps,
  Modal,
  Spin,
} from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { useLibraryStore } from '../../stores/library';
import {
  getDownloadHistoryMap,
  normalizePath,
} from '../../stores/download-history';
import { useSettingsStore } from '../../stores/settings';
import { PlatformSource } from '../../platforms';
import {
  FOLDER_SORT_OPTIONS,
  FolderSortKey,
  LibraryRootFolder,
  readTraceMap,
  sortFolders,
} from '../../utils/library';
import { showInFolder } from '../../utils/shell';
import { useSelection } from '../../hooks/useSelection';
import { FolderCover } from './FolderCover';
import { FolderProperties } from './FolderProperties';
import { PlatformBadge } from './PlatformBadge';
import { SortSelect } from './SortSelect';

interface Props {
  folders: LibraryRootFolder[];
  loading: boolean;
  keyword: string;
  onKeywordChange: (value: string) => void;
  onOpen: (folder: LibraryRootFolder) => void;
  onRefresh: () => void;
}

/** 本地库一级文件夹网格：封面 + 名称 + 标签（多标签）+ 属性 + 多选批量 */
export const FolderGrid: React.FC<Props> = ({
  folders,
  loading,
  keyword,
  onKeywordChange,
  onOpen,
  onRefresh,
}) => {
  const { message } = App.useApp();
  const categories = useLibraryStore((s) => s.categories);
  const addCategory = useLibraryStore((s) => s.addCategory);
  const addFolderToCategory = useLibraryStore((s) => s.addFolderToCategory);
  const removeFolderFromCategory = useLibraryStore(
    (s) => s.removeFolderFromCategory,
  );
  const clearFolderCategories = useLibraryStore((s) => s.clearFolderCategories);

  const [sort, setSort] = useState<FolderSortKey>('mtime-desc');
  const [selectMode, setSelectMode] = useState(false);
  const [createNames, setCreateNames] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [propsTarget, setPropsTarget] = useState<LibraryRootFolder | null>(
    null,
  );
  const saveDirBase = useSettingsStore((s) => s.download.saveDirBase);
  const [folderPlatform, setFolderPlatform] = useState<
    Map<string, PlatformSource>
  >(new Map());

  // 用下载历史/溯源里的平台字段覆盖结构启发式（更准）
  useEffect(() => {
    let cancelled = false;
    Promise.all([getDownloadHistoryMap(), readTraceMap()])
      .then(([history, trace]) => {
        if (cancelled || !saveDirBase) return;
        const prefix = `${normalizePath(saveDirBase).replace(/\\+$/, '')}\\`;
        const map = new Map<string, PlatformSource>();
        const consider = (filePath?: string, platform?: PlatformSource) => {
          if (!filePath || !platform) return;
          const normalized = normalizePath(filePath);
          if (!normalized.startsWith(prefix)) return;
          const seg = normalized.slice(prefix.length).split('\\')[0];
          if (seg && !map.has(seg)) map.set(seg, platform);
        };
        for (const record of history.values()) {
          consider(record.filePath, record.platform);
        }
        for (const filePath of trace.keys()) {
          consider(filePath, 'twitter');
        }
        setFolderPlatform(map);
      })
      .catch((err) => log.warn('读取平台信息失败', err));
    return () => {
      cancelled = true;
    };
  }, [saveDirBase]);

  const sortedFolders = useMemo(
    () => sortFolders(folders, sort),
    [folders, sort],
  );

  const {
    selected,
    isSelected,
    toggle,
    toggleAll,
    clear: clearSelection,
    selectedCount,
    allSelected,
  } = useSelection(sortedFolders.map((f) => f.path));

  const selectedFolders = useMemo(
    () => sortedFolders.filter((f) => selected.has(f.path)),
    [sortedFolders, selected],
  );

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    clearSelection();
  };

  const openCreateModal = (names: string[]) => {
    setNewName('');
    setCreateNames(names);
  };

  const confirmCreate = () => {
    if (createNames.length === 0) return;
    try {
      const id = addCategory(newName);
      createNames.forEach((name) => addFolderToCategory(name, id));
      message.success(
        `已为 ${createNames.length} 个文件夹添加标签「${newName.trim()}」`,
      );
      setCreateNames([]);
      clearSelection();
    } catch (err: any) {
      message.error(err?.message || '创建标签失败');
    }
  };

  const batchAddTag = (categoryId: string) => {
    selectedFolders.forEach((f) => addFolderToCategory(f.name, categoryId));
    message.success(`已为 ${selectedCount} 个文件夹添加标签`);
    clearSelection();
  };

  const batchRemoveTag = (categoryId: string) => {
    selectedFolders.forEach((f) =>
      removeFolderFromCategory(f.name, categoryId),
    );
    message.success(`已移除标签`);
    clearSelection();
  };

  const batchClearTags = () => {
    selectedFolders.forEach((f) => clearFolderCategories(f.name));
    message.success('已清空所选文件夹的标签');
    clearSelection();
  };

  const addTagMenu: MenuProps = {
    items: [
      ...categories.map((c) => ({ key: `cat:${c.id}`, label: c.name })),
      ...(categories.length ? [{ type: 'divider' as const }] : []),
      { key: 'new', label: '新建标签并添加…', icon: <PlusOutlined /> },
    ],
    onClick: ({ key }) => {
      if (key === 'new') {
        openCreateModal(selectedFolders.map((f) => f.name));
        return;
      }
      if (key.startsWith('cat:')) batchAddTag(key.slice(4));
    },
  };

  const removeTagMenu: MenuProps = {
    items: categories.map((c) => ({ key: `cat:${c.id}`, label: c.name })),
    onClick: ({ key }) => {
      if (key.startsWith('cat:')) batchRemoveTag(key.slice(4));
    },
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center flex-wrap gap-2 pb-2">
        <Input
          allowClear
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          placeholder="筛选文件夹名"
          className="w-56"
        />
        <span className="text-sm text-gray-400 shrink-0 whitespace-nowrap">
          {folders.length} 个文件夹
        </span>
        <span className="ml-auto" />
        <Button
          type={selectMode ? 'primary' : 'default'}
          onClick={toggleSelectMode}
        >
          多选
        </Button>
        <span className="text-sm text-gray-400 shrink-0 whitespace-nowrap">
          排序
        </span>
        <SortSelect
          value={sort}
          onChange={(v) => setSort(v as FolderSortKey)}
          options={FOLDER_SORT_OPTIONS}
        />
        <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
          刷新
        </Button>
      </div>

      {selectMode && (
        <div className="flex items-center gap-2 pb-3">
          <span className="text-sm text-gray-500">已选 {selectedCount} 个</span>
          <Button size="small" onClick={toggleAll}>
            {allSelected ? '取消全选' : '全选'}
          </Button>
          <Dropdown menu={addTagMenu} disabled={selectedCount === 0}>
            <Button size="small" disabled={selectedCount === 0}>
              添加标签
            </Button>
          </Dropdown>
          <Dropdown
            menu={removeTagMenu}
            disabled={selectedCount === 0 || categories.length === 0}
          >
            <Button
              size="small"
              disabled={selectedCount === 0 || categories.length === 0}
            >
              移除标签
            </Button>
          </Dropdown>
          <Button
            size="small"
            icon={<DeleteOutlined />}
            disabled={selectedCount === 0}
            onClick={batchClearTags}
          >
            清空标签
          </Button>
          {selectedCount > 0 && (
            <Button size="small" type="link" onClick={clearSelection}>
              清空选择
            </Button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-6">
        {loading && folders.length === 0 ? (
          <div className="flex justify-center py-20">
            <Spin size="large" />
          </div>
        ) : folders.length === 0 ? (
          <Empty
            className="mt-16"
            description={
              keyword
                ? '没有匹配的文件夹'
                : '该分类下暂无文件夹，去「全部」里给文件夹打标签吧'
            }
          />
        ) : (
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3"
            onContextMenu={(e) => e.preventDefault()}
          >
            {sortedFolders.map((folder) => (
              <FolderCard
                key={folder.path}
                folder={folder}
                categories={categories}
                platform={
                  folderPlatform.get(folder.name.toLowerCase()) ||
                  folder.platform
                }
                selectMode={selectMode}
                selected={isSelected(folder.path)}
                onToggle={() => toggle(folder.path)}
                onOpen={() => onOpen(folder)}
                onReveal={async () => {
                  try {
                    await showInFolder(folder.path);
                  } catch (err: any) {
                    message.error(err?.message || '打开资源管理器失败');
                  }
                }}
                onCreateAndAdd={() => openCreateModal([folder.name])}
                onShowProps={() => setPropsTarget(folder)}
              />
            ))}
            {loading && (
              <li className="h-[14rem] flex items-center justify-center bg-white rounded-md border-[1px] border-gray-100">
                <LoadingOutlined className="text-4xl text-ant-color-primary" />
              </li>
            )}
          </ul>
        )}
      </div>

      <Modal
        open={createNames.length > 0}
        title={
          createNames.length > 1
            ? `新建标签（${createNames.length} 个文件夹）`
            : '新建标签'
        }
        okText="创建并添加"
        cancelText="取消"
        onOk={confirmCreate}
        onCancel={() => setCreateNames([])}
        destroyOnClose
      >
        <Input
          autoFocus
          value={newName}
          placeholder="标签名，如 真人cos"
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={confirmCreate}
        />
      </Modal>

      <FolderProperties
        open={!!propsTarget}
        folderName={propsTarget?.name || ''}
        folderPath={propsTarget?.path}
        mediaCount={propsTarget?.mediaCount}
        showTags
        onClose={() => setPropsTarget(null)}
      />
    </div>
  );
};

interface FolderCardProps {
  folder: LibraryRootFolder;
  categories: { id: string; name: string }[];
  platform?: PlatformSource;
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onCreateAndAdd: () => void;
  onShowProps: () => void;
}

const FolderCard: React.FC<FolderCardProps> = ({
  folder,
  categories,
  platform,
  selectMode,
  selected,
  onToggle,
  onOpen,
  onReveal,
  onCreateAndAdd,
  onShowProps,
}) => {
  const categoryIds = useLibraryStore((s) =>
    s.getFolderCategoryIds(folder.name),
  );
  const coverOverride = useLibraryStore((s) => s.folderCovers[folder.name]);
  const addFolderToCategory = useLibraryStore((s) => s.addFolderToCategory);
  const removeFolderFromCategory = useLibraryStore(
    (s) => s.removeFolderFromCategory,
  );
  const setFolderCover = useLibraryStore((s) => s.setFolderCover);
  const { message } = App.useApp();

  const menuItems: MenuProps['items'] = [
    { key: 'open', label: '打开', icon: <FolderOpenOutlined /> },
    { key: 'reveal', label: '在资源管理器中打开' },
    { type: 'divider' },
    {
      key: 'tags',
      label: '标签',
      children: [
        ...categories.map((c) => ({
          key: `tag:${c.id}`,
          label: c.name,
          icon: categoryIds.includes(c.id) ? (
            <CheckOutlined className="text-ant-color-primary" />
          ) : (
            <span className="inline-block w-3" />
          ),
        })),
        ...(categories.length ? [{ type: 'divider' as const }] : []),
        { key: 'newtag', label: '新建标签并添加…', icon: <PlusOutlined /> },
      ],
    },
    { type: 'divider' },
    { key: 'props', label: '属性', icon: <InfoCircleOutlined /> },
    ...(coverOverride
      ? [
          { type: 'divider' as const },
          {
            key: 'resetCover',
            label: '恢复默认缩略图',
            icon: <ReloadOutlined />,
          },
        ]
      : []),
  ];

  const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation();
    if (key === 'open') return onOpen();
    if (key === 'reveal') return onReveal();
    if (key === 'newtag') return onCreateAndAdd();
    if (key === 'props') return onShowProps();
    if (key === 'resetCover') {
      setFolderCover(folder.name, null);
      message.success('已恢复默认缩略图');
      return;
    }
    if (key.startsWith('tag:')) {
      const id = key.slice(4);
      if (categoryIds.includes(id)) removeFolderFromCategory(folder.name, id);
      else addFolderToCategory(folder.name, id);
    }
  };

  const menu = { items: menuItems, onClick: onMenuClick };

  return (
    <Dropdown trigger={['contextMenu']} menu={menu}>
      <li
        className={`relative bg-white rounded-md border-[1px] overflow-hidden group ${
          selectMode && selected
            ? 'border-ant-color-primary ring-1 ring-ant-color-primary'
            : 'border-gray-100'
        }`}
      >
        <button
          onClick={selectMode ? onToggle : onOpen}
          className="block w-full text-left"
          title={folder.name}
        >
          <FolderCover
            name={folder.name}
            coverPath={coverOverride || folder.coverPath}
            coverKind={coverOverride ? 'image' : folder.coverKind}
            wrapperClassName="w-full h-[12rem]"
            className="object-cover w-full h-full transition-transform group-hover:scale-105"
          />
          <div className="px-2 py-2">
            <p className="truncate text-sm" title={folder.name}>
              {folder.name}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {folder.mediaCount} 个媒体
            </p>
          </div>
        </button>
        <span className="absolute left-1 top-1">
          {selectMode ? (
            <Checkbox checked={selected} className="pointer-events-none" />
          ) : (
            categoryIds.length > 0 && (
              <span className="text-xs text-white bg-[rgba(0,0,0,0.5)] rounded-sm px-1 py-[0.05rem]">
                {categoryIds.length} 标签
              </span>
            )
          )}
        </span>
        <PlatformBadge platform={platform} />
      </li>
    </Dropdown>
  );
};
