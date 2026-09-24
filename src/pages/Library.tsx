/* eslint-disable react/prop-types */
import { App, Breadcrumb, Button, Empty } from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { CategorySidebar } from '../components/library/CategorySidebar';
import { FolderDetail } from '../components/library/FolderDetail';
import { FolderGrid } from '../components/library/FolderGrid';
import { useLibraryStore } from '../stores/library';
import { useSettingsStore } from '../stores/settings';
import {
  DEFAULT_LIBRARY_FILTER,
  LibraryFilter,
  LibraryRootFolder,
  LibrarySubFolder,
  buildTagIndex,
  fetchMtimes,
  listRootFolders,
  mapLimit,
  matchesFilter,
  normalizeRel,
  summarizeFolder,
  summarizeFolders,
  toRelPath,
} from '../utils/library';

/** 本地库：多级标签管理 saveDirBase 下的文件夹（含子文件夹），按标签浏览 */
export const LibraryPage: React.FC = () => {
  const { message } = App.useApp();
  const saveDirBase = useSettingsStore((s) => s.download.saveDirBase);
  const tags = useLibraryStore((s) => s.tags);
  const index = useMemo(() => buildTagIndex(tags), [tags]);

  const [filter, setFilter] = useState<LibraryFilter>(DEFAULT_LIBRARY_FILTER);
  const [rootFolders, setRootFolders] = useState<LibraryRootFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [tagMatched, setTagMatched] = useState<LibraryRootFolder[]>([]);
  const [tagLoading, setTagLoading] = useState(false);
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
          summarized.map((folder, i) => ({
            ...folder,
            mtime: mtimes[i] ?? undefined,
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

  const relOf = (path: string) => toRelPath(path, saveDirBase);

  const counts = useMemo(() => {
    const byId: Record<string, number> = {};
    for (const t of tags) {
      const set = new Set<string>();
      for (const tid of index.subtreeIds(t.id)) {
        const tag = index.byId.get(tid);
        if (tag) tag.paths.forEach((p) => set.add(normalizeRel(p)));
      }
      byId[t.id] = set.size;
    }
    const unclassified = rootFolders.filter(
      (f) =>
        useLibraryStore.getState().getFolderTagIds(relOf(f.path)).length === 0,
    ).length;
    return { all: rootFolders.length, unclassified, byId };
  }, [tags, index, rootFolders, saveDirBase]);

  // 标签筛选：直接展示“命中的文件夹本身”（任意层级），而非包含命中的根文件夹
  useEffect(() => {
    if (filter.kind !== 'tags' || !saveDirBase) {
      setTagMatched([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setTagLoading(true);
      try {
        const candidates = new Set<string>();
        for (const id of filter.tagIds) {
          for (const tid of index.subtreeIds(id)) {
            const t = index.byId.get(tid);
            if (t) t.paths.forEach((p) => candidates.add(normalizeRel(p)));
          }
        }
        const matched = [...candidates].filter((p) =>
          matchesFilter(index, filter.tagIds, filter.rule, p),
        );
        const base = saveDirBase.replace(/[\\/]+$/, '');
        const absList = matched.map((rel) => ({
          rel,
          path: `${base}\\${rel.replace(/\//g, '\\')}`,
        }));
        const summaries = await mapLimit(absList, 6, async (f) => ({
          ...f,
          summary: await summarizeFolder(f.path),
        }));
        const mtimes = await fetchMtimes(summaries.map((f) => f.path));
        const result: LibraryRootFolder[] = [];
        summaries.forEach((f, i) => {
          if (!f.summary) return;
          result.push({
            name: f.rel.split('/').pop() || f.rel,
            path: f.path,
            ...f.summary,
            mtime: mtimes[i] ?? undefined,
          });
        });
        if (!cancelled) setTagMatched(result);
      } catch (err) {
        log.error('标签筛选失败', err);
        if (!cancelled) setTagMatched([]);
      } finally {
        if (!cancelled) setTagLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, index, saveDirBase]);

  const filteredFolders = useMemo(() => {
    let list: LibraryRootFolder[];
    if (filter.kind === 'tags') {
      list = tagMatched;
    } else if (filter.kind === 'unclassified') {
      list = rootFolders.filter(
        (f) =>
          useLibraryStore.getState().getFolderTagIds(relOf(f.path)).length ===
          0,
      );
    } else {
      list = rootFolders;
    }
    const kw = keyword.trim().toLowerCase();
    if (kw) list = list.filter((f) => f.name.toLowerCase().includes(kw));
    return list;
  }, [rootFolders, tagMatched, filter, keyword, saveDirBase]);

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
    ...subStack.map((folder, i) => ({
      title:
        i === subStack.length - 1 ? (
          folder.name
        ) : (
          <a onClick={() => setSubStack((prev) => prev.slice(0, i + 1))}>
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
            filter={filter}
            counts={counts}
            onChange={setFilter}
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
                saveDirBase={saveDirBase}
                onOpenFolder={(folder) =>
                  setSubStack((prev) => [...prev, folder])
                }
              />
            ) : (
              <FolderGrid
                folders={filteredFolders}
                loading={loading || tagLoading}
                keyword={keyword}
                onKeywordChange={setKeyword}
                saveDirBase={saveDirBase}
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
