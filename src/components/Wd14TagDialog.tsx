/* eslint-disable react/prop-types */
import { App, Button, Checkbox, Modal, Spin } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import React, { useEffect, useMemo, useState } from 'react';
import { groupPromptTags, PromptTag, tagImageSource } from '../services/wd14';
import { useWd14PromptStore } from '../stores/wd14-prompt';
import { copyTextToClipboard } from '../utils/clipboard';

/**
 * WD14 提示词反推弹窗：对右键的图片跑 WD14，按类别展示原始标签（中英对照），
 * 勾选后一键复制英文关键词到剪贴板。挂在 App 全局，图片右键菜单触发。
 */
export const Wd14TagDialog: React.FC = () => {
  const { message } = App.useApp();
  const open = useWd14PromptStore((s) => s.open);
  const source = useWd14PromptStore((s) => s.source);
  const close = useWd14PromptStore((s) => s.close);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !source) return;
    setLoading(true);
    setError('');
    setTags([]);
    setSelected(new Set());
    tagImageSource(source)
      .then((t) => setTags(t))
      .catch((err: any) => setError(err?.message || String(err)))
      .finally(() => setLoading(false));
  }, [open, source]);

  const groups = useMemo(() => groupPromptTags(tags), [tags]);

  const toggleTag = (en: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(en)) n.delete(en);
      else n.add(en);
      return n;
    });

  const toggleGroup = (list: PromptTag[]) => {
    const allOn = list.every((t) => selected.has(t.en));
    setSelected((prev) => {
      const n = new Set(prev);
      for (const t of list) {
        if (allOn) n.delete(t.en);
        else n.add(t.en);
      }
      return n;
    });
  };

  const orderIndex = useMemo(() => {
    const m = new Map<string, number>();
    tags.forEach((t, i) => m.set(t, i));
    return m;
  }, [tags]);

  const onCopy = async () => {
    if (selected.size === 0) {
      message.info('请先勾选要复制的标签');
      return;
    }
    // 按 WD14 置信度排序（原顺序即重要性，越前越重要）
    const list = [...selected].sort(
      (a, b) => (orderIndex.get(a) ?? 1e9) - (orderIndex.get(b) ?? 1e9),
    );
    await copyTextToClipboard(list.join(', '));
    message.success(`已复制 ${list.length} 个关键词（英文，按重要性排序）`);
    close();
  };

  const allSelected = tags.length > 0 && selected.size === tags.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(tags));
  };

  return (
    <Modal
      title="WD14 识别标签"
      open={open}
      onCancel={close}
      width={680}
      footer={null}
    >
      {loading ? (
        <div className="flex justify-center py-16">
          <Spin size="large" />
        </div>
      ) : error ? (
        <div className="py-8 text-sm text-red-500">{error}</div>
      ) : tags.length === 0 ? (
        <div className="py-8 text-sm text-gray-400">未识别到标签</div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {groups.map((g) => {
            const allOn = g.tags.every((t) => selected.has(t.en));
            return (
              <div
                key={g.cat}
                className="mb-3 rounded-lg border border-gray-100 p-2"
              >
                <div
                  className="mb-1.5 flex cursor-pointer select-none items-center gap-2"
                  onClick={() => toggleGroup(g.tags)}
                >
                  <span className="text-sm font-medium">{g.cat}</span>
                  <span className="text-xs text-gray-400">{g.tags.length}</span>
                  <Checkbox
                    className="ml-auto"
                    checked={allOn}
                    indeterminate={
                      !allOn && g.tags.some((t) => selected.has(t.en))
                    }
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleGroup(g.tags)}
                  >
                    全选
                  </Checkbox>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.tags.map((t) => {
                    const on = selected.has(t.en);
                    return (
                      <button
                        key={t.en}
                        type="button"
                        onClick={() => toggleTag(t.en)}
                        className={
                          'rounded-full border px-2 py-0.5 text-xs leading-5 transition-colors ' +
                          (on
                            ? 'border-sky-500 bg-sky-500 text-white'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-sky-400')
                        }
                        title={t.en}
                      >
                        {t.zh ? `${t.zh} ` : ''}
                        <span className={on ? 'text-sky-100' : 'text-gray-400'}>
                          {t.en}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex items-center gap-3 border-t-[1px] border-gray-100 pt-3">
        <span className="text-xs text-gray-400">已选 {selected.size} 个</span>
        <Button
          className="ml-auto"
          onClick={toggleAll}
          disabled={tags.length === 0}
        >
          {allSelected ? '取消全选' : '全选'}
        </Button>
        <Button
          type="primary"
          icon={<CopyOutlined />}
          onClick={onCopy}
          disabled={selected.size === 0}
        >
          复制英文关键词
        </Button>
      </div>
    </Modal>
  );
};
