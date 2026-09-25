/* eslint-disable react/prop-types */
import { App, Breadcrumb, Button, Empty } from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import {
  ALL_CATEGORY_ID,
  CategorySidebar,
  UNCLASSIFIED_CATEGORY_ID,
} from '../components/library/CategorySidebar';
import { FolderDetail } from '../components/library/FolderDetail';
import { FolderGrid } from '../components/library/FolderGrid';
import { useLibraryStore } from '../stores/library';
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
  const categories = useLibraryStore((s) => s.categories);

  const [selectedId, setSelectedId] = useState<string>(ALL_CATEGORY_ID);
  const [rootFolders, setRootFolders] = useState<LibraryRootFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [opened, setOpened] = useState<LibraryRootFolder | null>(null);
  const [subStack, setSubStack] = useState<LibrarySubFolder[]>([]);

  const loadFolders = useCallback(
    async (refresh = false) => {
      if (!saveDirBase) {
        setRootFolders([]);
        return;
      }
      setLoading(true);
      try {
        const listed = await listRootFolders(saveDirBase);
        const summarized = await summarizeFolders(listed, refresh);
        const mtimes = await fetchMtimes(summarized.map((f) => f.path));
        setRootFolders(
          summarized.map((folder, index) => ({
            ...folder,
            mtime: mtimes[index] ?? undefined,
          })),
        );
      } catch (err: any) {
        log.error(err);
        message.error(
          err?.message || '读取保存目录失败，请检查设置中的保存路径',
        );
        setRootFolders([]);
      } finally {
        setLoading(false);
      }
    },
    [saveDirBase, message],
  );

  useEffect(() => {
    loadFolders(false);
  }, [loadFolders]);

  const counts = useMemo(() => {
    const assigned = new Set(categories.flatMap((c) => c.folders));
    const byId: Record<string, number> = {};
    for (const category of categories) {
      byId[category.id] = category.folders.length;
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
      const category = categories.find((c) => c.id === selectedId);
      list = category
        ? list.filter((f) => category.folders.includes(f.name))
        : [];
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

  const breadcrumbItems = [
    {
      title: (
        <a
          onClick={() => {
            setOpened(null);
            setSubStack([]);
          }}
        >
          {opened ? opened.name : '本地库'}
        </a>
      ),
    },
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
      {!saveDirBase ? (
        <Empty
          className="mt-24"
          description="尚未设置保存目录，请先到「设置 → 下载」中设置保存路径"
        />
      ) : (
        <div className="flex-1 min-h-0 flex gap-4 pb-4">
          <CategorySidebar
            selectedId={selectedId}
            onSelect={handleSelectCategory}
            counts={counts}
          />
          <section
            className="flex-1 min-w-0 flex flex-col"
            aria-label="本地库内容"
          >
            {opened && (
              <div className="flex items-center gap-3 pb-3">
                <Breadcrumb items={breadcrumbItems} />
                <Button
                  size="small"
                  className="ml-auto"
                  onClick={() => {
                    setOpened(null);
                    setSubStack([]);
                  }}
                >
                  返回
                </Button>
              </div>
            )}
            {opened ? (
              <FolderDetail
                dir={currentDir}
                rootFolderName={opened.name}
                onOpenFolder={(folder) =>
                  setSubStack((prev) => [...prev, folder])
                }
              />
            ) : (
              <FolderGrid
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
    </div>
  );
};
