/* eslint-disable react/prop-types */
import {
  AppstoreOutlined,
  CheckSquareOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { App, Button, Dropdown, Empty, MenuProps, Segmented, Spin } from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteLibraryFiles } from '../../services/library-actions';
import {
  DirectoryContent,
  FILE_SORT_OPTIONS,
  FOLDER_SORT_OPTIONS,
  FileSortKey,
  FolderSortKey,
  LibrarySubFolder,
  fetchMtimes,
  scanDirectory,
  sortFiles,
  sortFolders,
} from '../../utils/library';
import { showInFolder } from '../../utils/shell';
import { useSelection } from '../../hooks/useSelection';
import { FileGrid } from './FileGrid';
import { FolderCover } from './FolderCover';
import { FolderProperties } from './FolderProperties';
import { SortSelect } from './SortSelect';

interface Props {
  dir: string;
  onOpenFolder: (folder: LibrarySubFolder) => void;
}

/** 文件夹详情：平铺/按文件夹切换、排序、文件多选批量删除、右键菜单/属性 */
export const FolderDetail: React.FC<Props> = ({ dir, onOpenFolder }) => {
  const { message, modal } = App.useApp();

  const [content, setContent] = useState<DirectoryContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'flat' | 'folder'>('flat');
  const [folderSort, setFolderSort] = useState<FolderSortKey>('name-asc');
  const [fileSort, setFileSort] = useState<FileSortKey>('name-asc');
  const [selectMode, setSelectMode] = useState(false);
  const [propsTarget, setPropsTarget] = useState<LibrarySubFolder | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await scanDirectory(dir);
      const paths = [
        ...data.folders.map((f) => f.path),
        ...data.files.map((f) => f.path),
      ];
      const mtimes = await fetchMtimes(paths);
      const folders = data.folders.map((folder, index) => ({
        ...folder,
        mtime: mtimes[index] ?? undefined,
      }));
      const files = data.files.map((file, index) => ({
        ...file,
        mtime: mtimes[data.folders.length + index] ?? undefined,
      }));
      setContent({ folders, files });
      // 无子文件夹时只能是平铺；有子文件夹时保留用户当前选择
      if (data.folders.length === 0) {
        setViewMode('flat');
      }
      return data;
    } catch (err: any) {
      log.error(err);
      message.error(err?.message || '读取文件夹失败');
      setContent(null);
    } finally {
      setLoading(false);
    }
  }, [dir, message]);

  // 切换目录时重置视图（选择在下方 hook 就绪后一并清空）
  useEffect(() => {
    setViewMode('folder');
    setSelectMode(false);
  }, [dir]);

  useEffect(() => {
    load();
  }, [load]);

  const hasFolders = (content?.folders.length || 0) > 0;
  const sortedFolders = useMemo(
    () => sortFolders(content?.folders || [], folderSort),
    [content, folderSort],
  );
  const sortedFiles = useMemo(
    () => sortFiles(content?.files || [], fileSort),
    [content, fileSort],
  );

  const inFolderView = viewMode === 'folder' && hasFolders;
  const filePaths = useMemo(
    () => sortedFiles.map((f) => f.path),
    [sortedFiles],
  );

  const {
    selected,
    toggle,
    toggleAll,
    clear: clearSelection,
    selectedCount,
    allSelected,
  } = useSelection(filePaths);

  // 切换目录 / 视图时清空选择
  useEffect(() => {
    clearSelection();
  }, [dir, viewMode, clearSelection]);

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    clearSelection();
  };

  const revealFolder = async (folder: LibrarySubFolder) => {
    try {
      await showInFolder(folder.path);
    } catch (err: any) {
      message.error(err?.message || '打开资源管理器失败');
    }
  };

  const batchDeleteFiles = () => {
    const targets = sortedFiles.filter((f) => selected.has(f.path));
    if (targets.length === 0) return;
    modal.confirm({
      title: `删除 ${targets.length} 个文件？`,
      content: '将永久删除所选文件，删除后不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await deleteLibraryFiles(targets.map((f) => f.path));
        if (result.failed > 0) {
          message.warning(
            `已删除 ${result.deleted} 个，${result.failed} 个失败`,
          );
        } else {
          message.success(`已删除 ${result.deleted} 个文件`);
        }
        clearSelection();
        await load();
      },
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 pb-2">
        <span className="text-sm text-gray-500">
          {content ? `${content.files.length} 个媒体` : '加载中…'}
          {hasFolders && content
            ? ` · ${content.folders.length} 个子文件夹`
            : ''}
        </span>
        <span className="ml-auto" />
        {!inFolderView && sortedFiles.length > 0 && (
          <Button
            icon={<CheckSquareOutlined />}
            type={selectMode ? 'primary' : 'default'}
            onClick={toggleSelectMode}
          >
            多选
          </Button>
        )}
        <span className="text-sm text-gray-400">排序</span>
        {inFolderView ? (
          <SortSelect
            value={folderSort}
            onChange={(v) => setFolderSort(v as FolderSortKey)}
            options={FOLDER_SORT_OPTIONS}
          />
        ) : (
          <SortSelect
            value={fileSort}
            onChange={(v) => setFileSort(v as FileSortKey)}
            options={FILE_SORT_OPTIONS}
          />
        )}
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => load()}
        >
          刷新
        </Button>
        {hasFolders && (
          <Segmented
            value={viewMode}
            onChange={(value) => {
              setViewMode(value as 'flat' | 'folder');
              clearSelection();
            }}
            options={[
              { label: '平铺', value: 'flat', icon: <AppstoreOutlined /> },
              {
                label: '按文件夹',
                value: 'folder',
                icon: <FolderOpenOutlined />,
              },
            ]}
          />
        )}
      </div>

      {selectMode && !inFolderView && (
        <div className="flex items-center gap-2 pb-3">
          <span className="text-sm text-gray-500">已选 {selectedCount} 个</span>
          <Button size="small" onClick={toggleAll}>
            {allSelected ? '取消全选' : '全选'}
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={selectedCount === 0}
            onClick={batchDeleteFiles}
          >
            删除文件
          </Button>
          {selectedCount > 0 && (
            <Button size="small" type="link" onClick={clearSelection}>
              清空选择
            </Button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-6">
        {loading && !content ? (
          <div className="flex justify-center py-20">
            <Spin size="large" />
          </div>
        ) : inFolderView ? (
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3"
            onContextMenu={(e) => e.preventDefault()}
          >
            {sortedFolders.map((folder) => {
              const menuItems: MenuProps['items'] = [
                { key: 'open', label: '打开', icon: <FolderOpenOutlined /> },
                { key: 'reveal', label: '在资源管理器中打开' },
                { type: 'divider' },
                { key: 'props', label: '属性', icon: <InfoCircleOutlined /> },
              ];
              const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
                domEvent.stopPropagation();
                if (key === 'open') return onOpenFolder(folder);
                if (key === 'reveal') return revealFolder(folder);
                if (key === 'props') return setPropsTarget(folder);
              };
              return (
                <Dropdown
                  key={folder.path}
                  trigger={['contextMenu']}
                  menu={{ items: menuItems, onClick: onMenuClick }}
                >
                  <li className="bg-white rounded-md border-[1px] border-gray-100 overflow-hidden group">
                    <button
                      className="block w-full text-left"
                      title={folder.name}
                      onClick={() => onOpenFolder(folder)}
                    >
                      <FolderCover
                        name={folder.name}
                        coverPath={folder.coverPath}
                        coverKind={folder.coverKind}
                        wrapperClassName="w-full h-[10rem]"
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
                  </li>
                </Dropdown>
              );
            })}
          </ul>
        ) : content && content.files.length > 0 ? (
          <FileGrid
            files={sortedFiles}
            selectMode={selectMode}
            selected={selected}
            onToggle={toggle}
            onDeleted={() => load()}
          />
        ) : (
          <Empty className="mt-16" description="该文件夹下没有媒体文件" />
        )}
      </div>

      <FolderProperties
        open={!!propsTarget}
        folderName={propsTarget?.name || ''}
        folderPath={propsTarget?.path}
        mediaCount={propsTarget?.mediaCount}
        onClose={() => setPropsTarget(null)}
      />
    </div>
  );
};
