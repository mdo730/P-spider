/* eslint-disable react/prop-types */
import {
  DeleteOutlined,
  FileOutlined,
  FileZipOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PictureOutlined,
  PlayCircleFilled,
} from '@ant-design/icons';
import { App, Checkbox, Dropdown, MenuProps } from 'antd';
import React, { useState } from 'react';
import { deleteLibraryFiles } from '../../services/library-actions';
import {
  DownloadHistoryRecord,
  FileTweetInfo,
} from '../../stores/download-history';
import { useLibraryStore } from '../../stores/library';
import { useSettingsStore } from '../../stores/settings';
import {
  LibraryFile,
  TracedRecord,
  resolveFileTweetInfo,
} from '../../utils/library';
import { handleImageMenuKey, imageMenuItems } from '../../utils/image-menu';
import {
  extractArchive,
  openPath,
  openUrl,
  showInFolder,
} from '../../utils/shell';
import { ImageViewer } from './ImageViewer';
import { LocalThumb } from './LocalThumb';
import { TweetSidebar } from './TweetSidebar';
import { VideoViewer } from './VideoViewer';

const EMPTY_HISTORY_MAP = new Map<string, DownloadHistoryRecord>();
const EMPTY_TRACE_MAP = new Map<string, TracedRecord>();

/** 右键菜单能用到的最小文件信息 */
interface FileRef {
  path: string;
  name: string;
  kind?: 'image' | 'video' | 'archive';
}

interface Props {
  files: LibraryFile[];
  selectMode: boolean;
  selected: Set<string>;
  onToggle: (path: string) => void;
  /** 文件删除后回调（父级重新扫描） */
  onDeleted?: () => void;
  /** 一级文件夹名：提供时，图片可「设为文件夹缩略图」 */
  coverFolderName?: string;
  /** 下载历史「文件路径 → 记录」索引，用于关联原推文 */
  historyMap?: Map<string, DownloadHistoryRecord>;
  /** 联网溯源缓存（文件路径 → 记录） */
  traceMap?: Map<string, TracedRecord>;
}

/**
 * 本地文件网格：图片点击打开自研查看器（ImageViewer），视频弹窗播放；
 * 查看媒体时右侧叠加一条独立的推文信息条（TweetSidebar）。
 */
export const FileGrid: React.FC<Props> = ({
  files,
  selectMode,
  selected,
  onToggle,
  onDeleted,
  coverFolderName,
  historyMap,
  traceMap,
}) => {
  const { message, modal } = App.useApp();
  const setFolderCover = useLibraryStore((s) => s.setFolderCover);
  const fileNameTemplate = useSettingsStore((s) => s.download.fileNameTemplate);
  const [videoFile, setVideoFile] = useState<LibraryFile | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const imageFiles = files.filter((file) => file.kind === 'image');
  const imageIndexMap = new Map(imageFiles.map((file, i) => [file.path, i]));

  const getInfo = (file?: FileRef): FileTweetInfo | undefined =>
    file
      ? resolveFileTweetInfo(
          file.path,
          file.name,
          historyMap || EMPTY_HISTORY_MAP,
          traceMap || EMPTY_TRACE_MAP,
          fileNameTemplate,
          coverFolderName,
        )
      : undefined;

  const getPostUrl = (file?: FileRef) => getInfo(file)?.url;

  // 右侧信息条对应的当前文件（视频优先，其次查看器里的当前图片）
  const sidebarFile = videoFile
    ? videoFile
    : viewerOpen
      ? imageFiles[viewerIndex]
      : undefined;

  // 视频弹窗里左右切换：在「全部媒体」里前后移动；遇到图片则切到图片查看器
  const videoIndex = videoFile
    ? files.findIndex((f) => f.path === videoFile.path)
    : -1;
  const goMedia = (dir: -1 | 1) => {
    if (videoIndex < 0) return;
    const i = videoIndex + dir;
    if (i < 0 || i >= files.length) return;
    const target = files[i];
    if (target.kind === 'video') {
      setVideoFile(target);
    } else {
      const ii = imageIndexMap.get(target.path);
      if (ii != null) {
        setVideoFile(null);
        setViewerIndex(ii);
        setSidebarCollapsed(false);
        setViewerOpen(true);
      }
    }
  };

  // 图片查看器里左右切换：在「全部媒体」里前后移动；遇到视频则切到视频弹窗
  const viewerFilePath = viewerOpen ? imageFiles[viewerIndex]?.path : undefined;
  const navigateMedia = (dir: 1 | -1) => {
    if (!viewerFilePath) return;
    const i = files.findIndex((f) => f.path === viewerFilePath);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= files.length) return;
    const target = files[j];
    if (target.kind === 'image') {
      const ii = imageIndexMap.get(target.path);
      if (ii != null) setViewerIndex(ii);
    } else {
      setViewerOpen(false);
      setSidebarCollapsed(false);
      setVideoFile(target);
    }
  };

  const reveal = async (file: FileRef) => {
    try {
      await showInFolder(file.path, true);
    } catch (err: any) {
      message.error(err?.message || '打开资源管理器失败');
    }
  };

  const openWithSystem = async (file: FileRef) => {
    try {
      await openPath(file.path);
    } catch (err: any) {
      message.error(err?.message || '打开文件失败');
    }
  };

  // 解压压缩包（优先本机 Bandizip；未装则回退默认程序打开）
  const extractFile = async (file: FileRef, toHere: boolean) => {
    const sep = Math.max(
      file.path.lastIndexOf('\\'),
      file.path.lastIndexOf('/'),
    );
    const dir = file.path.slice(0, sep);
    const base = file.name.replace(/\.[^.]+$/, '');
    const outDir = toHere ? dir : `${dir}\\${base}`;
    const hide = message.loading('正在解压…', 0);
    try {
      const result = await extractArchive(file.path, outDir);
      hide();
      if (result === 'extracted') {
        message.success(toHere ? '已解压到当前文件夹' : '已解压到同名文件夹');
        onDeleted?.();
      } else {
        message.info('未检测到 Bandizip，已用默认压缩软件打开');
      }
    } catch (err: any) {
      hide();
      message.error(err?.message || '解压失败');
    }
  };

  const confirmDelete = (file: FileRef) => {
    modal.confirm({
      title: '删除文件？',
      content: `将永久删除「${file.name}」，删除后不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await deleteLibraryFiles([file.path]);
        if (result.failed > 0) {
          message.error('删除失败');
          throw new Error('delete failed');
        }
        message.success('已删除');
        onDeleted?.();
      },
    });
  };

  // 统一右键菜单（网格卡片与查看器共用）
  const menuFor = (file: FileRef): MenuProps => {
    const postUrl = getPostUrl(file);
    const fileInfo = getInfo(file);
    // 作者：优先推文信息里的用户名，否则用一级文件夹名（本地库通常以作者命名）
    const author = fileInfo?.username
      ? `@${fileInfo.username}`
      : coverFolderName || undefined;
    const isVideo = file.kind === 'video';
    const isArchive = file.kind === 'archive';

    if (isArchive) {
      return {
        items: [
          {
            key: 'extractHere',
            label: '解压到当前文件夹',
            icon: <FolderOpenOutlined />,
          },
          {
            key: 'extractSub',
            label: '解压到「同名」文件夹',
            icon: <FileZipOutlined />,
          },
          { key: 'open', label: '用压缩软件打开', icon: <FileOutlined /> },
          { type: 'divider' },
          {
            key: 'reveal',
            label: '在资源管理器中打开',
            icon: <FolderOpenOutlined />,
          },
          { type: 'divider' },
          {
            key: 'delete',
            label: '删除文件',
            icon: <DeleteOutlined />,
            danger: true,
          },
        ],
        onClick: async ({ key, domEvent }) => {
          domEvent.stopPropagation();
          if (key === 'extractHere') return extractFile(file, true);
          if (key === 'extractSub') return extractFile(file, false);
          if (key === 'open') return openWithSystem(file);
          if (key === 'reveal') return reveal(file);
          if (key === 'delete') return confirmDelete(file);
        },
      };
    }

    return {
      items: [
        ...(!isVideo
          ? imageMenuItems({ localPath: file.path, postUrl, author })
          : [
              {
                key: 'reveal',
                label: '在资源管理器中打开',
                icon: <FolderOpenOutlined />,
              },
              ...(postUrl
                ? [
                    {
                      key: 'openPost',
                      label: '打开原网页',
                      icon: <LinkOutlined />,
                    },
                  ]
                : []),
            ]),
        { type: 'divider' },
        { key: 'open', label: '打开', icon: <FileOutlined /> },
        ...(coverFolderName
          ? [
              {
                key: 'setCover',
                label: '设为文件夹缩略图',
                icon: <PictureOutlined />,
              },
            ]
          : []),
        { type: 'divider' },
        {
          key: 'delete',
          label: '删除文件',
          icon: <DeleteOutlined />,
          danger: true,
        },
      ],
      onClick: async ({ key, domEvent }) => {
        domEvent.stopPropagation();
        if (
          !isVideo &&
          (await handleImageMenuKey(
            key,
            { localPath: file.path, postUrl, author },
            message,
          ))
        ) {
          return;
        }
        if (key === 'open') return openWithSystem(file);
        if (key === 'reveal') return reveal(file);
        if (key === 'openPost' && postUrl) {
          openUrl(postUrl);
          return;
        }
        if (key === 'setCover' && coverFolderName) {
          setFolderCover(coverFolderName, file.path);
          message.success('已设为文件夹缩略图');
          return;
        }
        if (key === 'delete') return confirmDelete(file);
      },
    };
  };

  return (
    <>
      <ul
        className="grid grid-cols-[repeat(auto-fill,minmax(8rem,9rem))] gap-2"
        onContextMenu={(e) => e.preventDefault()}
      >
        {files.map((file) => {
          const isSelected = selected.has(file.path);
          return (
            <Dropdown
              key={file.path}
              trigger={['contextMenu']}
              menu={menuFor(file)}
            >
              <li
                className={`lib-card-cv relative aspect-square bg-white rounded-md overflow-hidden group border-[1px] cursor-pointer ${
                  selectMode && isSelected
                    ? 'border-ant-color-primary ring-1 ring-ant-color-primary'
                    : 'border-gray-100'
                }`}
                onClick={
                  selectMode
                    ? () => onToggle(file.path)
                    : file.kind === 'video'
                      ? () => {
                          setSidebarCollapsed(false);
                          setVideoFile(file);
                        }
                      : file.kind === 'archive'
                        ? () => openWithSystem(file)
                        : () => {
                            const i = imageIndexMap.get(file.path);
                            if (i != null) setViewerIndex(i);
                            setSidebarCollapsed(false);
                            setViewerOpen(true);
                          }
                }
                title={file.name}
              >
                {file.kind === 'image' ? (
                  <LocalThumb
                    filePath={file.path}
                    alt={file.name}
                    wrapperClassName="w-full h-full"
                    className="object-cover w-full h-full"
                  />
                ) : file.kind === 'archive' ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gray-50">
                    <FileZipOutlined className="text-4xl text-gray-400" />
                    <span className="line-clamp-2 px-2 text-center text-[11px] text-gray-500">
                      {file.name}
                    </span>
                  </div>
                ) : (
                  <div className="relative w-full h-full bg-gray-900">
                    <LocalThumb
                      kind="video"
                      filePath={file.path}
                      alt={file.name}
                      wrapperClassName="w-full h-full"
                      className="object-cover w-full h-full"
                    />
                    <PlayCircleFilled className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl text-white/90" />
                  </div>
                )}
                {selectMode && (
                  <span className="absolute left-1 top-1">
                    <Checkbox
                      checked={isSelected}
                      className="pointer-events-none"
                    />
                  </span>
                )}
              </li>
            </Dropdown>
          );
        })}
      </ul>

      {viewerOpen && imageFiles.length > 0 && (
        <ImageViewer
          images={imageFiles.map((file) => ({
            path: file.path,
            name: file.name,
          }))}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerOpen(false)}
          rightInset={sidebarCollapsed ? 0 : 320}
          menuFor={menuFor}
          onNavigate={navigateMedia}
          navigationEnabled={files.length > 1}
        />
      )}

      {(viewerOpen || !!videoFile) && (
        <TweetSidebar
          info={getInfo(sidebarFile)}
          fileName={sidebarFile?.name}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          onClose={() => {
            setViewerOpen(false);
            setVideoFile(null);
          }}
        />
      )}

      {videoFile && (
        <VideoViewer
          path={videoFile.path}
          index={videoIndex}
          total={files.length}
          rightInset={sidebarCollapsed ? 0 : 320}
          onPrev={() => goMedia(-1)}
          onNext={() => goMedia(1)}
          onClose={() => setVideoFile(null)}
        />
      )}
    </>
  );
};
