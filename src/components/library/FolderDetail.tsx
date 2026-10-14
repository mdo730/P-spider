import { getErrorMessage } from '../../utils/error';
import {
  AppstoreOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Dropdown,
  Empty,
  MenuProps,
  Pagination,
  Progress,
  Segmented,
  Spin,
  Tag,
} from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { deleteLibraryFiles } from '../../services/library-actions';
import {
  clearLibraryVisualTags,
  readLibraryVisualTags,
} from '../../services/library-visual';
import { effectiveItems, VisualRecord } from '../../services/vision-core';
import {
  DownloadHistoryRecord,
  getHistoryByPaths,
  getPlatformSegments,
  normalizePath,
} from '../../stores/download-history';
import { useLibraryVisionStore } from '../../stores/library-vision';
import { useSettingsStore } from '../../stores/settings';
import { PlatformSource } from '../../platforms';
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
} from '../../utils/library';
import { showInFolder } from '../../utils/shell';
import { useSelection } from '../../hooks/useSelection';
import { FileGrid } from './FileGrid';
import { FolderCover } from './FolderCover';
import { FolderProperties } from './FolderProperties';
import { SortSelect } from './SortSelect';
import { VisionFilterPanel } from './VisionFilterPanel';
import { VisualTagEditor } from './VisualTagEditor';

interface Props {
  dir: string;
  /** 最外层一级文件夹名（用于「设为文件夹缩略图」） */
  rootFolderName?: string;
  onOpenFolder: (folder: LibrarySubFolder) => void;
}

const VISUAL_CAT_ORDER = [
  '体型',
  '服装',
  '发型',
  '姿势',
  '构图',
  '元素',
  '道具',
  '配饰',
  '内容',
  '图类',
  'R18',
];

/** 文件网格每页数量 */
const FILE_PAGE_SIZE = 120;

/** 文件夹详情：平铺/按文件夹切换、排序、文件多选批量删除、右键菜单/属性 + WD14 视觉标签 */
export const FolderDetail: React.FC<Props> = ({
  dir,
  rootFolderName,
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
  const [historyMap, setHistoryMap] = useState<
    Map<string, DownloadHistoryRecord>
  >(new Map());
  const [traceMap, setTraceMap] = useState<Map<string, TracedRecord>>(
    new Map(),
  );

  // ---- 按平台决定默认排序 ----
  // pawchive（归档站）：按帖子顺序（时间 新→旧）；X / pixiv：名称 Z→A。
  // 平台取自下载历史（hist_platform_segments，比「有无子文件夹」的结构启发式准）。
  const saveDirBase = useSettingsStore((s) => s.download.saveDirBase);
  const [segPlatform, setSegPlatform] = useState<Map<string, PlatformSource>>(
    new Map(),
  );
  useEffect(() => {
    let cancelled = false;
    if (!saveDirBase) {
      setSegPlatform(new Map());
      return () => {
        cancelled = true;
      };
    }
    getPlatformSegments(saveDirBase)
      .then((m) => {
        if (!cancelled) setSegPlatform(m);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [saveDirBase]);
  // 切换一级创作者文件夹时按平台重设默认排序（二级子文件夹不重置，保留用户当前选择）
  useEffect(() => {
    const platform = rootFolderName
      ? segPlatform.get(rootFolderName.toLowerCase())
      : undefined;
    setFileSort(platform === 'pawchive' ? 'doc-order' : 'name-desc');
  }, [rootFolderName, segPlatform]);

  // ---- WD14 视觉标签 ----
  const [visualMap, setVisualMap] = useState<Map<string, VisualRecord>>(
    new Map(),
  );
  const [visionPanelOpen, setVisionPanelOpen] = useState(false);
  const [visualSelected, setVisualSelected] = useState<string[]>([]);
  const [visualRule, setVisualRule] = useState<'or' | 'and'>('or');
  const [visualEditPath, setVisualEditPath] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const visionRunning = useLibraryVisionStore((s) => s.running);
  const visionProgress = useLibraryVisionStore((s) => s.progress);
  const visionVersion = useLibraryVisionStore((s) => s.version);

  const reloadVisual = useCallback(() => {
    readLibraryVisualTags()
      .then(setVisualMap)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    reloadVisual();
  }, [reloadVisual]);
  useEffect(() => {
    reloadVisual();
  }, [visionVersion, reloadVisual]);

  // 加载联网溯源缓存（下载历史改为按当前文件夹路径查库，见 load）
  useEffect(() => {
    let cancelled = false;
    readTraceMap()
      .then((trace) => {
        if (cancelled) return;
        setTraceMap(trace);
      })
      .catch((err) => log.error('加载溯源信息失败', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const data = await scanDirectory(dir);
      // 已切到别的目录（快速连点/返回）时丢弃过期结果
      if (seq !== loadSeq.current) return data;
      const paths = [
        ...data.folders.map((f) => f.path),
        ...data.files.map((f) => f.path),
        ...data.rootFiles.map((f) => f.path),
      ];
      const hm = await getHistoryByPaths(paths).catch(
        () => new Map<string, DownloadHistoryRecord>(),
      );
      if (seq !== loadSeq.current) return data;
      setHistoryMap(hm);
      const mtimes = await fetchMtimes(paths);
      if (seq !== loadSeq.current) return data;
      const folders = data.folders.map((folder, index) => ({
        ...folder,
        mtime: mtimes[index] ?? undefined,
      }));
      const files = data.files.map((file, index) => ({
        ...file,
        mtime: mtimes[data.folders.length + index] ?? undefined,
      }));
      const rootFiles = data.rootFiles.map((file, index) => ({
        ...file,
        mtime:
          mtimes[data.folders.length + data.files.length + index] ?? undefined,
      }));
      setContent({ folders, files, rootFiles });
      // 无子文件夹时只能是平铺；有子文件夹时保留用户当前选择
      if (data.folders.length === 0) {
        setViewMode('flat');
      }
      return data;
    } catch (err: unknown) {
      if (seq !== loadSeq.current) return;
      log.error(err);
      message.error(getErrorMessage(err) || '读取文件夹失败');
      setContent(null);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [dir, message]);

  // 切换目录时重置视图 + 清空旧内容（避免慢加载期间残留上一个目录的数据）
  useEffect(() => {
    setContent(null);
    setViewMode('folder');
    setSelectMode(false);
    setVisualSelected([]);
    setVisionPanelOpen(false);
  }, [dir]);

  useEffect(() => {
    load();
  }, [load]);

  const hasFolders = (content?.folders.length || 0) > 0;
  const sortedFolders = useMemo(
    () => sortFolders(content?.folders || [], folderSort),
    [content, folderSort],
  );
  const sortedFiles = useMemo(() => {
    const files = content?.files || [];
    if (fileSort !== 'doc-order' && fileSort !== 'doc-order-asc') {
      return sortFiles(files, fileSort);
    }
    const timeAsc = fileSort === 'doc-order-asc';
    // 按帖子顺序：文件夹连续优先 → 帖子发布时间 → 正文内序号（文件名前缀）
    const norm = (p: string) => normalizePath(p);
    const dirNorm = norm(dir);
    const groupKey = (path: string) => {
      const np = norm(path);
      const rel = np.startsWith(dirNorm + '\\')
        ? np.slice(dirNorm.length + 1)
        : np;
      const seg = rel.split('\\');
      seg.pop();
      return seg.join('\\');
    };
    const groupTime = new Map<string, number>();
    for (const f of files) {
      const g = groupKey(f.path);
      const rec = historyMap.get(norm(f.path));
      const t = rec?.tweetTime ? Date.parse(rec.tweetTime) : 0;
      groupTime.set(g, Math.max(groupTime.get(g) || 0, t));
    }
    const groups = [...new Set(files.map((f) => groupKey(f.path)))];
    groups.sort((a, b) => {
      const ta = groupTime.get(a) || 0;
      const tb = groupTime.get(b) || 0;
      // 有时间：按帖子时间排（默认新→旧，timeAsc 反转为旧→新）
      if (ta !== tb) return timeAsc ? ta - tb : tb - ta;
      // 无时间兜底：按组名排，同样跟随方向反转，保证两个选项结果一定不同
      const c = a.localeCompare(b, undefined, { numeric: true });
      return timeAsc ? c : -c;
    });
    const rank = new Map(groups.map((g, i) => [g, i]));
    const idxOf = (name: string) => {
      const m = name.match(/^(\d+)/);
      return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
    };
    return [...files].sort((a, b) => {
      const ga = rank.get(groupKey(a.path)) ?? 0;
      const gb = rank.get(groupKey(b.path)) ?? 0;
      if (ga !== gb) return ga - gb;
      const ia = idxOf(a.name);
      const ib = idxOf(b.name);
      if (ia !== ib) return ia - ib;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
  }, [content, fileSort, historyMap, dir]);
  const sortedRootFiles = useMemo(
    () => sortFiles(content?.rootFiles || [], fileSort),
    [content, fileSort],
  );

  // ---- 视觉标签：文件路径 → 命中标签集合 ----
  const visualFileTags = useMemo(() => {
    const fileTags = new Map<string, Set<string>>();
    const meta = new Map<string, { cat: string; zh: string }>();
    for (const [p, rec] of visualMap) {
      const set = new Set<string>();
      for (const it of effectiveItems(rec)) {
        const key = `${it.cat}|${it.zh}`;
        set.add(key);
        if (!meta.has(key)) meta.set(key, { cat: it.cat, zh: it.zh });
      }
      if (set.size) fileTags.set(p, set);
    }
    return { fileTags, meta };
  }, [visualMap]);

  const matchVisual = useCallback(
    (path: string) => {
      if (!visualSelected.length) return true;
      const set = visualFileTags.fileTags.get(path);
      if (!set) return false;
      return visualRule === 'and'
        ? visualSelected.every((k) => set.has(k))
        : visualSelected.some((k) => set.has(k));
    },
    [visualSelected, visualRule, visualFileTags],
  );

  const visibleFiles = useMemo(
    () => sortedFiles.filter((f) => matchVisual(f.path)),
    [sortedFiles, matchVisual],
  );
  const visibleRootFiles = useMemo(
    () => sortedRootFiles.filter((f) => matchVisual(f.path)),
    [sortedRootFiles, matchVisual],
  );

  // 分面计数：基于当前文件夹全部媒体（不含视觉筛选本身）
  const visualTagCounts = useMemo(() => {
    const counts = new Map<
      string,
      { cat: string; zh: string; count: number }
    >();
    for (const f of sortedFiles) {
      const set = visualFileTags.fileTags.get(f.path);
      if (!set) continue;
      for (const key of set) {
        const meta = visualFileTags.meta.get(key);
        if (!meta) continue;
        const c = counts.get(key) || { cat: meta.cat, zh: meta.zh, count: 0 };
        c.count += 1;
        counts.set(key, c);
      }
    }
    return counts;
  }, [sortedFiles, visualFileTags]);

  const visualTagGroups = useMemo(() => {
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
      const i = VISUAL_CAT_ORDER.indexOf(c);
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

  const handleVisualSaved = (rec: VisualRecord) =>
    setVisualMap((m) => {
      const n = new Map(m);
      n.set(rec.postId, rec);
      return n;
    });

  // 点侧栏标签 → 筛选当前目录（把该标签设为唯一筛选条件并展开筛选浮窗）
  const filterByVisualTag = (key: string) => {
    setVisualSelected([key]);
    setVisionPanelOpen(true);
  };

  // 当前文件夹所有图片（含子文件夹），用于批量识别
  const visionImages = useMemo(
    () =>
      (content?.files || [])
        .filter((f) => f.kind === 'image')
        .map((f) => f.path),
    [content],
  );

  const clearFolderVisual = () => {
    modal.confirm({
      title: '清除该文件夹的视觉标签？',
      content:
        '将清除当前文件夹（含子文件夹）所有图片的视觉识别结果，之后可重新「识别」打上最新词表。',
      okText: '清除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const n = await clearLibraryVisualTags([dir]);
        reloadVisual();
        message.success(
          n > 0 ? `已清除 ${n} 条视觉标签` : '该文件夹没有视觉标签',
        );
      },
    });
  };

  const startVision = () => {
    if (visionRunning) return;
    if (visionImages.length === 0) {
      message.info('当前文件夹没有图片');
      return;
    }
    modal.confirm({
      title: 'WD14 视觉识别',
      content: `将识别当前文件夹的 ${visionImages.length} 张图片（已识别的自动跳过）。识别在后台进行，可继续浏览其它文件夹。`,
      okText: '开始',
      cancelText: '取消',
      onOk: () => useLibraryVisionStore.getState().start(visionImages),
    });
  };

  const inFolderView = viewMode === 'folder' && hasFolders;
  // 分页：只渲染当前页（避免一次渲染上千张卡）
  const pagedFiles = useMemo(
    () =>
      visibleFiles.slice((page - 1) * FILE_PAGE_SIZE, page * FILE_PAGE_SIZE),
    [visibleFiles, page],
  );

  const filePaths = useMemo(() => pagedFiles.map((f) => f.path), [pagedFiles]);

  // 目录/排序/视觉筛选变化时回到第 1 页
  useEffect(() => {
    setPage(1);
  }, [dir, viewMode, fileSort, visualSelected]);

  const {
    selected,
    toggle,
    toggleAll,
    clear: clearSelection,
    selectedCount,
    allSelected,
  } = useSelection(filePaths);

  // 切换目录 / 视图 / 分页时清空选择
  useEffect(() => {
    clearSelection();
  }, [dir, viewMode, page, clearSelection]);

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    clearSelection();
  };

  const revealFolder = async (folder: LibrarySubFolder) => {
    try {
      await showInFolder(folder.path);
    } catch (err: unknown) {
      message.error(getErrorMessage(err) || '打开资源管理器失败');
    }
  };

  const batchDeleteFiles = () => {
    const targets = pagedFiles.filter((f) => selected.has(f.path));
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

  const editRecord = visualEditPath ? visualMap.get(visualEditPath) : undefined;
  const editLabel = visualEditPath
    ? visualEditPath.split(/[\\/]/).pop()
    : undefined;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center flex-wrap gap-3 pb-2">
        <span className="text-sm text-gray-500 shrink-0 whitespace-nowrap">
          {content ? `${content.files.length} 个媒体` : '加载中…'}
          {hasFolders && content
            ? ` · ${content.folders.length} 个子文件夹`
            : ''}
          {visualSelected.length > 0 ? ` · 命中 ${visibleFiles.length}` : ''}
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
        <Button
          icon={visionRunning ? <LoadingOutlined /> : <ThunderboltOutlined />}
          onClick={startVision}
          disabled={visionRunning || visionImages.length === 0}
          title={`WD14 识别当前文件夹的 ${visionImages.length} 张图片`}
        >
          识别
        </Button>
        <Button
          type={
            visionPanelOpen || visualSelected.length > 0 ? 'primary' : 'default'
          }
          icon={<SettingOutlined />}
          onClick={() => setVisionPanelOpen((v) => !v)}
          title="视觉标签筛选"
        >
          视觉筛选
          {visualSelected.length > 0 ? ` ${visualSelected.length}` : ''}
        </Button>
        <Button
          icon={<DeleteOutlined />}
          onClick={clearFolderVisual}
          title="清除当前文件夹（含子文件夹）的视觉标签"
        >
          清除标签
        </Button>
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

      <VisionFilterPanel
        open={visionPanelOpen}
        onClose={() => setVisionPanelOpen(false)}
        groups={visualTagGroups}
        selected={visualSelected}
        onToggle={toggleVisual}
        rule={visualRule}
        onRuleChange={setVisualRule}
        onClear={() => setVisualSelected([])}
        subtitle={`本文件夹 ${sortedFiles.filter((f) => visualMap.has(f.path)).length} 张`}
        emptyText="还没有识别结果，先点「识别」"
      />

      {selectMode && !inFolderView && (
        <div className="flex items-center gap-2 pb-3">
          <span className="text-sm text-gray-500">已选 {selectedCount} 个</span>
          <Button size="small" onClick={toggleAll}>
            {allSelected ? '取消全选' : '全选'}
          </Button>
          {visualSelected.length > 0 && (
            <Tag
              color="blue"
              className="!m-0"
              closable
              onClose={() => setVisualSelected([])}
            >
              视觉筛选 {visualSelected.length}
            </Tag>
          )}
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
          <>
            <ul
              className="grid grid-cols-[repeat(auto-fill,minmax(9rem,10rem))] gap-3"
              onContextMenu={(e) => e.preventDefault()}
            >
              {sortedFolders.map((folder) => {
                const menuItems: MenuProps['items'] = [
                  { key: 'open', label: '打开', icon: <FolderOpenOutlined /> },
                  { key: 'reveal', label: '在资源管理器中打开' },
                  { type: 'divider' },
                  { key: 'props', label: '属性', icon: <InfoCircleOutlined /> },
                ];
                const onMenuClick: MenuProps['onClick'] = ({
                  key,
                  domEvent,
                }) => {
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
                    <li className="lib-card-cv bg-white rounded-md border-[1px] border-gray-100 overflow-hidden group">
                      <button
                        className="block w-full text-left"
                        title={folder.name}
                        onClick={() => onOpenFolder(folder)}
                      >
                        <FolderCover
                          name={folder.name}
                          coverPath={folder.coverPath}
                          coverKind={folder.coverKind}
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
                    </li>
                  </Dropdown>
                );
              })}
            </ul>
            {visibleRootFiles.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 text-xs text-gray-400">
                  根目录媒体（{visibleRootFiles.length}）
                </div>
                <FileGrid
                  files={visibleRootFiles}
                  selectMode={false}
                  selected={selected}
                  onToggle={toggle}
                  onDeleted={() => load()}
                  coverFolderName={rootFolderName}
                  historyMap={historyMap}
                  traceMap={traceMap}
                  visualMap={visualMap}
                  onEditVisual={(path) => setVisualEditPath(path)}
                  onVisualSaved={handleVisualSaved}
                  onFilterTag={filterByVisualTag}
                />
              </div>
            )}
          </>
        ) : content && visibleFiles.length > 0 ? (
          <>
            <FileGrid
              files={pagedFiles}
              selectMode={selectMode}
              selected={selected}
              onToggle={toggle}
              onDeleted={() => load()}
              coverFolderName={rootFolderName}
              historyMap={historyMap}
              traceMap={traceMap}
              visualMap={visualMap}
              onEditVisual={(path) => setVisualEditPath(path)}
              onVisualSaved={handleVisualSaved}
              onFilterTag={filterByVisualTag}
            />
            {visibleFiles.length > FILE_PAGE_SIZE && (
              <div className="flex justify-center pt-4">
                <Pagination
                  current={page}
                  pageSize={FILE_PAGE_SIZE}
                  total={visibleFiles.length}
                  showSizeChanger={false}
                  showQuickJumper
                  onChange={setPage}
                />
              </div>
            )}
          </>
        ) : (
          <Empty
            className="mt-16"
            description={
              visualSelected.length > 0
                ? '没有命中视觉标签的文件'
                : '该文件夹下没有媒体文件'
            }
          />
        )}
      </div>

      <FolderProperties
        open={!!propsTarget}
        folderName={propsTarget?.name || ''}
        folderPath={propsTarget?.path}
        mediaCount={propsTarget?.mediaCount}
        onClose={() => setPropsTarget(null)}
      />

      {/* WD14 视觉识别进度（后台运行，切页不中断） */}
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
        fileLabel={editLabel}
        record={editRecord}
        onClose={() => setVisualEditPath(null)}
        onSaved={(rec) =>
          setVisualMap((m) => {
            const n = new Map(m);
            n.set(rec.postId, rec);
            return n;
          })
        }
      />
    </div>
  );
};
