/* eslint-disable react/prop-types */
import { Descriptions, Modal, Spin, Tag } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { useFigmemoTagsStore } from '../../stores/figmemo-tags';
import {
  LibraryFolderStats,
  buildTagIndex,
  fetchFolderStats,
  formatBytes,
  terminalTagIds,
  tagChainLabel,
} from '../../utils/library';

interface Props {
  open: boolean;
  folderName: string;
  /** 文件夹相对 saveDirBase 的路径（用于标签） */
  relPath?: string;
  /** 文件夹绝对路径（用于统计） */
  folderPath?: string;
  /** 已扫描到的媒体数（免二次统计） */
  mediaCount?: number;
  onClose: () => void;
}

/** 文件夹属性：文件数 / 占用空间 / 标签（末端标签展开祖先链） */
export const FolderProperties: React.FC<Props> = ({
  open,
  folderName,
  relPath,
  folderPath,
  mediaCount,
  onClose,
}) => {
  const tags = useFigmemoTagsStore((s) => s.tags);
  const [stats, setStats] = useState<LibraryFolderStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !folderPath) {
      setStats(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const result = await fetchFolderStats(folderPath);
        if (!cancelled) setStats(result);
      } catch (err) {
        log.warn('读取文件夹统计失败', err);
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, folderPath]);

  const labelTags = useMemo(() => {
    if (!relPath) return [];
    const index = buildTagIndex(tags);
    const ids = useFigmemoTagsStore.getState().getFolderTagIds(relPath);
    return terminalTagIds(index, ids).map((id) => ({
      id,
      label: tagChainLabel(index, id),
    }));
  }, [relPath, tags]);

  return (
    <Modal
      open={open}
      title="属性"
      footer={null}
      onCancel={onClose}
      width={520}
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Spin />
        </div>
      ) : (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="名称">{folderName}</Descriptions.Item>
          {relPath != null && (
            <Descriptions.Item label="标签">
              {labelTags.length > 0 ? (
                labelTags.map((t) => (
                  <Tag key={t.id} color="blue">
                    {t.label}
                  </Tag>
                ))
              ) : (
                <span className="text-gray-400">未打标签</span>
              )}
            </Descriptions.Item>
          )}
          {mediaCount != null && (
            <Descriptions.Item label="媒体文件">
              {mediaCount} 个
            </Descriptions.Item>
          )}
          <Descriptions.Item label="全部文件">
            {stats ? `${stats.fileCount} 个` : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="占用空间">
            {stats ? formatBytes(stats.totalBytes) : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="路径">
            <span className="break-all text-xs">{folderPath}</span>
          </Descriptions.Item>
        </Descriptions>
      )}
    </Modal>
  );
};
