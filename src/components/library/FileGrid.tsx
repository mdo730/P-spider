/* eslint-disable react/prop-types */
import {
  DeleteOutlined,
  FileOutlined,
  FolderOpenOutlined,
  PlayCircleFilled,
} from '@ant-design/icons';
import { App, Checkbox, Dropdown, Image, MenuProps, Modal } from 'antd';
import React, { useState } from 'react';
import { deleteLibraryFiles } from '../../services/library-actions';
import { LibraryFile } from '../../utils/library';
import { toAssetUrl } from '../../utils/asset';
import { openPath, showInFolder } from '../../utils/shell';
import { LocalThumb } from './LocalThumb';

interface Props {
  files: LibraryFile[];
  selectMode: boolean;
  selected: Set<string>;
  onToggle: (path: string) => void;
  /** 删除文件后回调（父级重新扫描） */
  onDeleted?: () => void;
}

/** 本地文件网格：左键预览/播放，右键菜单；多选模式下点击=勾选 */
export const FileGrid: React.FC<Props> = ({
  files,
  selectMode,
  selected,
  onToggle,
  onDeleted,
}) => {
  const { message, modal } = App.useApp();
  const [videoFile, setVideoFile] = useState<LibraryFile | null>(null);

  const reveal = async (file: LibraryFile) => {
    try {
      await showInFolder(file.path, true);
    } catch (err: any) {
      message.error(err?.message || '打开资源管理器失败');
    }
  };

  const openWithSystem = async (file: LibraryFile) => {
    try {
      await openPath(file.path);
    } catch (err: any) {
      message.error(err?.message || '打开文件失败');
    }
  };

  const confirmDelete = (file: LibraryFile) => {
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

  return (
    <>
      <Image.PreviewGroup>
        <ul
          className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2"
          onContextMenu={(e) => e.preventDefault()}
        >
          {files.map((file) => {
            const isSelected = selected.has(file.path);
            const menuItems: MenuProps['items'] = [
              { key: 'open', label: '打开', icon: <FileOutlined /> },
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
            ];
            const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
              domEvent.stopPropagation();
              if (key === 'open') return openWithSystem(file);
              if (key === 'reveal') return reveal(file);
              if (key === 'delete') return confirmDelete(file);
            };

            return (
              <Dropdown
                key={file.path}
                trigger={['contextMenu']}
                menu={{ items: menuItems, onClick: onMenuClick }}
              >
                <li
                  className={`relative aspect-square bg-white rounded-md overflow-hidden group border-[1px] ${
                    selectMode && isSelected
                      ? 'border-ant-color-primary ring-1 ring-ant-color-primary'
                      : 'border-gray-100'
                  }`}
                  onClick={selectMode ? () => onToggle(file.path) : undefined}
                >
                  {file.kind === 'image' ? (
                    <LocalThumb
                      filePath={file.path}
                      alt={file.name}
                      preview={!selectMode}
                      wrapperClassName="w-full h-full"
                      className="object-cover w-full h-full"
                    />
                  ) : (
                    <button
                      className="relative block w-full h-full bg-gray-900"
                      onClick={
                        selectMode
                          ? (e) => {
                              e.stopPropagation();
                              onToggle(file.path);
                            }
                          : () => setVideoFile(file)
                      }
                      title={file.name}
                    >
                      <video
                        src={toAssetUrl(file.path)}
                        preload="metadata"
                        muted
                        className="w-full h-full object-cover"
                      />
                      <PlayCircleFilled className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl text-white/90" />
                    </button>
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
      </Image.PreviewGroup>

      <Modal
        open={!!videoFile}
        title={videoFile?.name}
        footer={null}
        width={800}
        destroyOnClose
        onCancel={() => setVideoFile(null)}
      >
        {videoFile && (
          <video
            src={toAssetUrl(videoFile.path)}
            controls
            autoPlay
            className="w-full max-h-[70vh]"
          />
        )}
      </Modal>
    </>
  );
};
