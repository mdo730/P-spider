import { getErrorMessage } from '../../utils/error';
import { App, Button, Input, Modal, Radio, Space, TreeSelect } from 'antd';
import { dialog } from '@tauri-apps/api';
import React, { useEffect, useMemo, useState } from 'react';
import {
  LauncherEntry,
  LauncherTag,
  useLauncherStore,
} from '../../stores/launcher';
import { LauncherEntryIcon } from './LauncherEntryIcon';

interface TreeNode {
  title: string;
  value: string;
  key: string;
  children?: TreeNode[];
}

function buildTree(tags: LauncherTag[], parentId: string | null): TreeNode[] {
  return tags
    .filter((t) => t.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .map((tag) => {
      const children = buildTree(tags, tag.id);
      return {
        title: tag.name,
        value: tag.id,
        key: tag.id,
        ...(children.length > 0 ? { children } : {}),
      };
    });
}

interface Props {
  open: boolean;
  entry: LauncherEntry | null;
  tags: LauncherTag[];
  onClose: () => void;
}

/** 编辑启动器条目：名称 / 图标 / 标签 */
export const EntryEditModal: React.FC<Props> = ({
  open,
  entry,
  tags,
  onClose,
}) => {
  const { message } = App.useApp();
  const updateEntry = useLauncherStore((s) => s.updateEntry);
  const setEntryTags = useLauncherStore((s) => s.setEntryTags);

  const [name, setName] = useState('');
  const [iconMode, setIconMode] = useState<'auto' | 'custom'>('auto');
  const [customIcon, setCustomIcon] = useState<string>('');
  const [tagIds, setTagIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !entry) return;
    setName(entry.name);
    setIconMode(entry.iconMode);
    setCustomIcon(entry.customIcon || '');
    setTagIds(entry.tagIds);
  }, [open, entry]);

  const treeData = useMemo(() => buildTree(tags, null), [tags]);

  const pickIcon = async () => {
    try {
      const file = await dialog.open({
        multiple: false,
        title: '选择图标图片',
        filters: [
          {
            name: '图片',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico'],
          },
        ],
      });
      if (typeof file === 'string') {
        setCustomIcon(file);
        setIconMode('custom');
      }
    } catch (err: unknown) {
      message.error(getErrorMessage(err) || '选择图片失败');
    }
  };

  const save = () => {
    if (!entry) return;
    const trimmed = name.trim();
    if (!trimmed) {
      message.error('名称不能为空');
      return;
    }
    updateEntry(entry.id, {
      name: trimmed,
      iconMode,
      customIcon: iconMode === 'custom' ? customIcon : undefined,
    });
    setEntryTags(entry.id, tagIds);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="编辑启动项"
      okText="保存"
      cancelText="取消"
      onOk={save}
      onCancel={onClose}
      destroyOnClose
    >
      {entry && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-sm text-gray-500">名称</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="显示名称"
              onPressEnter={save}
            />
          </div>
          <div className="flex items-start gap-2">
            <span className="w-14 shrink-0 pt-2 text-sm text-gray-500">
              路径
            </span>
            <span
              className="min-w-0 flex-1 break-all rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-500"
              title={entry.path}
            >
              {entry.path}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-14 shrink-0 pt-2 text-sm text-gray-500">
              图标
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-3">
                <LauncherEntryIcon
                  entry={{
                    path: entry.path,
                    kind: entry.kind,
                    iconMode,
                    customIcon,
                  }}
                  size={56}
                  className="rounded border border-gray-100 bg-white"
                />
                <Radio.Group
                  value={iconMode}
                  onChange={(e) => setIconMode(e.target.value)}
                >
                  <Space direction="vertical" size={2}>
                    <Radio value="auto">使用系统图标</Radio>
                    <Radio value="custom">使用自定义图片</Radio>
                  </Space>
                </Radio.Group>
                <Button size="small" onClick={pickIcon}>
                  选择图片…
                </Button>
              </div>
              {iconMode === 'custom' && customIcon && (
                <div
                  className="truncate text-xs text-gray-400"
                  title={customIcon}
                >
                  {customIcon}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-14 shrink-0 pt-1 text-sm text-gray-500">
              标签
            </span>
            <TreeSelect
              multiple
              allowClear
              treeDefaultExpandAll
              showSearch
              treeNodeFilterProp="title"
              style={{ width: '100%' }}
              placeholder="选择标签（可多选）"
              value={tagIds}
              onChange={(value) => setTagIds(value as string[])}
              treeData={treeData}
            />
          </div>
        </div>
      )}
    </Modal>
  );
};
