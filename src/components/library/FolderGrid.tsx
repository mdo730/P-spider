/* eslint-disable react/prop-types */
import {
  FolderOpenOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  ReloadOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  MenuProps,
  Spin,
} from 'antd';
import React, { useMemo, useState } from 'react';
import { useLibraryStore } from '../../stores/library';
import { useSettingsStore } from '../../stores/settings';
import { PlatformSource } from '../../platforms';
import {
  FOLDER_SORT_OPTIONS,
  FolderSortKey,
  LibraryRootFolder,
  sortFolders,
  toRelPath,
} from '../../utils/library';
import { showInFolder } from '../../utils/shell';
import { useSelection } from '../../hooks/useSelection';
import { FolderCover } from './FolderCover';
import { FolderProperties } from './FolderProperties';
import { PlatformBadge } from './PlatformBadge';
import { SortSelect } from './SortSelect';
import { TagAssignModal } from './TagAssignModal';

interface Props {
  folders: LibraryRootFolder[];
  loading: boolean;
  keyword: string;
  onKeywordChange: (value: string) => void;
  onOpen: (folder: LibraryRootFolder) => void;
  onRefresh: () => void;
  saveDirBase: string;
}

/** 本地库一级文件夹网格：封面 + 名称 + 平台标记 + 标签 + 多选批量打标签 */
export const FolderGrid: React.FC<Props> = ({
  folders,
  loading,
  keyword,
  onKeywordChange,
  onOpen,
  onRefresh,
  saveDirBase,
}) => {
  const { message } = App.useApp();

  const [sort, setSort] = useState<FolderSortKey>('mtime-desc');
  const [selectMode, setSelectMode] = useState(false);
  const [propsTarget, setPropsTarget] = useState<LibraryRootFolder | null>(
    null,
  );
  const [assignTargets, setAssignTargets] = useState<string[] | null>(null);
  const [assignLabel, setAssignLabel] = useState<string | undefined>();

  const saveDir = useSettingsStore((s) => s.download.saveDirBase);

  const sortedFolders = useMemo(
    () => sortFolders(folders, sort),
    [folders, sort],
  );

  const {
    isSelected,
    toggle,
    toggleAll,
    clear: clearSelection,
    selectedCount,
    allSelected,
  } = useSelection(sortedFolders.map((f) => f.path));

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    clearSelection();
  };

  const relPathOf = (folder: LibraryRootFolder) =>
    toRelPath(folder.path, saveDirBase || saveDir);

  const selectedPaths = useMemo(
    () =>
      sortedFolders.filter((f) => isSelected(f.path)).map((f) => relPathOf(f)),
    [sortedFolders, isSelected, saveDirBase, saveDir],
  );

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
          <Button
            size="small"
            icon={<TagsOutlined />}
            disabled={selectedCount === 0}
            onClick={() => {
              setAssignLabel(`${selectedPaths.length} 个文件夹`);
              setAssignTargets(selectedPaths);
            }}
          >
            打标签
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
            description={keyword ? '没有匹配的文件夹' : '当前筛选下暂无文件夹'}
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
                relPath={relPathOf(folder)}
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
                onAssign={() => {
                  setAssignLabel(folder.name);
                  setAssignTargets([relPathOf(folder)]);
                }}
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

      <TagAssignModal
        open={!!assignTargets}
        targets={assignTargets || []}
        label={assignLabel}
        onClose={() => setAssignTargets(null)}
      />

      <FolderProperties
        open={!!propsTarget}
        folderName={propsTarget?.name || ''}
        relPath={propsTarget ? relPathOf(propsTarget) : undefined}
        folderPath={propsTarget?.path}
        mediaCount={propsTarget?.mediaCount}
        onClose={() => setPropsTarget(null)}
      />
    </div>
  );
};

interface FolderCardProps {
  folder: LibraryRootFolder;
  relPath: string;
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onAssign: () => void;
  onShowProps: () => void;
}

const FolderCard: React.FC<FolderCardProps> = ({
  folder,
  relPath,
  selectMode,
  selected,
  onToggle,
  onOpen,
  onReveal,
  onAssign,
  onShowProps,
}) => {
  const coverOverride = useLibraryStore((s) => s.folderCovers[folder.name]);
  const tagCount = useLibraryStore((s) => s.getFolderTagIds(relPath).length);
  const platform = folder.platform as PlatformSource | undefined;
  const setFolderCover = useLibraryStore((s) => s.setFolderCover);
  const { message } = App.useApp();

  const menuItems: MenuProps['items'] = [
    { key: 'open', label: '打开', icon: <FolderOpenOutlined /> },
    { key: 'reveal', label: '在资源管理器中打开' },
    { type: 'divider' },
    { key: 'tags', label: '标签…', icon: <TagsOutlined /> },
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
    if (key === 'tags') return onAssign();
    if (key === 'props') return onShowProps();
    if (key === 'resetCover') {
      setFolderCover(folder.name, null);
      message.success('已恢复默认缩略图');
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
              {tagCount > 0 ? ` · ${tagCount} 标签` : ''}
            </p>
          </div>
        </button>
        <span className="absolute left-1 top-1">
          {selectMode ? (
            <Checkbox checked={selected} className="pointer-events-none" />
          ) : null}
        </span>
        <PlatformBadge platform={platform} />
      </li>
    </Dropdown>
  );
};
