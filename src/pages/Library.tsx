import { getErrorMessage } from '../utils/error';
import {
  LeftOutlined,
  RightOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { App, Breadcrumb, Button, Empty, Input, Modal, Select } from 'antd';
import { dialog } from '@tauri-apps/api';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import {
  ALL_CATEGORY_ID,
  CategorySidebar,
  UNCLASSIFIED_CATEGORY_ID,
} from '../components/library/CategorySidebar';
import { FolderDetail } from '../components/library/FolderDetail';
import { FolderGrid } from '../components/library/FolderGrid';
import {
  EMPTY_CATEGORIES,
  collectCategorySubtree,
  useLibraryStore,
} from '../stores/library';
import { DEFAULT_ROOT_ID, useLibraryRootsStore } from '../stores/library-roots';
import { useSettingsStore } from '../stores/settings';
import {
  LibraryRootFolder,
  LibrarySubFolder,
  fetchMtimes,
  listRootFolders,
  summarizeFolders,
} from '../utils/library';

/** 本地库：分类管理 saveDirBase 下的一级文件夹，浏览已下载媒体 */
export const LibraryPage: React.FC = () => {
  const { message } = App.useApp();
  const saveDirBase = useSettingsStore((s) => s.download.saveDirBase);
  const activeRootId = useLibraryRootsStore((s) => s.activeRootId);
  const roots = useLibraryRootsStore((s) => s.roots);
  const setActiveRoot = useLibraryRootsStore((s) => s.setActiveRoot);
  const addRoot = useLibraryRootsStore((s) => s.addRoot);
  const renameRoot = useLibraryRootsStore((s) => s.renameRoot);
  const removeRoot = useLibraryRootsStore((s) => s.removeRoot);
  const isExternal = activeRootId !== DEFAULT_ROOT_ID;
  const rootPath = isExternal
    ? roots.find((r) => r.id === activeRootId)?.path || ''
    : saveDirBase;
  const categories = useLibraryStore(
    (s) => s.categoriesByRoot[activeRootId] ?? EMPTY_CATEGORIES,
  );

  const [selectedId, setSelectedId] = useState<string>(ALL_CATEGORY_ID);
  const [rootFolders, setRootFolders] = useState<LibraryRootFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [opened, setOpened] = useState<LibraryRootFolder | null>(null);
  const [subStack, setSubStack] = useState<LibrarySubFolder[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [newRootName, setNewRootName] = useState('');
  const [newRootPath, setNewRootPath] = useState('');
  const [manageOpen, setManageOpen] = useState(false);

  const switchRoot = (id: string) => {
    setActiveRoot(id);
    setSelectedId(ALL_CATEGORY_ID);
    setOpened(null);
    setSubStack([]);
  };
  const openAddRoot = () => {
    setNewRootName('');
    setNewRootPath('');
    setAddOpen(true);
  };
  const pickRootDir = async () => {
    try {
      const dir = await dialog.open({ directory: true, title: '选择库根目录' });
      if (typeof dir === 'string') {
        setNewRootPath(dir);
        setNewRootName(
          (prev) => prev || dir.split(/[\\/]/).filter(Boolean).pop() || dir,
        );
      }
    } catch (err) {
      message.error(getErrorMessage(err) || '选择目录失败');
    }
  };
  const confirmAddRoot = () => {
    if (!newRootPath) {
      message.error('请先选择目录');
      return;
    }
    const id = addRoot(newRootName || newRootPath, newRootPath);
    setAddOpen(false);
    switchRoot(id);
  };

  // 切换库根时回到「全部」并关闭已打开的文件夹
  useEffect(() => {
    setSelectedId(ALL_CATEGORY_ID);
    setOpened(null);
    setSubStack([]);
  }, [activeRootId]);

  const loadFolders = useCallback(
    async (refresh = false) => {
      if (!rootPath) {
        setRootFolders([]);
        return;
      }
      setLoading(true);
      try {
        const listed = await listRootFolders(rootPath);
        const summarized = await summarizeFolders(listed, refresh);
        const mtimes = await fetchMtimes(summarized.map((f) => f.path));
        setRootFolders(
          summarized.map((folder, index) => ({
            ...folder,
            mtime: mtimes[index] ?? undefined,
          })),
        );
      } catch (err: unknown) {
        log.error(err);
        message.error(
          getErrorMessage(err) || '读取保存目录失败，请检查设置中的保存路径',
        );
        setRootFolders([]);
      } finally {
        setLoading(false);
      }
    },
    [rootPath, message],
  );

  useEffect(() => {
    loadFolders(false);
  }, [loadFolders]);

  const counts = useMemo(() => {
    const assigned = new Set(categories.flatMap((c) => c.folders));
    const byId: Record<string, number> = {};
    for (const category of categories) {
      const subtree = collectCategorySubtree(categories, category.id);
      byId[category.id] = rootFolders.filter((folder) =>
        categories.some(
          (c) => subtree.has(c.id) && c.folders.includes(folder.name),
        ),
      ).length;
    }
    return {
      all: rootFolders.length,
      unclassified: rootFolders.filter((f) => !assigned.has(f.name)).length,
      byId,
    };
  }, [rootFolders, categories]);

  const filteredFolders = useMemo(() => {
    let list = rootFolders;
    if (selectedId === UNCLASSIFIED_CATEGORY_ID) {
      const assigned = new Set(categories.flatMap((c) => c.folders));
      list = list.filter((f) => !assigned.has(f.name));
    } else if (selectedId !== ALL_CATEGORY_ID) {
      const subtree = collectCategorySubtree(categories, selectedId);
      list = list.filter((f) =>
        categories.some((c) => subtree.has(c.id) && c.folders.includes(f.name)),
      );
    }
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      list = list.filter((f) => f.name.toLowerCase().includes(kw));
    }
    return list;
  }, [rootFolders, categories, selectedId, keyword]);

  const handleSelectCategory = (id: string) => {
    setSelectedId(id);
    setOpened(null);
    setSubStack([]);
  };

  const currentDir = subStack.length
    ? subStack[subStack.length - 1].path
    : opened?.path || '';

  const backToLibrary = () => {
    setOpened(null);
    setSubStack([]);
  };
  const goUpOne = () => {
    if (subStack.length > 0) setSubStack((prev) => prev.slice(0, -1));
    else backToLibrary();
  };

  const breadcrumbItems = [
    {
      title: <a onClick={backToLibrary}>本地库</a>,
    },
    ...(opened
      ? [
          {
            title:
              subStack.length > 0 ? (
                <a onClick={() => setSubStack([])}>{opened.name}</a>
              ) : (
                opened.name
              ),
          },
        ]
      : []),
    ...subStack.map((folder, index) => ({
      title:
        index === subStack.length - 1 ? (
          folder.name
        ) : (
          <a onClick={() => setSubStack((prev) => prev.slice(0, index + 1))}>
            {folder.name}
          </a>
        ),
    })),
  ];

  return (
    <div className="flex flex-col h-screen">
      <PageHeader />
      {!rootPath ? (
        <Empty
          className="mt-24"
          description={
            isExternal
              ? '该库根路径无效，请在「管理库根」里检查或重新选择'
              : '尚未设置保存目录，请先到「设置 → 下载」中设置保存路径'
          }
        />
      ) : (
        <div className="flex-1 min-h-0 flex gap-2 pb-4">
          {!sidebarCollapsed && (
            <CategorySidebar
              rootId={activeRootId}
              selectedId={selectedId}
              onSelect={handleSelectCategory}
              counts={counts}
              header={
                <div className="flex items-center gap-1">
                  <Select
                    size="small"
                    className="flex-1 min-w-0"
                    value={activeRootId}
                    onChange={(v) => {
                      if (v === '__add__') {
                        openAddRoot();
                        return;
                      }
                      switchRoot(v);
                    }}
                    options={[
                      { value: DEFAULT_ROOT_ID, label: '下载目录' },
                      ...roots.map((r) => ({ value: r.id, label: r.name })),
                      { value: '__add__', label: '＋ 添加库根…' },
                    ]}
                  />
                  <Button
                    size="small"
                    icon={<SettingOutlined />}
                    title="管理库根"
                    onClick={() => setManageOpen(true)}
                  />
                </div>
              }
            />
          )}
          <button
            type="button"
            aria-label={sidebarCollapsed ? '展开标签树' : '折叠标签树'}
            title={sidebarCollapsed ? '展开标签树' : '折叠标签树'}
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="flex w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 transition-colors hover:text-gray-800"
          >
            {sidebarCollapsed ? <RightOutlined /> : <LeftOutlined />}
          </button>
          <section
            className="flex-1 min-w-0 flex flex-col"
            aria-label="本地库内容"
          >
            {opened && (
              <div className="flex items-center gap-3 pb-3">
                <Breadcrumb items={breadcrumbItems} />
                <div className="ml-auto flex shrink-0 gap-2">
                  <Button size="small" onClick={goUpOne}>
                    上一级
                  </Button>
                  {subStack.length > 0 && (
                    <Button size="small" onClick={backToLibrary}>
                      返回库
                    </Button>
                  )}
                </div>
              </div>
            )}
            {opened ? (
              <FolderDetail
                dir={currentDir}
                rootId={activeRootId}
                rootPath={rootPath}
                isExternal={isExternal}
                rootFolderName={opened.name}
                onOpenFolder={(folder) =>
                  setSubStack((prev) => [...prev, folder])
                }
              />
            ) : (
              <FolderGrid
                rootId={activeRootId}
                rootPath={rootPath}
                isExternal={isExternal}
                folders={filteredFolders}
                loading={loading}
                keyword={keyword}
                onKeywordChange={setKeyword}
                onOpen={(folder) => {
                  setOpened(folder);
                  setSubStack([]);
                }}
                onRefresh={() => loadFolders(true)}
              />
            )}
          </section>
        </div>
      )}

      <Modal
        open={addOpen}
        title="添加库根"
        okText="添加"
        cancelText="取消"
        onOk={confirmAddRoot}
        onCancel={() => setAddOpen(false)}
        destroyOnClose
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-sm text-gray-500">名称</span>
            <Input
              value={newRootName}
              placeholder="给这个库起个名字"
              onChange={(e) => setNewRootName(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-sm text-gray-500">目录</span>
            <Input
              value={newRootPath}
              placeholder="选择本地目录"
              readOnly
              onClick={pickRootDir}
            />
            <Button onClick={pickRootDir}>选择…</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={manageOpen}
        title="管理库根"
        footer={null}
        onCancel={() => setManageOpen(false)}
      >
        <div className="mb-2 text-sm text-gray-500">
          下载目录（默认，不可移除）
        </div>
        {roots.length === 0 ? (
          <div className="text-sm text-gray-400">还没有外部库根</div>
        ) : (
          <div className="space-y-2">
            {roots.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <Input
                  size="small"
                  defaultValue={r.name}
                  onBlur={(e) => renameRoot(r.id, e.target.value)}
                  className="w-40 shrink-0"
                />
                <span
                  className="min-w-0 flex-1 truncate text-xs text-gray-400"
                  title={r.path}
                >
                  {r.path}
                </span>
                <Button size="small" danger onClick={() => removeRoot(r.id)}>
                  移除
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 text-xs text-gray-400">
          移除只删除配置，不会删除磁盘里的文件。
        </div>
      </Modal>
    </div>
  );
};
