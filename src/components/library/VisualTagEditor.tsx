import { Button, Input, Modal } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { setLibraryVisualOverride } from '../../services/library-visual';
import {
  effectiveItems,
  tagKey,
  VisualRecord,
} from '../../services/vision-core';
import {
  visionCatChipStyle,
  visionCatChipStyleDark,
} from '../../utils/tag-color';

const CATS = [
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

interface PanelProps {
  /** 文件绝对路径（作为索引键） */
  filePath?: string | null;
  record?: VisualRecord;
  onSaved: (rec: VisualRecord) => void;
  /** 深色背景（右侧推文条） */
  dark?: boolean;
  /** 紧凑模式（内嵌侧栏） */
  compact?: boolean;
  /** 点击标签 → 快捷跳转筛选（传 undefined 则标签不可点） */
  onFilterTag?: (key: string) => void;
}

/**
 * 视觉标签面板：显示模型识别结果（可按类别增删）。
 * 手动增删走 added/removed 覆盖层，重扫不会覆盖。用于弹窗与右侧推文条。
 */
export const VisualTagPanel: React.FC<PanelProps> = ({
  filePath,
  record,
  onSaved,
  dark,
  compact,
  onFilterTag,
}) => {
  const [addCat, setAddCat] = useState('服装');
  const [addText, setAddText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAddText('');
  }, [filePath]);

  const items = useMemo(() => (record ? effectiveItems(record) : []), [record]);

  const apply = async (
    add?: { cat: string; zh: string },
    removeKey?: string,
  ) => {
    if (!filePath) return;
    const added = [...(record?.added || [])];
    let removed = [...(record?.removed || [])];
    if (removeKey) {
      const ai = added.findIndex((a) => tagKey(a) === removeKey);
      if (ai >= 0) added.splice(ai, 1);
      if (!removed.includes(removeKey)) removed.push(removeKey);
    }
    if (add) {
      const key = tagKey(add);
      if (!added.some((a) => tagKey(a) === key))
        added.push({ ...add, raws: [] });
      removed = removed.filter((k) => k !== key);
    }
    setBusy(true);
    try {
      const rec = await setLibraryVisualOverride(filePath, added, removed);
      onSaved(rec);
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const v = addText.trim();
    if (!v) return;
    apply({ cat: addCat, zh: v });
    setAddText('');
  };

  const muted = 'text-gray-400';
  const chipStyle = dark ? visionCatChipStyleDark : visionCatChipStyle;

  return (
    <div>
      {!compact && (
        <div
          className={`mb-2 text-sm font-medium ${dark ? 'text-gray-200' : ''}`}
        >
          视觉标签（模型识别 · 可增删）
        </div>
      )}
      {items.length === 0 ? (
        <p className={`mb-2 text-xs ${muted}`}>
          暂无识别结果（可点「识别」，或下面手动添加）
        </p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {items.map((it) => {
            const key = `${it.cat}|${it.zh}`;
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                style={chipStyle(it.cat)}
              >
                {onFilterTag ? (
                  <button
                    type="button"
                    className="bg-transparent"
                    title="筛选此标签"
                    disabled={busy}
                    onClick={() => onFilterTag(key)}
                  >
                    <span className="opacity-60">{it.cat}</span> {it.zh}
                  </button>
                ) : (
                  <span>
                    <span className="opacity-60">{it.cat}</span> {it.zh}
                  </span>
                )}
                <button
                  type="button"
                  className={`ml-0.5 bg-transparent leading-none transition-opacity hover:opacity-100 ${
                    dark
                      ? 'text-white/75 hover:text-white'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                  title="删除该标签"
                  disabled={busy}
                  onClick={() => apply(undefined, key)}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div
        className={`flex items-center gap-2 ${compact ? '' : 'border-t pt-3'} ${
          dark ? 'border-white/10' : 'border-gray-100'
        }`}
      >
        <select
          value={addCat}
          onChange={(e) => setAddCat(e.target.value)}
          className={`h-6 shrink-0 rounded border px-1 text-xs ${
            dark
              ? 'border-white/20 bg-[#26282c] text-white'
              : 'border-gray-300 bg-white text-gray-700'
          }`}
        >
          {CATS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Input
          size="small"
          value={addText}
          placeholder="手动添加标签（中文）"
          onChange={(e) => setAddText(e.target.value)}
          onPressEnter={add}
        />
        <Button
          size="small"
          type={addText.trim() ? 'primary' : 'default'}
          onClick={add}
          disabled={!addText.trim() || busy}
        >
          添加
        </Button>
      </div>
    </div>
  );
};

interface Props {
  open: boolean;
  filePath?: string | null;
  fileLabel?: string;
  record?: VisualRecord;
  onClose: () => void;
  onSaved: (rec: VisualRecord) => void;
}

/** 弹窗形态（网格卡片右键「编辑视觉标签」用） */
export const VisualTagEditor: React.FC<Props> = ({
  open,
  filePath,
  fileLabel,
  record,
  onClose,
  onSaved,
}) => {
  return (
    <Modal
      open={open}
      title="视觉标签"
      footer={null}
      onCancel={onClose}
      destroyOnClose
      width={520}
    >
      {fileLabel && (
        <p className="mb-2 truncate text-xs text-gray-400" title={fileLabel}>
          {fileLabel}
        </p>
      )}
      <VisualTagPanel
        filePath={filePath}
        record={record}
        onSaved={onSaved}
        compact
      />
    </Modal>
  );
};
