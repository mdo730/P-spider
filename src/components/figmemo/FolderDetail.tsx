/* eslint-disable react/prop-types */
import {
  AppstoreOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { App, Button, Dropdown, Empty, MenuProps, Segmented, Spin } from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteLibraryFiles } from '../../services/library-actions';
import {
  DownloadHistoryRecord,
  getDownloadHistoryMap,
} from '../../stores/download-history';
import { useFigmemoTagsStore } from '../../stores/figmemo-tags';
import { readTraceMap, TracedRecord } from '../../utils/library';
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
  toRelPath,
} from '../../utils/library';
import { showInFolder } from '../../utils/shell';
import { useSelection } from '../../hooks/useSelection';
import { FileGrid } from '../library/FileGrid';
import { FolderCover } from '../library/FolderCover';
import { FolderProperties } from './FolderProperties';
import { SortSelect } from '../library/SortSelect';
import { TagAssignModal } from './TagAssignModal';

interface Props {
  dir: string;
  /** 最外层一级文件夹名（用于「设为文件夹缩略图」） */
  rootFolderName?: string;
  saveDirBase: string;
  onOpenFolder: (folder: LibrarySubFolder) => void;
}

/** 文件夹详情：平铺/按文件夹切换、排序、子文件夹打标签、文件多选批量删除、右键菜单/属性 */
export const FolderDetail: React.FC<Props> = ({
  dir,
  rootFolderName,
  saveDirBase,
  onOpenFolder,
}) => {
  const { message, modal } = App.useApp();

  const [content, setContent] = useState<DirectoryContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'flat' | 'folder'>('flat');
  const [folderSort, setFolderSort] = useState<FolderSortKey>('name-desc');
  const [fileSort, setFileSort] = useState<FileSortKey>('name-desc');
  const [selectMode, setSelectMode] = useState(false);
  const [propsTarget, setPropsTarget] = useState<LibrarySubFolder | null>(null);
  const [assignTargets, setAssignTargets] = useState<string[] | null>(null);
  const [assignLabel, setAssignLabel] = useState<string | undefined>();
  const [historyMap, setHistoryMap] = useState<
    Map<string, DownloadHistoryRecord>
  >(new Map());
  const [traceMap, setTraceMap] = useState<Map<string, TracedRecord>>(
    new Map(),
  );

  // 加载下载历史索引 + 联网溯源缓存，用于关联原推文/打开原网页
  useEffect(() => {
    let cancelled = false;
    Promise.all([getDownloadHistoryMap(), readTraceMap()])
      .then(([history, trace]) => {
        if (cancelled) return;
        setHistoryMap(history);
        setTraceMap(trace);
      })
      .catch((err) => log.error('加载溯源信息失败', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await scanDirectory(dir);
      const paths = [
        ...data.folders.map((f) => f.path),
        ...data.files.map((f) => f.path),
      ];
      const mtimes = await fetchMtimes(paths);
      const folders = data.folders.map((folder, i) => ({
        ...folder,
        mtime: mtimes[i] ?? undefined,
      }));
      const files = data.files.map((file, i) => ({
        ...file,
        mtime: mtimes[data.folders.length + i] ?? undefined,
      }));
      setContent({ folders, files });
      // 无子文件夹时只能是平铺；有子文件夹时保留用户当前选择
      if (data.folders.length === 0) setViewMode('flat');
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

  const relOf = useCallback(
    (folder: LibrarySubFolder) => toRelPath(folder.path, saveDirBase),
    [saveDirBase],
  );

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
      <div className="flex items-center flex-wrap gap-3 pb-2">
        <span className="text-sm text-gray-500 shrink-0 whitespace-nowrap">
          {content ? `${content.files.length} 个媒体` : '加载中…'}
          {hasFolders && content
            ? ` · ${content.folders.length} 个子文件夹`
            : ''}
        </span>
        <span className="ml-auto" />
        {!inFolderView && sortedFiles.length > 0 && (
          <Button
            type={selectMode ? 'primary' : 'default'}
            onClick={toggleSelectMode}
          >
            多选
          </Button>
        )}
        <span className="text-sm text-gray-400 shrink-0 whitespace-nowrap">
          排序
        </span>
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
              const relPath = relOf(folder);
              const tagCount = useFigmemoTagsStore
                .getState()
                .getFolderTagIds(relPath).length;
              const menuItems: MenuProps['items'] = [
                { key: 'open', label: '打开', icon: <FolderOpenOutlined /> },
                { key: 'reveal', label: '在资源管理器中打开' },
                { type: 'divider' },
                { key: 'tags', label: '标签…', icon: <TagsOutlined /> },
                { key: 'props', label: '属性', icon: <InfoCircleOutlined /> },
              ];
              const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
                domEvent.stopPropagation();
                if (key === 'open') return onOpenFolder(folder);
                if (key === 'reveal') return revealFolder(folder);
                if (key === 'tags') {
                  setAssignLabel(folder.name);
                  setAssignTargets([relPath]);
                  return;
                }
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
                          {tagCount > 0 ? ` · ${tagCount} 标签` : ''}
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
            coverFolderName={rootFolderName}
            historyMap={historyMap}
            traceMap={traceMap}
          />
        ) : (
          <Empty className="mt-16" description="该文件夹下没有媒体文件" />
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
        relPath={propsTarget ? relOf(propsTarget) : undefined}
        folderPath={propsTarget?.path}
        mediaCount={propsTarget?.mediaCount}
        onClose={() => setPropsTarget(null)}
      />
    </div>
  );
};
