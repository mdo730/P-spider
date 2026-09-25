/* eslint-disable react/prop-types */
import {
  DeleteOutlined,
  FileOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PictureOutlined,
  PlayCircleFilled,
} from '@ant-design/icons';
import { App, Checkbox, Dropdown, MenuProps, Modal } from 'antd';
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
import { toAssetUrl } from '../../utils/asset';
import { handleImageMenuKey, imageMenuItems } from '../../utils/image-menu';
import { openPath, openUrl, showInFolder } from '../../utils/shell';
import { ImageViewer } from './ImageViewer';
import { LocalThumb } from './LocalThumb';
import { TweetSidebar } from './TweetSidebar';

const EMPTY_HISTORY_MAP = new Map<string, DownloadHistoryRecord>();
const EMPTY_TRACE_MAP = new Map<string, TracedRecord>();

/** 右键菜单能用到的最小文件信息 */
interface FileRef {
  path: string;
  name: string;
  kind?: 'image' | 'video';
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
    const isVideo = file.kind === 'video';
    return {
      items: [
        ...(!isVideo
          ? imageMenuItems({ localPath: file.path, postUrl })
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
        ...(coverFolderName && !isVideo
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
            { localPath: file.path, postUrl },
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
                ) : (
                  <>
                    <video
                      src={toAssetUrl(file.path)}
                      preload="metadata"
                      muted
                      className="w-full h-full object-cover bg-gray-900"
                    />
                    <PlayCircleFilled className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl text-white/90" />
                  </>
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

      <Modal
        open={!!videoFile}
        footer={null}
        width="92%"
        centered
        wrapClassName="library-video-wrap"
        styles={{ body: { padding: 0, background: '#0f1114' } }}
        destroyOnClose
        onCancel={() => setVideoFile(null)}
      >
        {videoFile && (
          <video
            src={toAssetUrl(videoFile.path)}
            controls
            autoPlay
            className="w-full max-h-[80vh] bg-black"
          />
        )}
      </Modal>
    </>
  );
};
