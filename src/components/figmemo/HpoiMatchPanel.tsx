/* eslint-disable react/prop-types */
import { Button, Input, Spin, Tag, App } from 'antd';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FigmemoListItem } from '../../services/figmemo';
import {
  HpoiCandidate,
  HpoiMatch,
  candidateToMatch,
  fetchHpoiItemById,
  findHpoiCandidates,
  hpoiCoverUrl,
  hpoiDetailUrl,
  parseFigmemoFields,
  parseHpoiId,
} from '../../services/hpoi';
import { useRemoteImageSrc } from '../../hooks/useRemoteImage';

const HPOI_IMG_OPTS = {
  bypassProxy: true,
  headers: { Referer: 'https://www.hpoi.net/' },
};

const HpoiThumb: React.FC<{ cover?: string; className?: string }> = ({
  cover,
  className,
}) => {
  const src = useRemoteImageSrc(hpoiCoverUrl(cover), HPOI_IMG_OPTS);
  if (!src) {
    return <div className={`${className || ''} bg-gray-100 rounded`} />;
  }
  return (
    <img
      src={src}
      alt=""
      className={`${className || ''} object-cover rounded`}
    />
  );
};

/** 详情页右上角悬浮：hpoi 候选 top-3，点一下关联；已关联则显示快照 */
export const HpoiMatchPanel: React.FC<{
  item: FigmemoListItem;
  contentHtml?: string;
  onConfirm: (match: HpoiMatch) => void;
  onClear: () => void;
}> = ({ item, contentHtml, onConfirm, onClear }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [cands, setCands] = useState<HpoiCandidate[]>([]);
  const [err, setErr] = useState<string | undefined>();
  const [open, setOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualVal, setManualVal] = useState('');
  const htmlRef = useRef(contentHtml);
  htmlRef.current = contentHtml;
  // 已展示过的候选 id（「重新查询」时排除，取下一批）
  const excludeRef = useRef<number[]>([]);
  // 自动匹配开关：每篇仅在「初始批次」自动关联第一条；「重新查询/重新检索」后不再自动
  const autoRef = useRef(false);
  const lastPostRef = useRef('');

  const confirmId = useCallback(
    async (itemId: number, fallback?: HpoiCandidate) => {
      setSaving(true);
      try {
        const match = await fetchHpoiItemById(itemId);
        onConfirm(match);
        message.success(`已关联 hpoi：${match.nameCN}`);
      } catch (e: any) {
        if (fallback) {
          onConfirm(candidateToMatch(fallback));
          message.success(`已关联 hpoi：${fallback.nameCN}`);
        } else {
          message.error(e?.message || '解析 hpoi 词条失败');
        }
      } finally {
        setSaving(false);
      }
    },
    [onConfirm, message],
  );

  const load = useCallback(
    (exclude: number[] = excludeRef.current) => {
      setErr(undefined);
      setCands([]);
      setLoading(true);
      const info = parseFigmemoFields(item.title, htmlRef.current);
      findHpoiCandidates(info, 2, 1, exclude)
        .then(setCands)
        .catch((e: any) => setErr(e?.message || '查询失败'))
        .finally(() => setLoading(false));
    },
    [item.title],
  );

  useEffect(() => {
    // 换文章：重置游标与自动标记
    if (lastPostRef.current !== item.postId) {
      lastPostRef.current = item.postId;
      excludeRef.current = [];
      autoRef.current = false;
    }
    if (item.hpoi) {
      setCands([]);
      setErr(undefined);
      setLoading(false);
      return;
    }
    load([]);
  }, [item.postId, item.hpoi, load]);

  // 默认自动关联第一条（仅初始批次、且文章还没关联时），少点一下；错了再「重新检索」
  useEffect(() => {
    if (item.hpoi || loading || autoRef.current) return;
    if (excludeRef.current.length > 0) return;
    if (cands.length === 0) return;
    autoRef.current = true;
    confirmId(cands[0].itemId, cands[0]);
  }, [cands, item.hpoi, loading, confirmId]);

  // 「重新查询」：当前这批都不对 → 排除掉再查下一批，并停止自动
  const requery = () => {
    autoRef.current = true;
    excludeRef.current = Array.from(
      new Set([...excludeRef.current, ...cands.map((c) => c.itemId)]),
    );
    load(excludeRef.current);
  };

  const matched = item.hpoi;

  const submitManual = () => {
    const id = parseHpoiId(manualVal);
    if (!id) {
      message.warning('没识别出 hpoi 词条 id（可贴链接或纯数字）');
      return;
    }
    confirmId(id);
  };

  return (
    <div className="fixed right-6 top-24 z-40 w-72">
      <div className="rounded-2xl bg-white/95 backdrop-blur shadow-2xl ring-1 ring-black/5 p-3">
        <div className="text-sm font-medium mb-2 flex items-center gap-2">
          <span>Hpoi 匹配</span>
          {(loading || saving) && <Spin size="small" />}
          <button
            className="ml-auto text-xs text-gray-400 hover:text-gray-700"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '收起' : '展开'}
          </button>
        </div>

        {open && (
          <>
            {matched ? (
              <div>
                <div className="flex gap-2">
                  <HpoiThumb
                    cover={matched.cover}
                    className="w-12 h-12 shrink-0"
                  />
                  <div className="min-w-0">
                    <a
                      href={hpoiDetailUrl(matched.itemId)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm leading-snug line-clamp-2 hover:text-sky-600"
                      title={matched.nameCN}
                    >
                      {matched.nameCN}
                    </a>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {matched.companyName}
                      {matched.scale ? ` · 1/${matched.scale}` : ''}
                    </div>
                    <div className="text-xs text-gray-400">
                      {matched.rating ? `★${matched.rating}` : ''}
                      {matched.commentCount
                        ? `${matched.rating ? ' · ' : ''}${matched.commentCount} 人评`
                        : ''}
                    </div>
                  </div>
                </div>
                {matched.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {matched.tags.slice(0, 14).map((t) => (
                      <Tag key={t} className="!m-0 !text-[10px] !leading-4">
                        {t}
                      </Tag>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <a
                    href={hpoiDetailUrl(matched.itemId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Button size="small">在 Hpoi 打开</Button>
                  </a>
                  <Button size="small" danger onClick={onClear}>
                    解除关联
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      autoRef.current = true;
                      onClear();
                    }}
                  >
                    重新检索
                  </Button>
                </div>
              </div>
            ) : loading ? (
              <div className="py-4 text-center text-xs text-gray-400">
                查询中…
              </div>
            ) : err ? (
              <div className="text-xs text-rose-500">{err}</div>
            ) : cands.length > 0 ? (
              <div className="flex flex-col gap-2">
                {cands.map((c) => (
                  <button
                    key={c.itemId}
                    type="button"
                    disabled={saving}
                    onClick={() => confirmId(c.itemId, c)}
                    className="flex gap-2 text-left rounded-lg p-1 -m-1 hover:bg-sky-50 transition-colors disabled:opacity-60"
                    title="点击关联该 hpoi 词条"
                  >
                    <HpoiThumb cover={c.cover} className="w-12 h-12 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm leading-snug line-clamp-2">
                        {c.nameCN}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {c.companyName}
                        {c.scale ? ` · 1/${c.scale}` : ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-400">
                {excludeRef.current.length > 0
                  ? '没有更多候选了'
                  : '未找到候选'}
              </div>
            )}

            {!matched && !loading && (
              <>
                <div className="mt-2 flex items-center gap-2">
                  <Button size="small" onClick={requery} disabled={saving}>
                    重新查询
                  </Button>
                  <Button
                    size="small"
                    onClick={() => setManualOpen((v) => !v)}
                    disabled={saving}
                  >
                    手动校正
                  </Button>
                </div>
                {manualOpen && (
                  <div className="mt-2 flex items-center gap-1">
                    <Input
                      size="small"
                      value={manualVal}
                      onChange={(e) => setManualVal(e.target.value)}
                      onPressEnter={submitManual}
                      placeholder="贴 hpoi 链接或词条 id"
                    />
                    <Button
                      size="small"
                      type="primary"
                      loading={saving}
                      onClick={submitManual}
                    >
                      确定
                    </Button>
                  </div>
                )}
                <div className="mt-1 text-xs text-gray-300">
                  都不对？用顶部「Hpoi」按钮手动搜，再贴链接校正
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
