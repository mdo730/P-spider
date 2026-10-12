import { getErrorMessage } from '../../utils/error';
import {
  CheckOutlined,
  DeleteOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  ThunderboltOutlined,
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
  Pagination,
  Progress,
  Spin,
} from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { deleteLibraryFiles } from '../../services/library-actions';
import {
  clearLibraryVisualTags,
  collectImagesUnderFolders,
  readLibraryVisualTags,
} from '../../services/library-visual';
import { effectiveItems, VisualRecord } from '../../services/vision-core';
import { useLibraryVisionStore } from '../../stores/library-vision';
import { useLibraryStore } from '../../stores/library';
import {
  getPlatformSegments,
  normalizePath,
} from '../../stores/download-history';
import { useSettingsStore } from '../../stores/settings';
import { PlatformSource } from '../../platforms';
import {
  FOLDER_SORT_OPTIONS,
  FolderSortKey,
  LibraryFile,
  LibraryRootFolder,
  getMediaKind,
  readTraceMap,
  sortFolders,
} from '../../utils/library';
import { showInFolder } from '../../utils/shell';
import { useSelection } from '../../hooks/useSelection';
import { VisionFilterPanel } from './VisionFilterPanel';
import { FileGrid } from './FileGrid';
import { FolderCover } from './FolderCover';
import { FolderProperties } from './FolderProperties';
import { PlatformBadge } from './PlatformBadge';
import { SortSelect } from './SortSelect';
import { VisualTagEditor } from './VisualTagEditor';

interface Props {
  folders: LibraryRootFolder[];
  loading: boolean;
  keyword: string;
  onKeywordChange: (value: string) => void;
  onOpen: (folder: LibraryRootFolder) => void;
  onRefresh: () => void;
}

/** 文件夹网格每页数量 */
const FOLDER_PAGE_SIZE = 60;
/** 根目录视觉筛选结果的媒体网格每页数量 */
const MEDIA_PAGE_SIZE = 120;

/** 本地库一级文件夹网格：封面 + 名称 + 标签（多标签）+ 属性 + 多选批量 */
export const FolderGrid: React.FC<Props> = ({
  folders,
  loading,
  keyword,
  onKeywordChange,
  onOpen,
  onRefresh,
}) => {
  const { message, modal } = App.useApp();
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
    Promise.all([getPlatformSegments(saveDirBase), readTraceMap()])
      .then(([segPlatform, trace]) => {
        if (cancelled || !saveDirBase) return;
        const prefix = `${normalizePath(saveDirBase).replace(/\\+$/, '')}\\`;
        const map = new Map<string, PlatformSource>();
        for (const [seg, platform] of segPlatform) map.set(seg, platform);
        const consider = (filePath?: string, platform?: PlatformSource) => {
          if (!filePath || !platform) return;
          const normalized = normalizePath(filePath);
          if (!normalized.startsWith(prefix)) return;
          const seg = normalized.slice(prefix.length).split('\\')[0];
          if (seg && !map.has(seg)) map.set(seg, platform);
        };
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

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    clearSelection();
  };

  const visionRunning = useLibraryVisionStore((s) => s.running);
  const visionProgress = useLibraryVisionStore((s) => s.progress);

  // 批量识别：统计所选/当前文件夹里的所有图片 → 后台 WD14 打标
  const recognizeFolders = async (folderPaths: string[]) => {
    if (visionRunning) return;
    if (folderPaths.length === 0) {
      message.info('没有可识别的文件夹');
      return;
    }
    const hide = message.loading('正在统计图片…', 0);
    let paths: string[] = [];
    try {
      paths = await collectImagesUnderFolders(folderPaths);
    } finally {
      hide();
    }
    if (paths.length === 0) {
      message.info('这些文件夹里没有图片');
      return;
    }
    Modal.confirm({
      title: 'WD14 视觉识别',
      content: `将识别 ${folderPaths.length} 个文件夹里的 ${paths.length} 张图片（已识别的自动跳过）。识别在后台进行，可继续其它操作。`,
      okText: '开始',
      cancelText: '取消',
      onOk: () => useLibraryVisionStore.getState().start(paths),
    });
  };

  // ---- 表层视觉筛选：按文件夹聚合图片的视觉标签 ----
  const visionVersion = useLibraryVisionStore((s) => s.version);
  const [visualMap, setVisualMap] = useState<Map<string, VisualRecord>>(
    new Map(),
  );
  const [visualSelected, setVisualSelected] = useState<string[]>([]);
  const [visualRule, setVisualRule] = useState<'or' | 'and'>('or');
  const [visionPanelOpen, setVisionPanelOpen] = useState(false);
  const [visualRev, setVisualRev] = useState(0);
  const [page, setPage] = useState(1);
  const [mediaPage, setMediaPage] = useState(1);
  const [visualEditPath, setVisualEditPath] = useState<string | null>(null);

  useEffect(() => {
    readLibraryVisualTags()
      .then(setVisualMap)
      .catch(() => undefined);
  }, [visionVersion, visualRev]);

  const clearFoldersVisual = (folderPaths: string[]) => {
    if (folderPaths.length === 0) return;
    modal.confirm({
      title: `清除 ${folderPaths.length} 个文件夹的视觉标签？`,
      content: '将清除这些文件夹（含子文件夹）所有图片的视觉识别结果。',
      okText: '清除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const n = await clearLibraryVisualTags(folderPaths);
        setVisualRev((v) => v + 1);
        message.success(
          n > 0 ? `已清除 ${n} 条视觉标签` : '没有可清除的视觉标签',
        );
      },
    });
  };

  const basePrefix = useMemo(
    () => normalizePath(saveDirBase || '').replace(/\\+$/, '') + '\\',
    [saveDirBase],
  );

  /** 文件夹名（小写）→ 该文件夹下所有图片命中的标签集合 */
  const folderTagSets = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!saveDirBase) return m;
    const known = new Set(sortedFolders.map((f) => f.name.toLowerCase()));
    for (const [p, rec] of visualMap) {
      const np = normalizePath(p);
      if (!np.startsWith(basePrefix)) continue;
      const seg = np.slice(basePrefix.length).split('\\')[0].toLowerCase();
      if (!known.has(seg)) continue;
      let set = m.get(seg);
      if (!set) {
        set = new Set();
        m.set(seg, set);
      }
      for (const it of effectiveItems(rec)) set.add(`${it.cat}|${it.zh}`);
    }
    return m;
  }, [visualMap, saveDirBase, basePrefix, sortedFolders]);

  const recognizedFolders = useMemo(() => {
    const s = new Set<string>();
    if (!saveDirBase) return s;
    for (const p of visualMap.keys()) {
      const np = normalizePath(p);
      if (np.startsWith(basePrefix)) {
        s.add(np.slice(basePrefix.length).split('\\')[0].toLowerCase());
      }
    }
    return s;
  }, [visualMap, saveDirBase, basePrefix]);

  const visualMeta = useMemo(() => {
    const meta = new Map<string, { cat: string; zh: string }>();
    for (const rec of visualMap.values()) {
      for (const it of effectiveItems(rec)) {
        const key = `${it.cat}|${it.zh}`;
        if (!meta.has(key)) meta.set(key, { cat: it.cat, zh: it.zh });
      }
    }
    return meta;
  }, [visualMap]);

  const displayFolders = useMemo(() => {
    if (!visualSelected.length) return sortedFolders;
    return sortedFolders.filter((f) => {
      const set = folderTagSets.get(f.name.toLowerCase());
      if (!set) return false;
      return visualRule === 'and'
        ? visualSelected.every((k) => set.has(k))
        : visualSelected.some((k) => set.has(k));
    });
  }, [sortedFolders, visualSelected, visualRule, folderTagSets]);

  // 分页：只渲染当前页
  const pagedFolders = useMemo(
    () =>
      displayFolders.slice(
        (page - 1) * FOLDER_PAGE_SIZE,
        page * FOLDER_PAGE_SIZE,
      ),
    [displayFolders, page],
  );

  const {
    selected,
    isSelected,
    toggle,
    toggleAll,
    clear: clearSelection,
    selectedCount,
    allSelected,
  } = useSelection(pagedFolders.map((f) => f.path));

  const selectedFolders = useMemo(
    () => pagedFolders.filter((f) => selected.has(f.path)),
    [pagedFolders, selected],
  );

  // 关键字/视觉筛选/排序变化时回到第 1 页
  useEffect(() => {
    setPage(1);
  }, [keyword, visualSelected, sort]);

  // ---- 根目录媒体视图：视觉筛选激活时，直接从索引取命中图片平铺（跨文件夹聚合）----
  const mediaFiles = useMemo(() => {
    if (!visualSelected.length) return [] as LibraryFile[];
    const out: LibraryFile[] = [];
    const known = new Set(sortedFolders.map((f) => f.name.toLowerCase()));
    for (const [p, rec] of visualMap) {
      const np = normalizePath(p);
      if (!np.startsWith(basePrefix)) continue;
      const seg = np.slice(basePrefix.length).split('\\')[0].toLowerCase();
      if (!known.has(seg)) continue;
      const set = new Set(
        effectiveItems(rec).map((it) => `${it.cat}|${it.zh}`),
      );
      const ok =
        visualRule === 'and'
          ? visualSelected.every((k) => set.has(k))
          : visualSelected.some((k) => set.has(k));
      if (!ok) continue;
      const name = p.split(/[\\/]/).pop() || p;
      const dot = name.lastIndexOf('.');
      out.push({
        path: p,
        name,
        kind: 'image',
        ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
      });
    }
    out.sort((a, b) =>
      a.path.localeCompare(b.path, undefined, { numeric: true }),
    );
    return out;
  }, [visualSelected, visualRule, visualMap, basePrefix, sortedFolders]);

  const pagedMedia = useMemo(
    () =>
      mediaFiles.slice(
        (mediaPage - 1) * MEDIA_PAGE_SIZE,
        mediaPage * MEDIA_PAGE_SIZE,
      ),
    [mediaFiles, mediaPage],
  );

  const {
    selected: mediaSelected,
    toggle: mediaToggle,
    toggleAll: mediaToggleAll,
    clear: mediaClear,
    selectedCount: mediaSelectedCount,
    allSelected: mediaAllSelected,
  } = useSelection(pagedMedia.map((f) => f.path));

  useEffect(() => {
    setMediaPage(1);
  }, [visualSelected, visualRule]);

  // 切换视觉筛选时清空两种选择
  useEffect(() => {
    clearSelection();
    mediaClear();
  }, [visualSelected, clearSelection, mediaClear]);

  const handleVisualSaved = (rec: VisualRecord) =>
    setVisualMap((m) => {
      const n = new Map(m);
      n.set(rec.postId, rec);
      return n;
    });

  const filterByVisualTag = (key: string) => {
    setVisualSelected([key]);
    setVisionPanelOpen(true);
  };

  const batchDeleteMedia = () => {
    const targets = pagedMedia.filter((f) => mediaSelected.has(f.path));
    if (targets.length === 0) return;
    modal.confirm({
      title: `删除 ${targets.length} 张图片？`,
      content: '将永久删除所选文件，删除后不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const r = await deleteLibraryFiles(targets.map((f) => f.path));
        mediaClear();
        setVisualRev((v) => v + 1);
        message.success(`已删除 ${r.deleted} 张`);
      },
    });
  };

  const visualTagCounts = useMemo(() => {
    const counts = new Map<
      string,
      { cat: string; zh: string; count: number }
    >();
    for (const f of sortedFolders) {
      const set = folderTagSets.get(f.name.toLowerCase());
      if (!set) continue;
      for (const key of set) {
        const meta = visualMeta.get(key);
        if (!meta) continue;
        const c = counts.get(key) || { cat: meta.cat, zh: meta.zh, count: 0 };
        c.count += 1;
        counts.set(key, c);
      }
    }
    return counts;
  }, [sortedFolders, folderTagSets, visualMeta]);

  const visualTagGroups = useMemo(() => {
    const order = [
      '体型',
      '服装',
      '发型',
      '姿势',
      '构图',
      '元素',
      '道具',
      '配饰',
      '内容',
      'R18',
    ];
    const byCat = new Map<
      string,
      { cat: string; zh: string; count: number }[]
    >();
    for (const v of visualTagCounts.values()) {
      const arr = byCat.get(v.cat) || [];
      arr.push(v);
      byCat.set(v.cat, arr);
    }
    const rank = (c: string) => {
      const i = order.indexOf(c);
      return i < 0 ? 99 : i;
    };
    return [...byCat.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]))
      .map(
        ([cat, arr]) =>
          [cat, arr.sort((x, y) => y.count - x.count)] as [string, typeof arr],
      );
  }, [visualTagCounts]);

  const toggleVisual = (key: string) =>
    setVisualSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

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
    } catch (err: unknown) {
      message.error(getErrorMessage(err) || '创建标签失败');
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
          {visualSelected.length > 0 ? ` · 命中 ${mediaFiles.length} 张图` : ''}
        </span>
        <span className="ml-auto" />
        <Button
          type={selectMode ? 'primary' : 'default'}
          onClick={toggleSelectMode}
        >
          多选
        </Button>
        <Button
          icon={visionRunning ? <LoadingOutlined /> : <ThunderboltOutlined />}
          disabled={
            visionRunning || (selectedCount === 0 && sortedFolders.length === 0)
          }
          onClick={() =>
            recognizeFolders(
              (selectedCount > 0 ? selectedFolders : sortedFolders).map(
                (f) => f.path,
              ),
            )
          }
          title={
            selectedCount > 0
              ? `WD14 识别所选 ${selectedCount} 个文件夹里的所有图片`
              : `WD14 识别当前列表 ${sortedFolders.length} 个文件夹里的所有图片`
          }
        >
          {selectedCount > 0 ? `识别所选 ${selectedCount}` : '识别'}
        </Button>
        <Button
          type={
            visionPanelOpen || visualSelected.length > 0 ? 'primary' : 'default'
          }
          icon={<SettingOutlined />}
          onClick={() => setVisionPanelOpen((v) => !v)}
          title="按视觉标签筛选文件夹"
        >
          视觉筛选
          {visualSelected.length > 0 ? ` ${visualSelected.length}` : ''}
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

      <VisionFilterPanel
        open={visionPanelOpen}
        onClose={() => setVisionPanelOpen(false)}
        groups={visualTagGroups}
        selected={visualSelected}
        onToggle={toggleVisual}
        rule={visualRule}
        onRuleChange={setVisualRule}
        onClear={() => setVisualSelected([])}
        subtitle={
          visualSelected.length > 0
            ? `命中 ${mediaFiles.length} 张图`
            : `库根 · ${recognizedFolders.size} 个文件夹`
        }
        emptyText="还没有识别结果，先点「识别」"
      />

      {selectMode && visualSelected.length > 0 && (
        <div className="flex items-center gap-2 pb-3">
          <span className="text-sm text-gray-500">
            已选 {mediaSelectedCount} 张
          </span>
          <Button size="small" onClick={mediaToggleAll}>
            {mediaAllSelected ? '取消全选' : '全选'}
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={mediaSelectedCount === 0}
            onClick={batchDeleteMedia}
          >
            删除图片
          </Button>
          {mediaSelectedCount > 0 && (
            <Button size="small" type="link" onClick={mediaClear}>
              清空选择
            </Button>
          )}
        </div>
      )}

      {selectMode && visualSelected.length === 0 && (
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
          <Button
            size="small"
            danger
            disabled={selectedCount === 0}
            onClick={() =>
              clearFoldersVisual(selectedFolders.map((f) => f.path))
            }
            title="清除所选文件夹（含子文件夹）的视觉标签"
          >
            清除视觉
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
        ) : visualSelected.length > 0 ? (
          mediaFiles.length === 0 ? (
            <Empty className="mt-16" description="没有命中视觉标签的图片" />
          ) : (
            <>
              <FileGrid
                files={pagedMedia}
                selectMode={selectMode}
                selected={mediaSelected}
                onToggle={mediaToggle}
                onDeleted={() => setVisualRev((v) => v + 1)}
                visualMap={visualMap}
                onEditVisual={(path) => setVisualEditPath(path)}
                onVisualSaved={handleVisualSaved}
                onFilterTag={filterByVisualTag}
              />
              {mediaFiles.length > MEDIA_PAGE_SIZE && (
                <div className="flex justify-center pt-4">
                  <Pagination
                    current={mediaPage}
                    pageSize={MEDIA_PAGE_SIZE}
                    total={mediaFiles.length}
                    showSizeChanger={false}
                    showQuickJumper
                    onChange={setMediaPage}
                  />
                </div>
              )}
            </>
          )
        ) : displayFolders.length === 0 ? (
          <Empty
            className="mt-16"
            description={
              keyword
                ? '没有匹配的文件夹'
                : '该分类下暂无文件夹，去「全部」里给文件夹打标签吧'
            }
          />
        ) : (
          <>
            <ul
              className="grid grid-cols-[repeat(auto-fill,minmax(9rem,10rem))] gap-3"
              onContextMenu={(e) => e.preventDefault()}
            >
              {pagedFolders.map((folder) => (
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
                    } catch (err: unknown) {
                      message.error(
                        getErrorMessage(err) || '打开资源管理器失败',
                      );
                    }
                  }}
                  onCreateAndAdd={() => openCreateModal([folder.name])}
                  onShowProps={() => setPropsTarget(folder)}
                  onClearVisual={() => clearFoldersVisual([folder.path])}
                  recognized={recognizedFolders.has(folder.name.toLowerCase())}
                />
              ))}
              {loading && (
                <li className="h-[11rem] flex items-center justify-center bg-white rounded-md border-[1px] border-gray-100">
                  <LoadingOutlined className="text-4xl text-ant-color-primary" />
                </li>
              )}
            </ul>
            {!loading && displayFolders.length > FOLDER_PAGE_SIZE && (
              <div className="flex justify-center pt-4">
                <Pagination
                  current={page}
                  pageSize={FOLDER_PAGE_SIZE}
                  total={displayFolders.length}
                  showSizeChanger={false}
                  showQuickJumper
                  onChange={setPage}
                />
              </div>
            )}
          </>
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

      {/* WD14 批量识别进度（后台运行） */}
      {visionProgress && (
        <div className="fixed right-5 bottom-6 z-30 flex items-center gap-3 rounded-full border border-gray-100 bg-white/95 px-3 py-2 shadow-lg">
          <Progress
            type="circle"
            size={34}
            percent={
              visionProgress.total
                ? Math.round((visionProgress.done / visionProgress.total) * 100)
                : 0
            }
            format={() => `${visionProgress.done}`}
          />
          <div className="text-xs leading-tight">
            <div className="font-medium">
              识别中 {visionProgress.index}/{visionProgress.total}
            </div>
            <div className="max-w-[180px] truncate text-gray-400">
              {visionProgress.currentTitle}
            </div>
          </div>
          <Button
            size="small"
            danger
            onClick={() => useLibraryVisionStore.getState().stop()}
          >
            停止
          </Button>
        </div>
      )}

      <VisualTagEditor
        open={!!visualEditPath}
        filePath={visualEditPath}
        fileLabel={
          visualEditPath ? visualEditPath.split(/[\\/]/).pop() : undefined
        }
        record={visualEditPath ? visualMap.get(visualEditPath) : undefined}
        onClose={() => setVisualEditPath(null)}
        onSaved={handleVisualSaved}
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
  onClearVisual: () => void;
  /** 该文件夹下已有图片完成视觉识别 */
  recognized: boolean;
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
  onClearVisual,
  recognized,
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
    { key: 'clearVisual', label: '清除视觉标签', icon: <DeleteOutlined /> },
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
    if (key === 'clearVisual') return onClearVisual();
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
        className={`lib-card-cv relative bg-white rounded-md border-[1px] overflow-hidden group ${
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
            coverKind={
              coverOverride
                ? getMediaKind(coverOverride) || 'image'
                : folder.coverKind
            }
            wrapperClassName="w-full h-[9rem]"
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
        {recognized && (
          <span
            title="已视觉识别"
            className="absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-white shadow"
          >
            <EyeOutlined className="text-[10px] leading-none" />
          </span>
        )}
        <PlatformBadge platform={platform} />
      </li>
    </Dropdown>
  );
};
