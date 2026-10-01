/* eslint-disable react/prop-types */
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  ExportOutlined,
  HeartFilled,
  HeartOutlined,
  HomeOutlined,
  LoadingOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  App,
  Avatar,
  Button,
  Empty,
  Image,
  Input,
  Pagination,
  Segmented,
  Select,
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
import { PageHeader } from '../components/PageHeader';
import {
  addHpoiComment,
  fetchCompanyProducts,
  fetchCompanySeries,
  fetchEntityHobbies,
  fetchExhobbyPics,
  fetchHpoiComments,
  fetchHpoiIntelDetail,
  fetchIntelFeed,
  formatHpoiPrice,
  HpoiComment,
  HPOI_CATEGORY_ID,
  HPOI_ORDER_LABEL,
  HPOI_SITE,
  HPOI_SUB_LABEL,
  HpoiCard,
  HpoiDetail,
  HpoiEntityType,
  HpoiIntel,
  HpoiIntelSubType,
  HpoiOrder,
  HpoiProductCard,
  HpoiRef,
  HpoiRelatedAlbum,
  HpoiSeriesCard,
  hpoiAnyCoverUrl,
  hpoiAvatarUrl,
  hpoiCoverUrl,
  refreshHpoiIntel,
  resolveCompanyFilterId,
  searchHpoiKeyword,
} from '../services/hpoi-intel';
import {
  searchHpoiIndex,
  listHpoiHobbiesByRef,
  ensureHpoiIndexLoaded,
  getHpoiEntityInfo,
  getHpoiHitsByIds,
  HpoiSearchHit,
  HpoiSearchKind,
} from '../services/hpoi-search';
import {
  fetchAlbumDetail,
  fetchAlbumList,
  HPOI_ALBUM_CATEGORY,
  HPOI_ALBUM_CATEGORY_GROUPS,
  HpoiAlbum,
  HpoiAlbumDetail,
  hpoiAlbumCoverUrl,
  hpoiAlbumUrl,
  setHpoiCookie,
} from '../services/hpoi-album';
import { useRemoteImageSrc } from '../hooks/useRemoteImage';
import { MakerPicker, MakerOption } from '../components/figmemo/MakerPicker';
import { hpoiFavKey, useHpoiFavoritesStore } from '../stores/hpoi-favorites';
import { useHpoiIntelStore } from '../stores/hpoi-intel';
import { useSettingsStore } from '../stores/settings';
import { downloadHpoiImages } from '../services/hpoi-download';
import { useRouteStore } from '../stores/route';
import { ROUTES } from '../constants/routes';
import { getMoeyoHpoiPostIndex } from '../services/moeyo';
import { getFigmemoHpoiPostIndex } from '../services/figmemo';
import { searchHpoiWeb } from '../services/hpoi';
import moeyoIcon from '../assets/platform-icons/moeyo.png';
import figmemoIcon from '../assets/platform-icons/figmemo.png';
import { useHpoiAuthStore } from '../stores/hpoi-auth';
import { useSiteCacheStore } from '../stores/site-cache';
import { openUrl } from '../utils/shell';

/** hpoi 图片防盗链：所有 rfx.hpoi.net 图都要带 Referer */
const HPOI_IMG_HEADERS = { Referer: 'https://www.hpoi.net/' };

/** 实体页（本地种子）每页数量 */
const ENTITY_PAGE_SIZE = 91;

/** 本地种子的实体排序项（无发售日期，故不含 release） */
const ENTITY_LOCAL_ORDERS: {
  value: 'add' | 'rating' | 'hits' | 'hits7Day' | 'hitsDay';
  label: string;
}[] = [
  { value: 'hits', label: '总热' },
  { value: 'hitsDay', label: '日热' },
  { value: 'hits7Day', label: '周热' },
  { value: 'rating', label: '评价' },
  { value: 'add', label: '入库' },
];

const CATEGORY_OPTIONS = Object.entries(HPOI_CATEGORY_ID).map(
  ([label, value]) => ({ label, value }),
);
const SUB_OPTIONS = (Object.keys(HPOI_SUB_LABEL) as HpoiIntelSubType[]).map(
  (v) => ({ label: HPOI_SUB_LABEL[v], value: v }),
);
const ENTITY_LABEL: Record<HpoiEntityType, string> = {
  company: '厂商',
  series: '系列',
  works: '作品',
  charactar: '角色',
  person: '原型/色彩',
};
const SEARCH_KIND_LABEL: Record<HpoiSearchKind, string> = {
  hobby: '周边',
  company: '厂商',
  series: '系列',
  works: '作品',
  charactar: '角色',
  person: '原型/色彩',
};
const SEARCH_KIND_ORDER: HpoiSearchKind[] = [
  'hobby',
  'charactar',
  'works',
  'series',
  'person',
  'company',
];
/** 搜索结果每页数量 */
const SEARCH_PAGE_SIZE = 100;
/** 周边搜索结果排序 */
const SEARCH_SORT_OPTIONS: {
  value: 'hits' | 'hitsDay' | 'hits7Day' | 'rating' | 'release' | 'add';
  label: string;
}[] = [
  { value: 'hits', label: '热度' },
  { value: 'hitsDay', label: '日热' },
  { value: 'hits7Day', label: '周热' },
  { value: 'rating', label: '评价' },
  { value: 'release', label: '发售' },
  { value: 'add', label: '入库' },
];

/** hpoi 词条 → 关联的 moeyo / fig-memo 文章 */
interface IntelRelated {
  source: 'moeyo' | 'figmemo';
  items: { postId: string; title: string; coverUrl?: string }[];
  itemId: number;
}
/** Intel 内部导航栈的视图描述（供「返回」用） */
type IntelView =
  | { kind: 'detail'; item: HpoiIntel }
  | { kind: 'entity'; type: HpoiEntityType; id: number; name: string }
  | { kind: 'album'; item: HpoiAlbum }
  | { kind: 'related'; related: IntelRelated };

/** 带 Referer 经后端拉取的 hpoi 图（防防盗链裂图） */
const HpoiImg: React.FC<{
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  wrapperClassName?: string;
}> = ({ src, ...rest }) => {
  const s = useRemoteImageSrc(src, { headers: HPOI_IMG_HEADERS });
  if (!s) {
    return (
      <div
        className="rounded-md bg-gray-100"
        style={{ width: rest.width, height: rest.height }}
      />
    );
  }
  return <Image src={s} {...rest} />;
};

/** 用户头像（防裂图，圆形） */
const HpoiAvatar: React.FC<{ src?: string; name?: string; size?: number }> = ({
  src,
  name,
  size = 32,
}) => {
  const s = useRemoteImageSrc(src, { headers: HPOI_IMG_HEADERS });
  return (
    <Avatar src={s} size={size} className="shrink-0">
      {(name || '?').slice(0, 1)}
    </Avatar>
  );
};

/** 词条正文（贴近 hpoi 网页端：大图 + 信息表 + 进程 + 商品介绍 + 图集 + 实物 + 相关相册） */
const HpoiDetailView: React.FC<{
  detail: HpoiDetail;
  onOpenAlbum?: (album: HpoiRelatedAlbum) => void;
  onOpenRef?: (ref: HpoiRef) => void;
  onOpenRelated?: (r: IntelRelated) => void;
}> = ({ detail, onOpenAlbum, onOpenRef, onOpenRelated }) => {
  const [exh, setExh] = useState<{ list: string[]; url?: string } | null>(null);
  const [exhLoading, setExhLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setExhLoading(true);
    fetchExhobbyPics(detail.itemId, 'hobby')
      .then((r) => alive && setExh(r))
      .catch(() => alive && setExh({ list: [] }))
      .finally(() => alive && setExhLoading(false));
    return () => {
      alive = false;
    };
  }, [detail.itemId]);

  const { message } = App.useApp();
  const loggedIn = useHpoiAuthStore((s) => !!s.utoken);
  const [comments, setComments] = useState<HpoiComment[] | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!loggedIn || !detail.nodeId) return;
    let alive = true;
    setCommentsLoading(true);
    fetchHpoiComments(detail.nodeId)
      .then((c) => alive && setComments(c))
      .catch(() => alive && setComments([]))
      .finally(() => alive && setCommentsLoading(false));
    return () => {
      alive = false;
    };
  }, [loggedIn, detail.nodeId]);

  const submitComment = async () => {
    if (!detail.nodeId || !commentText.trim()) return;
    setPosting(true);
    try {
      await addHpoiComment(detail.nodeId, commentText.trim());
      setCommentText('');
      setComments(await fetchHpoiComments(detail.nodeId));
      message.success('已发表');
    } catch (err: any) {
      message.error(err?.message || '发表失败');
    } finally {
      setPosting(false);
    }
  };

  // 关联的 moeyo / fig-memo 文章
  const [relMo, setRelMo] = useState<
    { postId: string; title: string; coverUrl?: string }[]
  >([]);
  const [relFi, setRelFi] = useState<
    { postId: string; title: string; coverUrl?: string }[]
  >([]);
  useEffect(() => {
    let alive = true;
    Promise.all([
      getMoeyoHpoiPostIndex()
        .then((m) => m.get(detail.itemId) || [])
        .catch(() => []),
      getFigmemoHpoiPostIndex()
        .then((m) => m.get(detail.itemId) || [])
        .catch(() => []),
    ]).then(([mo, fi]) => {
      if (!alive) return;
      setRelMo(mo);
      setRelFi(fi);
    });
    return () => {
      alive = false;
    };
  }, [detail.itemId]);

  const money =
    detail.price != null
      ? formatHpoiPrice(detail.price, detail.currency)
      : undefined;
  const rows: [string, React.ReactNode][] = [];
  if (detail.category) rows.push(['属性', detail.category]);
  if (detail.scale) rows.push(['比例', `1/${detail.scale}`]);
  if (detail.releaseDate) rows.push(['发售日', detail.releaseDate]);
  if (money) rows.push(['官方价', money]);
  if (detail.rating != null) {
    rows.push([
      '评分',
      `${detail.rating}${detail.ratingCount ? `（${detail.ratingCount} 人）` : ''}`,
    ]);
  }
  const refsByField = new Map<string, HpoiRef[]>();
  for (const r of detail.refs) {
    const arr = refsByField.get(r.field) || [];
    arr.push(r);
    refsByField.set(r.field, arr);
  }
  const shown = new Set(['比例', '定价', '官方价', '发售日', '发售', '属性']);
  for (const [k, v] of Object.entries(detail.specs)) {
    if (shown.has(k)) continue;
    // 「属性」是多个标签（如「女 比例人形 观感安心」），渲染成 chip
    if (k === '属性') {
      const tags = [
        ...new Set([
          ...String(v).split(/\s+/).filter(Boolean),
          ...detail.specTags,
        ]),
      ];
      rows.push([
        k,
        <span key="attr" className="inline-flex flex-wrap gap-1">
          {tags.map((t) => (
            <Tag key={t} className="!m-0">
              {t}
            </Tag>
          ))}
        </span>,
      ]);
      continue;
    }
    const fieldRefs = refsByField.get(k);
    if (fieldRefs && fieldRefs.length > 0) {
      rows.push([
        k,
        <span key={k} className="inline-flex flex-wrap gap-x-3 gap-y-0.5">
          {fieldRefs.map((r, i) =>
            r.url ? (
              <a
                key={`${r.type}-${r.id}-${i}`}
                className="text-ant-color-primary hover:underline cursor-pointer"
                title={r.url}
                onClick={() => onOpenRef?.(r)}
              >
                {r.name}
              </a>
            ) : (
              <span key={`${r.type}-${i}`}>{r.name}</span>
            ),
          )}
        </span>,
      ]);
      continue;
    }
    rows.push([k, v]);
  }

  return (
    <article className="bg-white rounded-md border-[1px] p-4">
      <h1 className="text-xl font-bold">{detail.nameCN}</h1>
      {detail.nameJa && (
        <p className="text-sm text-gray-500 mt-0.5">{detail.nameJa}</p>
      )}

      <div className="mt-4 flex flex-col md:flex-row gap-4 items-start">
        {detail.cover && (
          <div className="md:w-[280px] md:h-[450px] shrink-0 rounded-md bg-gray-50 flex items-center justify-center overflow-hidden">
            <HpoiImg
              src={detail.cover}
              className="max-h-full max-w-full object-contain"
              alt={detail.nameCN}
            />
          </div>
        )}

        {rows.length > 0 && (
          <div className="flex-1 min-w-0 md:h-[450px] md:overflow-y-auto">
            <table className="text-sm w-full">
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k} className="border-b-[1px] border-gray-100">
                    <th className="text-gray-400 font-normal text-left align-top py-1.5 pr-3 whitespace-nowrap w-20">
                      {k}
                    </th>
                    <td className="py-1.5">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(detail.ratingBars.length > 0 ||
          relMo.length > 0 ||
          relFi.length > 0) && (
          <div className="md:w-[240px] shrink-0">
            {detail.ratingBars.length > 0 && (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-gray-500">评分：</span>
                  <span className="text-3xl font-bold text-[#e6a23c]">
                    {detail.rating != null ? detail.rating : '—'}
                  </span>
                </div>
                {detail.ratingCount != null && (
                  <div className="mb-2 text-xs text-gray-400">
                    共有 {detail.ratingCount} 个评分
                  </div>
                )}
                <div className="flex h-[100px] items-end gap-1.5">
                  {detail.ratingBars.map((b) => {
                    const max = Math.max(
                      1,
                      ...detail.ratingBars.map((x) => x.count),
                    );
                    return (
                      <div
                        key={b.label}
                        className="flex h-full flex-1 flex-col items-center justify-end"
                      >
                        <span className="mb-0.5 text-[10px] text-gray-500">
                          {b.count}
                        </span>
                        <div
                          className="w-2/3 rounded-t bg-[#FFD17B]"
                          style={{
                            height: `${Math.max(2, (b.count / max) * 78)}%`,
                          }}
                        />
                        <span className="mt-1 text-[10px] text-gray-500">
                          {b.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {(relMo.length > 0 || relFi.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {relMo.length > 0 && (
                  <Button
                    size="small"
                    icon={
                      <img
                        src={moeyoIcon as string}
                        alt="moeyo"
                        className="h-4 w-4 object-contain"
                      />
                    }
                    onClick={() =>
                      onOpenRelated?.({
                        source: 'moeyo',
                        items: relMo,
                        itemId: detail.itemId,
                      })
                    }
                  >
                    查看 moeyo 文章
                    {relMo.length > 1 ? `（${relMo.length}）` : ''}
                  </Button>
                )}
                {relFi.length > 0 && (
                  <Button
                    size="small"
                    icon={
                      <img
                        src={figmemoIcon as string}
                        alt="fig-memo"
                        className="h-4 w-4 object-contain"
                      />
                    }
                    onClick={() =>
                      onOpenRelated?.({
                        source: 'figmemo',
                        items: relFi,
                        itemId: detail.itemId,
                      })
                    }
                  >
                    查看 fig-memo 文章
                    {relFi.length > 1 ? `（${relFi.length}）` : ''}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {detail.process.length > 0 && (
        <div className="mt-6">
          <h2 className="font-medium mb-2">进程</h2>
          <div className="overflow-x-auto pb-2">
            <div className="flex items-start min-w-max">
              {detail.process.map((p, i) => (
                <div
                  key={`${p.event}-${i}`}
                  className="relative w-[220px] px-2"
                >
                  <div className="flex items-center">
                    <div
                      className={`h-[2px] flex-1 ${
                        i === 0 ? 'bg-transparent' : 'bg-ant-color-primary/40'
                      }`}
                    />
                    <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-ant-color-primary" />
                    <div
                      className={`h-[2px] flex-1 ${
                        i === detail.process.length - 1
                          ? 'bg-transparent'
                          : 'bg-ant-color-primary/40'
                      }`}
                    />
                  </div>
                  <div className="mt-2 text-center text-xs text-gray-400">
                    {p.time}
                  </div>
                  <div className="text-center text-sm font-medium text-ant-color-primary">
                    {p.event}
                  </div>
                  <div
                    className="mt-1 text-center text-xs text-gray-600 line-clamp-2"
                    title={p.title}
                  >
                    {p.detail}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {(detail.descriptionHtml || detail.description) && (
        <div className="mt-6">
          <h2 className="font-medium mb-2">商品介绍</h2>
          {detail.descriptionHtml ? (
            <div
              className="text-sm leading-relaxed text-gray-700 [&_img]:max-w-full [&_p]:my-2"
              dangerouslySetInnerHTML={{ __html: detail.descriptionHtml }}
            />
          ) : (
            <p className="text-sm text-gray-600 whitespace-pre-wrap">
              {detail.description}
            </p>
          )}
        </div>
      )}

      {detail.images.length > 0 && (
        <div className="mt-6">
          <h2 className="font-medium mb-2">
            官方图集（{detail.images.length}）
          </h2>
          <Image.PreviewGroup>
            <div className="flex flex-wrap gap-2">
              {detail.images.map((url) => (
                <HpoiImg
                  key={url}
                  src={url}
                  width={150}
                  height={150}
                  className="object-cover rounded-md"
                />
              ))}
            </div>
          </Image.PreviewGroup>
        </div>
      )}

      {detail.userPhotos.length > 0 && (
        <div className="mt-6">
          <h2 className="font-medium mb-2">
            实物照片（{detail.userPhotos.length}）
          </h2>
          <Image.PreviewGroup>
            <div className="flex flex-wrap gap-2">
              {detail.userPhotos.map((url) => (
                <HpoiImg
                  key={url}
                  src={url}
                  width={160}
                  height={160}
                  className="object-cover rounded-md"
                />
              ))}
            </div>
          </Image.PreviewGroup>
        </div>
      )}

      <div className="mt-6">
        <h2 className="font-medium mb-2 flex items-center gap-2">
          ExHobby 实物图
          {exh?.url && (
            <a
              className="text-xs text-ant-color-primary hover:underline cursor-pointer"
              onClick={() => openUrl(exh.url!)}
            >
              更多
            </a>
          )}
        </h2>
        {exhLoading ? (
          <Spin size="small" />
        ) : !exh || exh.list.length === 0 ? (
          <p className="text-sm text-gray-400">没有 ExHobby 图片</p>
        ) : (
          <Image.PreviewGroup>
            <div className="flex flex-wrap gap-2">
              {exh.list.map((url) => (
                <HpoiImg
                  key={url}
                  src={url}
                  width={160}
                  height={160}
                  className="object-cover rounded-md"
                />
              ))}
            </div>
          </Image.PreviewGroup>
        )}
      </div>

      {detail.albums.length > 0 && (
        <div className="mt-6">
          <h2 className="font-medium mb-2">
            相关相册（{detail.albums.length}）
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
            {detail.albums.map((a) => (
              <li
                key={a.id}
                className="bg-white rounded-md border-[1px] overflow-hidden cursor-pointer hover:shadow-sm"
                onClick={() => onOpenAlbum?.(a)}
              >
                <div className="relative aspect-[3/4] bg-gray-50">
                  <HpoiImg
                    src={a.cover}
                    className="w-full h-full object-cover"
                    wrapperClassName="w-full h-full"
                  />
                  {a.praise != null && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[10px] text-white">
                      ♥ {a.praise}
                    </span>
                  )}
                </div>
                <div className="p-2 text-xs line-clamp-2 h-8">{a.name}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loggedIn && detail.nodeId && (
        <div className="mt-6">
          <h2 className="font-medium mb-2">
            评论{comments ? `（${comments.length}）` : ''}
          </h2>
          <div className="mb-3 flex items-start gap-2">
            <Input.TextArea
              rows={2}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="发表评论…"
            />
            <Button
              type="primary"
              loading={posting}
              disabled={!commentText.trim()}
              onClick={submitComment}
            >
              发表
            </Button>
          </div>
          {commentsLoading ? (
            <Spin size="small" />
          ) : !comments || comments.length === 0 ? (
            <p className="text-sm text-gray-400">暂无评论</p>
          ) : (
            <ul className="space-y-3">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-2">
                  <HpoiAvatar
                    src={hpoiAvatarUrl(c.user?.header)}
                    name={c.user?.nickname}
                  />
                  <div className="min-w-0">
                    <div className="text-xs text-gray-400">
                      {c.user?.nickname || '匿名'}
                      {c.floor ? ` · ${c.floor}楼` : ''}
                      {c.addTime ? ` · ${c.addTime}` : ''}
                      {c.praiseCount ? ` · ♥ ${c.praiseCount}` : ''}
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-gray-700">
                      {c.content}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
};

/** 实体/系列的产品卡片网格（封面统一走 hpoiAnyCoverUrl） */
const HobbyGrid: React.FC<{
  cards: { itemId: number; name: string; cover?: string }[];
  onOpen: (c: { itemId: number; name: string; cover?: string }) => void;
}> = ({ cards, onOpen }) => (
  <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
    {cards.map((c) => (
      <li
        key={c.itemId}
        className="bg-white rounded-md border-[1px] overflow-hidden cursor-pointer hover:shadow-sm"
        onClick={() => onOpen(c)}
      >
        <div className="aspect-square bg-gray-50">
          <HpoiImg
            src={hpoiAnyCoverUrl(c.cover)}
            className="w-full h-full object-cover"
            wrapperClassName="w-full h-full"
          />
        </div>
        <div className="p-2 text-xs line-clamp-2 h-8">{c.name}</div>
      </li>
    ))}
  </ul>
);

/** 滚动接近底部（<300px）时触发加载更多 */
function isNearBottom(el: HTMLElement, threshold = 300): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

/** 右下角圆形浮动按钮容器 */
const FloatBar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="fixed right-6 bottom-6 z-50">
    <div className="flex flex-col items-end gap-3">{children}</div>
  </div>
);

/** 单个圆形浮动按钮（样式对齐 fig-memo / moeyo） */
const FloatButton: React.FC<{
  title: string;
  active?: boolean;
  big?: boolean;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}> = ({ title, active, big, disabled, onClick, children }) => (
  <button
    type="button"
    title={title}
    disabled={disabled}
    onClick={onClick}
    className={`group flex ${
      big ? 'h-12 w-12' : 'h-11 w-11'
    } items-center justify-center rounded-full shadow-lg ring-1 ring-black/5 transition-all duration-200 ease-out hover:scale-110 hover:shadow-xl active:scale-95 disabled:opacity-60 ${
      active
        ? 'bg-gradient-to-br from-pink-400 to-rose-500 text-white'
        : 'bg-white text-gray-500 hover:text-ant-color-primary'
    }`}
  >
    {children}
  </button>
);

/** 收藏浮动按钮（词条 / 实体通用） */
const FavFloat: React.FC<{ kind: string; id: number | string }> = ({
  kind,
  id,
}) => {
  const key = hpoiFavKey(kind, id);
  const has = useHpoiFavoritesStore((s) => s.ids.includes(key));
  const toggle = useHpoiFavoritesStore((s) => s.toggle);
  return (
    <FloatButton
      title={has ? '取消收藏' : '收藏'}
      active={has}
      big
      onClick={(e) => {
        e.stopPropagation();
        toggle(key);
      }}
    >
      {has ? (
        <HeartFilled className="text-lg" />
      ) : (
        <HeartOutlined className="text-lg transition-transform duration-300 group-hover:scale-110" />
      )}
    </FloatButton>
  );
};

/** 下载图片浮动按钮（把词条 / 相册的图片加入下载队列） */
const DownloadFloat: React.FC<{
  title: string;
  getImages: () => (string | undefined | null)[];
}> = ({ title, getImages }) => {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  return (
    <FloatButton
      title="下载图片到本地"
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          const n = await downloadHpoiImages(title, getImages());
          if (n > 0) message.success(`已加入下载队列（${n} 张）`);
          else message.info('没有可下载的图片');
        } catch (err: any) {
          message.error(err?.message || '加入下载队列失败');
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <LoadingOutlined className="text-lg" />
      ) : (
        <DownloadOutlined className="text-lg transition-transform duration-300 group-hover:scale-110" />
      )}
    </FloatButton>
  );
};

/** 简略网格：固定小缩略图、不显示名称（悬停看 title） */
const ThumbGrid: React.FC<{
  cards: { itemId: number; name: string; cover?: string }[];
  onOpen: (c: { itemId: number; name: string; cover?: string }) => void;
}> = ({ cards, onOpen }) => (
  <ul className="flex flex-wrap gap-2">
    {cards.map((c) => (
      <li
        key={c.itemId}
        title={c.name}
        className="w-20 h-20 bg-white rounded-md border-[1px] overflow-hidden cursor-pointer hover:shadow-sm shrink-0"
        onClick={() => onOpen(c)}
      >
        <HpoiImg
          src={hpoiAnyCoverUrl(c.cover)}
          className="w-full h-full object-cover"
          wrapperClassName="w-full h-full"
        />
      </li>
    ))}
  </ul>
);

/** 搜索结果网格：名称给到 3 行（悬停看全名）+ 厂商/分类小字 */
const SearchGrid: React.FC<{
  hits: HpoiSearchHit[];
  onOpen: (h: HpoiSearchHit) => void;
}> = ({ hits, onOpen }) => (
  <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
    {hits.map((h) => (
      <li
        key={`${h.kind}:${h.id}`}
        className="bg-white rounded-md border-[1px] overflow-hidden cursor-pointer hover:shadow-sm"
        onClick={() => onOpen(h)}
      >
        <div className="aspect-square bg-gray-50">
          <HpoiImg
            src={hpoiAnyCoverUrl(h.cover)}
            className="w-full h-full object-cover"
            wrapperClassName="w-full h-full"
          />
        </div>
        <div className="p-2">
          <p className="text-xs leading-snug line-clamp-3" title={h.name}>
            {h.name}
          </p>
          {(h.companyName || h.category) && (
            <p className="mt-1 text-[11px] text-gray-400 truncate">
              {[h.companyName, h.category].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </li>
    ))}
  </ul>
);

/** 居中 loading */
const SpinCenter: React.FC = () => (
  <div className="flex justify-center py-16">
    <Spin />
  </div>
);

// 会话级缓存：切走再切回保持列表与筛选
let cacheKey = '';
let cacheItems: HpoiIntel[] | null = null;
let cacheCursor: string | undefined;

function dedupeAlbums(arr: HpoiAlbum[]): HpoiAlbum[] {
  const seen = new Set<number>();
  const out: HpoiAlbum[] = [];
  for (const a of arr) {
    if (a.itemId && !seen.has(a.itemId)) {
      seen.add(a.itemId);
      out.push(a);
    }
  }
  return out;
}

export const IntelPage: React.FC = () => {
  const { message } = App.useApp();
  const siteCacheVersion = useSiteCacheStore((s) => s.version);
  const [tab, setTab] = useState('intel');
  const entityView = useHpoiIntelStore((s) => s.entityView);
  const setEntityView = useHpoiIntelStore((s) => s.setEntityView);

  // ---- 收藏 ----
  const favIds = useHpoiFavoritesStore((s) => s.ids);
  const [favData, setFavData] = useState<
    { kind: HpoiSearchKind; hits: HpoiSearchHit[] }[]
  >([]);
  const [favLoading, setFavLoading] = useState(false);
  useEffect(() => {
    if (tab !== 'fav') return;
    let alive = true;
    setFavLoading(true);
    (async () => {
      await ensureHpoiIndexLoaded();
      const byKind = new Map<string, number[]>();
      for (const key of useHpoiFavoritesStore.getState().ids) {
        const i = key.indexOf(':');
        if (i < 0) continue;
        const kind = key.slice(0, i);
        const id = Number(key.slice(i + 1));
        if (!kind || !id) continue;
        const arr = byKind.get(kind) || [];
        arr.push(id);
        byKind.set(kind, arr);
      }
      const out: { kind: HpoiSearchKind; hits: HpoiSearchHit[] }[] = [];
      for (const kind of SEARCH_KIND_ORDER) {
        const ids = byKind.get(kind);
        if (!ids || ids.length === 0) continue;
        out.push({ kind, hits: getHpoiHitsByIds(kind, ids) });
      }
      if (alive) {
        setFavData(out);
        setFavLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tab, favIds]);

  // ---- 情报 ----
  const [categoryId, setCategoryId] = useState<number>(HPOI_CATEGORY_ID.手办);
  const [subType, setSubType] = useState<HpoiIntelSubType>('all');
  const [items, setItems] = useState<HpoiIntel[]>(cacheItems || []);
  const [cursor, setCursor] = useState<string | undefined>(cacheCursor);
  const [loading, setLoading] = useState(!cacheItems);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<HpoiIntel | null>(null);
  const [detail, setDetail] = useState<HpoiDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const key = `${categoryId}:${subType}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await fetchIntelFeed({ categoryId, subType });
      cacheKey = key;
      cacheItems = page.items;
      cacheCursor = page.lastTime;
      setItems(page.items);
      setCursor(page.lastTime);
    } catch (err: any) {
      message.error(err?.message || '加载 hpoi 情报失败');
    } finally {
      setLoading(false);
    }
  }, [categoryId, subType, key, message]);

  useEffect(() => {
    if (cacheItems && cacheKey === key) {
      setItems(cacheItems);
      setCursor(cacheCursor);
      return;
    }
    void load();
  }, []);

  useEffect(() => {
    if (cacheItems && cacheKey === key) return;
    void load();
  }, [key]);

  useEffect(() => {
    if (siteCacheVersion === 0) return;
    if (selected) return;
    void load();
  }, [siteCacheVersion]);

  // 刷新按钮：刷当前列表 + 回溯时间流缓存（不足 30 天则回溯）
  const refreshIntelAll = async () => {
    await load();
    const key = 'hpoi-intel-refresh';
    let started = false;
    try {
      await refreshHpoiIntel(
        useSettingsStore.getState().timeline?.rangeDays ?? 30,
        useHpoiIntelStore.getState().categoryIds,
        (p) => {
          started = true;
          message.loading({
            key,
            duration: 0,
            content:
              p.mode === 'full'
                ? `hpoi 正在回溯近 30 天情报…（第 ${p.page} 页 · 已 ${p.total} 条）`
                : `hpoi 情报更新中…（已 ${p.total} 条）`,
          });
        },
      );
    } catch {
      /* 忽略 */
    } finally {
      if (started) message.success({ key, content: 'hpoi 情报已更新' });
    }
  };

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchIntelFeed({
        categoryId,
        subType,
        lastTime: cursor,
      });
      const merged = [...items, ...page.items];
      cacheItems = merged;
      cacheCursor = page.lastTime;
      setItems(merged);
      setCursor(page.lastTime);
    } catch (err: any) {
      message.error(err?.message || '加载更多失败');
    } finally {
      setLoadingMore(false);
    }
  };

  const openItem = useCallback(
    async (item: HpoiIntel, push = true) => {
      if (push) navRef.current.pushCurrent();
      setAlbumSel(null);
      setEntity(null);
      setRelated(null);
      setSelected(item);
      setDetail(null);
      setDetailLoading(true);
      try {
        const d = await fetchHpoiIntelDetail(item.itemId);
        setDetail(d);
      } catch (err: any) {
        message.error(err?.message || '加载词条失败');
      } finally {
        setDetailLoading(false);
      }
    },
    [message],
  );

  // ---- 相册 ----
  const [albumCategory, setAlbumCategory] = useState<number>(
    HPOI_ALBUM_CATEGORY.手办,
  );
  const [albums, setAlbums] = useState<HpoiAlbum[]>([]);
  const [albumPage, setAlbumPage] = useState(0);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [albumHasMore, setAlbumHasMore] = useState(false);
  const [albumSel, setAlbumSel] = useState<HpoiAlbum | null>(null);
  const [albumDetail, setAlbumDetail] = useState<HpoiAlbumDetail | null>(null);
  const [albumPics, setAlbumPics] = useState<string[]>([]);
  const [picsLoading, setPicsLoading] = useState(false);
  const [albumExh, setAlbumExh] = useState<{
    list: string[];
    url?: string;
  } | null>(null);

  // 相册的 ExHobby 实物图（itemType=album）
  useEffect(() => {
    if (!albumSel) {
      setAlbumExh(null);
      return;
    }
    let alive = true;
    fetchExhobbyPics(albumSel.itemId, 'album')
      .then((r) => alive && setAlbumExh(r))
      .catch(() => alive && setAlbumExh({ list: [] }));
    return () => {
      alive = false;
    };
  }, [albumSel]);

  const ensureCookie = () => {
    const t = useHpoiAuthStore.getState().utoken;
    setHpoiCookie(t ? `utoken=${t}` : '');
  };

  const loadAlbums = useCallback(
    async (reset = false, category = albumCategory) => {
      const nextPage = reset ? 1 : albumPage + 1;
      setAlbumLoading(true);
      try {
        ensureCookie();
        const list = await fetchAlbumList(nextPage, 30, category);
        const merged = reset
          ? dedupeAlbums(list)
          : dedupeAlbums([...albums, ...list]);
        const added = dedupeAlbums(list).length;
        setAlbums(merged);
        setAlbumPage(nextPage);
        setAlbumHasMore(added > 0);
      } catch (err: any) {
        message.error(err?.message || '加载 hpoi 相册失败');
        setAlbumHasMore(false);
      } finally {
        setAlbumLoading(false);
      }
    },
    [albumCategory, albumPage, albums, message],
  );

  // 切到相册标签且未加载过 → 拉第一页
  useEffect(() => {
    if (tab !== 'album') return;
    if (albums.length > 0) return;
    void loadAlbums(true);
  }, [tab]);

  // ---- 实体页（厂商 / 作品 / 角色 / 原型） ----
  const [entity, setEntity] = useState<{
    type: HpoiEntityType;
    id: number;
    name: string;
  } | null>(null);
  const [entityCards, setEntityCards] = useState<HpoiCard[]>([]);
  const [entityLoading, setEntityLoading] = useState(false);
  // 本地种子模式：某实体的全部手办（离线、完整）+ 本地筛选/排序/分页
  const [entityLocal, setEntityLocal] = useState<HpoiSearchHit[] | null>(null);
  const [entityLocalCat, setEntityLocalCat] = useState<string>('');
  const [entityLocalOrder, setEntityLocalOrder] = useState<
    'add' | 'rating' | 'hits' | 'hits7Day' | 'hitsDay'
  >('hits');
  const [entityLocalPage, setEntityLocalPage] = useState(1);
  const [entityLocalCompany, setEntityLocalCompany] = useState<string | null>(
    null,
  );
  const [entityLocalYear, setEntityLocalYear] = useState<string | null>(null);
  const [entityLocalChar, setEntityLocalChar] = useState<number | null>(null);
  const [entityLocalWork, setEntityLocalWork] = useState<number | null>(null);

  // 关联文章（moeyo / fig-memo）选择
  const [related, setRelated] = useState<IntelRelated | null>(null);
  // 内部导航栈（返回用）
  const navStackRef = useRef<IntelView[]>([]);
  const navRef = useRef<{
    pushCurrent: () => void;
    restore: (v: IntelView) => void;
  }>({ pushCurrent: () => undefined, restore: () => undefined });

  // 厂商专属：产品列表（query-v2）+ 关联系列
  const [entityTab, setEntityTab] = useState<'products' | 'series'>('products');
  const [companyFilterId, setCompanyFilterId] = useState(0);
  const [productCategory, setProductCategory] = useState<number>(
    HPOI_CATEGORY_ID.手办,
  );
  const [productOrder, setProductOrder] = useState<HpoiOrder>('add');
  const [products, setProducts] = useState<HpoiProductCard[]>([]);
  const [productPage, setProductPage] = useState(0);
  const [productsLoading, setProductsLoading] = useState(false);
  const [seriesCards, setSeriesCards] = useState<HpoiSeriesCard[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);

  const fetchProducts = (
    fid: number,
    category: number,
    order: HpoiOrder,
    page: number,
  ) => fetchCompanyProducts(fid, { category, order, page, pageSize: 24 });

  const openEntity = async (
    type: HpoiEntityType,
    id: number,
    name: string,
    push = true,
  ) => {
    if (push) navRef.current.pushCurrent();
    setSelected(null);
    setDetail(null);
    setAlbumSel(null);
    setRelated(null);
    setEntity({ type, id, name });
    setEntityTab('products');
    setEntityCards([]);
    setProducts([]);
    setProductPage(0);
    setSeriesCards([]);
    setEntityLocal(null);
    setEntityLocalCat('');
    setEntityLocalOrder('hits');
    setEntityLocalPage(1);
    setEntityLocalCompany(null);
    setEntityLocalYear(null);
    setEntityLocalChar(null);
    setEntityLocalWork(null);
    setProductsLoading(true);

    // 本地种子优先：离线列出该实体全部手办（完整），分页浏览
    setEntityLoading(true);
    try {
      if (await ensureHpoiIndexLoaded()) {
        setEntityLocal(await listHpoiHobbiesByRef(type, id));
        setEntityLoading(false);
        setProductsLoading(false);
        if (type === 'company') {
          setSeriesLoading(true);
          fetchCompanySeries(id)
            .catch(() => [] as HpoiSeriesCard[])
            .then((s) => setSeriesCards(s))
            .finally(() => setSeriesLoading(false));
        }
        return;
      }
    } catch {
      // 索引损坏 → 回退在线
    }
    setEntityLoading(false);

    // 在线兜底（未安装离线索引）
    if (type !== 'company') {
      setEntityLoading(true);
      try {
        setEntityCards(await fetchEntityHobbies(type, id));
      } catch (err: any) {
        message.error(err?.message || '加载实体页失败');
      } finally {
        setEntityLoading(false);
      }
      return;
    }
    setProductsLoading(true);
    setSeriesLoading(true);
    try {
      const fid = await resolveCompanyFilterId(id);
      setCompanyFilterId(fid);
      const [prods, series] = await Promise.all([
        fetchProducts(fid, productCategory, productOrder, 1),
        fetchCompanySeries(id).catch(() => [] as HpoiSeriesCard[]),
      ]);
      setProducts(prods);
      setProductPage(1);
      setSeriesCards(series);
    } catch (err: any) {
      message.error(err?.message || '加载厂商页失败');
    } finally {
      setProductsLoading(false);
      setSeriesLoading(false);
    }
  };

  // 本地种子：分类（带计数）
  const entityLocalCats = useMemo(() => {
    if (!entityLocal) return [] as [string, number][];
    const m = new Map<string, number>();
    for (const h of entityLocal) {
      const c = h.category || '其他';
      m.set(c, (m.get(c) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [entityLocal]);

  // 本地种子：厂商（带计数，供 MakerPicker）
  const entityLocalCompanies = useMemo(() => {
    if (!entityLocal) return [] as MakerOption[];
    const m = new Map<string, number>();
    for (const h of entityLocal) {
      const c = (h.companyName || '').trim();
      if (c) m.set(c, (m.get(c) || 0) + 1);
    }
    return [...m.entries()].map(([name, count]) => ({
      name,
      id: name,
      count,
    }));
  }, [entityLocal]);

  // 本地种子：年份（带计数，降序）
  const entityLocalYears = useMemo(() => {
    if (!entityLocal) return [] as [string, number][];
    const m = new Map<string, number>();
    for (const h of entityLocal) {
      const y = (h.releaseDate || '').slice(0, 4);
      if (/^\d{4}$/.test(y)) m.set(y, (m.get(y) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [entityLocal]);

  // 本地种子：角色（带计数 + 名称 + 最高热度条目封面，供「按角色筛选」；仅 2 个以上时展示）
  const entityLocalChars = useMemo(() => {
    if (!entityLocal)
      return [] as {
        id: number;
        name: string;
        count: number;
        cover?: string;
      }[];
    const info = new Map<
      number,
      { count: number; hits: number; cover?: string }
    >();
    for (const h of entityLocal) {
      for (const r of h.refs || []) {
        if (!r.startsWith('h:')) continue;
        const id = Number(r.slice(2));
        if (!id) continue;
        const e = info.get(id) || { count: 0, hits: -1 };
        e.count++;
        const hv = h.hits || 0;
        if (hv > e.hits) {
          e.hits = hv;
          e.cover = h.cover;
        }
        info.set(id, e);
      }
    }
    if (info.size < 2) return [];
    const meta = getHpoiEntityInfo('charactar', new Set(info.keys()));
    return [...info.entries()]
      .map(([id, e]) => ({
        id,
        name: meta.get(id)?.name || `角色 ${id}`,
        count: e.count,
        cover: e.cover,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [entityLocal]);

  // 本地种子：作品（带计数 + 名称 + 作品自身封面，供「按作品筛选」）
  const entityLocalWorks = useMemo(() => {
    if (!entityLocal)
      return [] as {
        id: number;
        name: string;
        count: number;
        cover?: string;
      }[];
    const counts = new Map<number, number>();
    for (const h of entityLocal) {
      for (const r of h.refs || []) {
        if (!r.startsWith('w:')) continue;
        const id = Number(r.slice(2));
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    if (counts.size < 2) return [];
    const meta = getHpoiEntityInfo('works', new Set(counts.keys()));
    return [...counts.entries()]
      .map(([id, count]) => ({
        id,
        name: meta.get(id)?.name || `作品 ${id}`,
        count,
        cover: meta.get(id)?.cover,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [entityLocal]);

  // 本地种子：筛选 + 排序后的完整列表
  const entityLocalView = useMemo(() => {
    if (!entityLocal) return [] as HpoiSearchHit[];
    const arr = entityLocal.filter((h) => {
      if (entityLocalCat && (h.category || '其他') !== entityLocalCat)
        return false;
      if (
        entityLocalCompany &&
        (h.companyName || '').trim() !== entityLocalCompany
      )
        return false;
      if (
        entityLocalYear &&
        (h.releaseDate || '').slice(0, 4) !== entityLocalYear
      )
        return false;
      if (entityLocalChar && !(h.refs || []).includes(`h:${entityLocalChar}`))
        return false;
      if (entityLocalWork && !(h.refs || []).includes(`w:${entityLocalWork}`))
        return false;
      return true;
    });
    const val = (h: HpoiSearchHit) =>
      entityLocalOrder === 'add'
        ? h.id
        : entityLocalOrder === 'rating'
          ? h.rating || 0
          : entityLocalOrder === 'hits7Day'
            ? h.hits7Day || 0
            : entityLocalOrder === 'hitsDay'
              ? h.hitsDay || 0
              : h.hits || 0;
    arr.sort((a, b) => val(b) - val(a) || b.id - a.id);
    return arr;
  }, [
    entityLocal,
    entityLocalCat,
    entityLocalCompany,
    entityLocalYear,
    entityLocalChar,
    entityLocalWork,
    entityLocalOrder,
  ]);

  const entityLocalPageItems = entityLocalView.slice(
    (entityLocalPage - 1) * ENTITY_PAGE_SIZE,
    entityLocalPage * ENTITY_PAGE_SIZE,
  );

  const loadMoreProducts = async () => {
    if (!companyFilterId || productsLoading) return;
    setProductsLoading(true);
    try {
      const next = productPage + 1;
      const list = await fetchProducts(
        companyFilterId,
        productCategory,
        productOrder,
        next,
      );
      setProducts((prev) => {
        const seen = new Set(prev.map((p) => p.itemId));
        const merged = [...prev];
        for (const p of list) {
          if (!seen.has(p.itemId)) {
            seen.add(p.itemId);
            merged.push(p);
          }
        }
        return merged;
      });
      setProductPage(next);
      if (list.length === 0) message.info('没有更多了');
    } catch (err: any) {
      message.error(err?.message || '加载更多失败');
    } finally {
      setProductsLoading(false);
    }
  };

  const reloadProducts = async (category: number, order: HpoiOrder) => {
    if (!companyFilterId) return;
    setProductsLoading(true);
    try {
      setProducts(await fetchProducts(companyFilterId, category, order, 1));
      setProductPage(1);
    } catch (err: any) {
      message.error(err?.message || '加载产品失败');
    } finally {
      setProductsLoading(false);
    }
  };

  const openCard = (c: { itemId: number; name: string; cover?: string }) =>
    void openItem({
      itemId: c.itemId,
      categoryName: '',
      eventType: 'all',
      eventLabel: '',
      timeText: '',
      title: c.name,
      shortName: c.name,
      cover: c.cover,
      url: `${HPOI_SITE}/hobby/${c.itemId}`,
    });

  // ---- 搜索（本地种子优先，空则在线兜底） ----
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<HpoiSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFallback, setSearchFallback] = useState(false);
  // 搜索结果的分类 / 周边筛选排序 / 分页
  const [searchKind, setSearchKind] = useState<HpoiSearchKind>('hobby');
  const [searchSort, setSearchSort] = useState<
    'hits' | 'hitsDay' | 'hits7Day' | 'rating' | 'release' | 'add'
  >('hits');
  const [searchCat, setSearchCat] = useState('');
  const [searchCompany, setSearchCompany] = useState<string | null>(null);
  const [searchYear, setSearchYear] = useState<string | null>(null);
  const [searchPage, setSearchPage] = useState(1);

  const resetSearchView = () => {
    setSearchKind('hobby');
    setSearchSort('hits');
    setSearchCat('');
    setSearchCompany(null);
    setSearchYear(null);
    setSearchPage(1);
  };

  const onSearch = async (q: string) => {
    const kw = (q || '').trim();
    if (!kw) {
      setSearchHits(null);
      return;
    }
    setSearching(true);
    resetSearchView();
    try {
      let hits = await searchHpoiIndex(kw, 5000);
      let fallback = false;
      if (hits.length === 0) {
        const online = await searchHpoiKeyword(kw).catch(() => []);
        if (online.length > 0) {
          fallback = true;
          hits = online.map((p) => ({
            kind: 'hobby' as HpoiSearchKind,
            id: p.itemId,
            name: p.name,
            cover: p.cover,
            score: 0,
          }));
        }
      }
      // 再兜底：hpoi 网站搜索页（返回另一套排序结果）
      if (hits.length === 0) {
        const web = await searchHpoiWeb(kw, 30).catch(() => []);
        if (web.length > 0) {
          fallback = true;
          hits = web.map((it) => ({
            kind: 'hobby' as HpoiSearchKind,
            id: it.itemId,
            name: it.nameCN || it.name || `hpoi ${it.itemId}`,
            cover: it.cover,
            score: 0,
          }));
        }
      }
      setSearchFallback(fallback);
      setSearchHits(hits);
    } catch (err: any) {
      message.error(err?.message || '搜索失败');
      setSearchHits([]);
    } finally {
      setSearching(false);
    }
  };

  const openHit = (h: HpoiSearchHit) => {
    if (h.kind === 'hobby') {
      openCard({ itemId: h.id, name: h.name, cover: h.cover });
    } else {
      void openEntity(h.kind, h.id, h.name);
    }
  };

  const openAlbum = async (album: HpoiAlbum, push = true) => {
    if (push) navRef.current.pushCurrent();
    setSelected(null);
    setDetail(null);
    setEntity(null);
    setRelated(null);
    setAlbumSel(album);
    setAlbumDetail(null);
    setAlbumPics([]);
    setPicsLoading(true);
    try {
      ensureCookie();
      const d = await fetchAlbumDetail(album.itemId);
      setAlbumDetail(d);
      setAlbumPics(d.pics);
    } catch (err: any) {
      message.error(err?.message || '加载相册失败');
    } finally {
      setPicsLoading(false);
    }
  };

  // ---- 内部导航栈（返回用） ----
  const currentView = (): IntelView | null => {
    if (selected) return { kind: 'detail', item: selected };
    if (albumSel) return { kind: 'album', item: albumSel };
    if (related) return { kind: 'related', related };
    if (entity)
      return {
        kind: 'entity',
        type: entity.type,
        id: entity.id,
        name: entity.name,
      };
    return null;
  };
  const clearViews = () => {
    setSelected(null);
    setDetail(null);
    setAlbumSel(null);
    setEntity(null);
    setRelated(null);
  };
  const pushCurrent = () => {
    const v = currentView();
    if (v) navStackRef.current.push(v);
  };
  const restore = (v: IntelView) => {
    clearViews();
    if (v.kind === 'detail') void openItem(v.item, false);
    else if (v.kind === 'entity') void openEntity(v.type, v.id, v.name, false);
    else if (v.kind === 'album') void openAlbum(v.item, false);
    else if (v.kind === 'related') setRelated(v.related);
  };
  navRef.current = { pushCurrent, restore };

  const jumpRelated = (source: 'moeyo' | 'figmemo', postId: string) => {
    useRouteStore.getState().openArticle(source, postId, {
      page: 'intel',
      postId: selected ? String(selected.itemId) : undefined,
    });
  };

  const openRelated = (r: IntelRelated) => {
    if (r.items.length === 1) {
      jumpRelated(r.source, r.items[0].postId);
      return;
    }
    pushCurrent();
    setSelected(null);
    setDetail(null);
    setAlbumSel(null);
    setEntity(null);
    setRelated(r);
  };

  /** 「返回主页」：直接回到 hpoi 列表页（清空导航栈与所有子视图） */
  const goHome = () => {
    navStackRef.current = [];
    clearViews();
  };

  /** 「返回」：本地栈非空回上一视图；空栈则跨页返回或回列表 */
  const goBack = () => {
    const stack = navStackRef.current;
    if (stack.length > 0) {
      restore(stack.pop()!);
      return;
    }
    const prev = useRouteStore.getState().popHistory();
    if (prev) {
      if (prev.postId) {
        useRouteStore.getState().openArticle(prev.page, prev.postId, null);
        return;
      }
      const r = ROUTES.find((x) => x.id === prev.page);
      if (r) useRouteStore.getState().setRoute(r);
      return;
    }
    clearViews();
  };

  // 响应时间流「查看正文」：pendingArticle.page === 'intel'
  const pendingArticle = useRouteStore((s) => s.pendingArticle);
  useEffect(() => {
    if (!pendingArticle || pendingArticle.page !== 'intel') return;
    const itemId = Number(pendingArticle.postId);
    if (!itemId) return;
    useRouteStore.getState().clearPendingArticle();
    setTab('intel');
    const found = items.find((x) => x.itemId === itemId);
    void openItem(
      found || {
        itemId,
        categoryName: '',
        eventType: 'all',
        eventLabel: '',
        timeText: '',
        title: `hpoi ${itemId}`,
        shortName: '',
        url: `https://www.hpoi.net/hobby/${itemId}`,
      },
    );
  }, [pendingArticle, items, openItem]);

  // ---------------- 词条详情视图 ----------------
  if (selected) {
    return (
      <div className="flex flex-col h-screen">
        <div className="flex items-center gap-2 pt-6 pb-3">
          <Button icon={<ArrowLeftOutlined />} onClick={goBack}>
            返回
          </Button>
          <Button icon={<HomeOutlined />} onClick={goHome}>
            返回主页
          </Button>
          <Button
            icon={<ExportOutlined />}
            onClick={() => openUrl(selected.url)}
          >
            在浏览器打开
          </Button>
        </div>
        <div className="grow overflow-y-auto pb-8">
          {detailLoading ? (
            <div className="flex justify-center py-16">
              <Spin />
            </div>
          ) : !detail ? (
            <Empty description="没有读取到词条信息" />
          ) : (
            <HpoiDetailView
              detail={detail}
              onOpenAlbum={(a) =>
                void openAlbum({ itemId: a.id, name: a.name } as HpoiAlbum)
              }
              onOpenRef={(r) => void openEntity(r.type, r.id, r.name)}
              onOpenRelated={openRelated}
            />
          )}
        </div>
        {/* 右下角：收藏 + 下载 */}
        <FloatBar>
          <FavFloat kind="hobby" id={selected.itemId} />
          <DownloadFloat
            title={detail?.nameCN || `hpoi ${selected.itemId}`}
            getImages={() => detail?.images || []}
          />
        </FloatBar>
      </div>
    );
  }

  // ---------------- 相册详情视图 ----------------
  if (albumSel) {
    const d = albumDetail;
    const pics =
      albumPics.length > 0
        ? albumPics
        : albumExh?.list?.[0]
          ? [albumExh.list[0]]
          : [];
    return (
      <div className="flex flex-col h-screen">
        <div className="flex items-center gap-2 pt-6 pb-3">
          <Button icon={<ArrowLeftOutlined />} onClick={goBack}>
            返回
          </Button>
          <Button icon={<HomeOutlined />} onClick={goHome}>
            返回主页
          </Button>
          <Button
            icon={<ExportOutlined />}
            onClick={() => openUrl(hpoiAlbumUrl(albumSel.itemId))}
          >
            在浏览器打开
          </Button>
        </div>
        <div className="grow overflow-y-auto pb-8">
          <div className="mx-auto w-full max-w-[980px]">
            {/* 头部：左=标题/信息/作者，右=关联条目 */}
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-semibold leading-snug text-gray-900">
                  {d?.name || albumSel.name}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                  {d?.hits != null && <span>浏览 {d.hits}</span>}
                  {d?.addTime && <span>{d.addTime}</span>}
                  {!!d?.r18 && <span className="text-red-500">R18</span>}
                </div>
                {d?.user && (
                  <div className="mt-3 flex items-center gap-2">
                    <HpoiAvatar
                      src={hpoiAvatarUrl(d.user.header)}
                      name={d.user.nickname}
                      size={28}
                    />
                    <span className="text-sm text-gray-700">
                      {d.user.nickname || '匿名'}
                    </span>
                    {d.user.userId != null && (
                      <a
                        className="cursor-pointer text-xs text-ant-color-primary hover:underline"
                        onClick={() =>
                          openUrl(`${HPOI_SITE}/user/${d.user!.userId}`)
                        }
                      >
                        主页
                      </a>
                    )}
                  </div>
                )}
              </div>
              {d && d.refs.length > 0 && (
                <div className="w-[230px] shrink-0">
                  <div className="mb-1.5 text-xs text-gray-400">关联条目</div>
                  <div className="space-y-2">
                    {d.refs.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        title={r.name}
                        onClick={() =>
                          openCard({
                            itemId: r.id,
                            name: r.name,
                            cover: r.cover,
                          })
                        }
                        className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left transition-colors hover:border-gray-300 hover:shadow-sm"
                      >
                        <span className="h-11 w-11 shrink-0 overflow-hidden rounded bg-gray-50">
                          <HpoiImg
                            src={hpoiAnyCoverUrl(r.cover)}
                            className="h-full w-full object-cover"
                            wrapperClassName="h-full w-full"
                          />
                        </span>
                        <span className="min-w-0 flex-1 line-clamp-2 text-xs leading-snug text-gray-700">
                          {r.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ExHobby 实物图（无图不显示） */}
            {albumExh && albumExh.list.length > 0 && (
              <section className="mt-7">
                <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                  ExHobby 实物图
                  {albumExh.url && (
                    <a
                      className="cursor-pointer text-xs font-normal text-ant-color-primary hover:underline"
                      onClick={() => openUrl(albumExh.url!)}
                    >
                      更多
                    </a>
                  )}
                </h2>
                <Image.PreviewGroup>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                    {albumExh.list.map((url) => (
                      <HpoiImg
                        key={url}
                        src={url}
                        className="aspect-square w-full rounded-md object-cover"
                      />
                    ))}
                  </div>
                </Image.PreviewGroup>
              </section>
            )}

            {/* 正文 */}
            {d?.body && (
              <section className="mt-7">
                <p className="whitespace-pre-wrap text-[15px] leading-7 text-gray-800">
                  {d.body}
                </p>
              </section>
            )}

            {/* 图片 */}
            {picsLoading ? (
              <div className="flex justify-center py-8">
                <Spin />
              </div>
            ) : pics.length > 0 ? (
              <section className="mt-7">
                <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                  图片（{pics.length}）
                  {albumPics.length === 0 && (
                    <span className="text-xs font-normal text-gray-400">
                      正文无图，取 ExHobby 首图作封面
                    </span>
                  )}
                </h2>
                <Image.PreviewGroup>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                    {pics.map((url) => (
                      <HpoiImg
                        key={url}
                        src={url}
                        className="aspect-square w-full rounded-md object-cover"
                      />
                    ))}
                  </div>
                </Image.PreviewGroup>
              </section>
            ) : null}
          </div>
        </div>
        {/* 右下角：下载相册图片 */}
        <FloatBar>
          <DownloadFloat
            title={d?.name || albumSel.name}
            getImages={() => pics}
          />
        </FloatBar>
      </div>
    );
  }

  // ---------------- 关联文章选择视图（moeyo / fig-memo） ----------------
  if (related) {
    const label = related.source === 'moeyo' ? 'moeyo' : 'fig-memo';
    return (
      <div className="flex flex-col h-screen">
        <div className="flex items-center gap-2 pt-6 pb-3">
          <Button icon={<ArrowLeftOutlined />} onClick={goBack}>
            返回
          </Button>
          <Button icon={<HomeOutlined />} onClick={goHome}>
            返回主页
          </Button>
          <span className="truncate text-sm">
            关联的 {label} 文章（{related.items.length}）
          </span>
        </div>
        <div className="grow overflow-y-auto pb-8">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {related.items.map((it) => (
              <li
                key={it.postId}
                className="bg-white rounded-md border-[1px] overflow-hidden cursor-pointer hover:shadow-sm"
                onClick={() => jumpRelated(related.source, it.postId)}
              >
                <div className="aspect-video bg-gray-50">
                  <HpoiImg
                    src={it.coverUrl}
                    className="w-full h-full object-cover"
                    wrapperClassName="w-full h-full"
                  />
                </div>
                <div className="p-2 text-sm line-clamp-2 h-10">
                  {it.title || `#${it.postId}`}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // ---------------- 实体页视图（厂商 / 作品 / 角色 / 原型） ----------------
  if (entity) {
    return (
      <div className="flex flex-col h-screen">
        <div className="flex items-center gap-2 pt-6 pb-3">
          <Button icon={<ArrowLeftOutlined />} onClick={goBack}>
            返回
          </Button>
          <Button icon={<HomeOutlined />} onClick={goHome}>
            返回主页
          </Button>
          <Button
            icon={<ExportOutlined />}
            onClick={() => openUrl(`${HPOI_SITE}/${entity.type}/${entity.id}`)}
          >
            在浏览器打开
          </Button>
          <span className="truncate text-sm">
            {ENTITY_LABEL[entity.type]}：{entity.name}
          </span>
          {entity.type === 'company' && (
            <Segmented
              className="ml-auto"
              value={entityTab}
              onChange={(v) => setEntityTab(v as 'products' | 'series')}
              options={[
                { label: '产品', value: 'products' },
                { label: `系列（${seriesCards.length}）`, value: 'series' },
              ]}
            />
          )}
        </div>

        {entityLocal !== null && entityTab === 'products' && (
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <Select
              value={entityLocalCat}
              style={{ width: 150 }}
              onChange={(v) => {
                setEntityLocalCat(v);
                setEntityLocalPage(1);
              }}
              options={[
                { label: `全部（${entityLocal.length}）`, value: '' },
                ...entityLocalCats.map(([c, n]) => ({
                  label: `${c}（${n}）`,
                  value: c,
                })),
              ]}
            />
            {entity.type === 'company' ? (
              entityLocalWorks.length > 0 && (
                <MakerPicker
                  label="作品："
                  value={entityLocalWork}
                  options={entityLocalWorks.map((w) => ({
                    name: w.name,
                    id: w.id,
                    count: w.count,
                    cover: w.cover,
                  }))}
                  onChange={(v) => {
                    setEntityLocalWork(v == null ? null : Number(v));
                    setEntityLocalPage(1);
                  }}
                />
              )
            ) : (
              <MakerPicker
                value={entityLocalCompany}
                options={entityLocalCompanies}
                onChange={(v) => {
                  setEntityLocalCompany(v == null ? null : String(v));
                  setEntityLocalPage(1);
                }}
              />
            )}
            {entityLocalYears.length > 0 && (
              <Select
                value={entityLocalYear ?? ''}
                style={{ width: 120 }}
                onChange={(v) => {
                  setEntityLocalYear(v || null);
                  setEntityLocalPage(1);
                }}
                options={[
                  { label: '年份：全部', value: '' },
                  ...entityLocalYears.map(([y, n]) => ({
                    label: `${y}（${n}）`,
                    value: y,
                  })),
                ]}
              />
            )}
            {entity.type !== 'company' && entityLocalChars.length > 0 && (
              <MakerPicker
                label="角色："
                value={entityLocalChar}
                options={entityLocalChars.map((c) => ({
                  name: c.name,
                  id: c.id,
                  count: c.count,
                  cover: c.cover,
                }))}
                onChange={(v) => {
                  setEntityLocalChar(v == null ? null : Number(v));
                  setEntityLocalPage(1);
                }}
              />
            )}
            <Segmented
              value={entityLocalOrder}
              onChange={(v) => {
                setEntityLocalOrder(v as typeof entityLocalOrder);
                setEntityLocalPage(1);
              }}
              options={ENTITY_LOCAL_ORDERS}
            />
            <span className="text-xs text-gray-400">
              本地种子 · 共 {entityLocalView.length} 件
            </span>
            <Segmented
              className="ml-auto"
              value={entityView}
              onChange={(v) => setEntityView(v as 'detail' | 'compact')}
              options={[
                { label: '详细', value: 'detail' },
                { label: '简略', value: 'compact' },
              ]}
            />
          </div>
        )}

        {entityLocal === null &&
          entity.type === 'company' &&
          entityTab === 'products' && (
            <div className="flex flex-wrap items-center gap-2 pb-3">
              <Select
                value={productCategory}
                options={CATEGORY_OPTIONS}
                style={{ width: 140 }}
                onChange={(v) => {
                  setProductCategory(v);
                  void reloadProducts(v, productOrder);
                }}
              />
              <Segmented
                value={productOrder}
                onChange={(v) => {
                  const o = v as HpoiOrder;
                  setProductOrder(o);
                  void reloadProducts(productCategory, o);
                }}
                options={(Object.keys(HPOI_ORDER_LABEL) as HpoiOrder[]).map(
                  (o) => ({ label: HPOI_ORDER_LABEL[o], value: o }),
                )}
              />
              <span className="text-xs text-gray-400">
                按厂商筛选 · 已加载 {products.length} 件
              </span>
            </div>
          )}

        <div className="grow overflow-y-auto pb-8">
          {entityLocal !== null ? (
            entity.type === 'company' && entityTab === 'series' ? (
              seriesLoading ? (
                <SpinCenter />
              ) : seriesCards.length === 0 ? (
                <Empty description="没有找到系列" />
              ) : (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                  {seriesCards.map((s) => (
                    <li
                      key={s.id}
                      className="bg-white rounded-md border-[1px] overflow-hidden cursor-pointer hover:shadow-sm"
                      onClick={() => void openEntity('series', s.id, s.name)}
                    >
                      <div className="aspect-square bg-gray-50">
                        <HpoiImg
                          src={hpoiAnyCoverUrl(s.cover)}
                          className="w-full h-full object-cover"
                          wrapperClassName="w-full h-full"
                        />
                      </div>
                      <div className="p-2 text-xs line-clamp-2 h-8">
                        {s.name}
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : entityLoading ? (
              <SpinCenter />
            ) : entityLocalView.length === 0 ? (
              <Empty description="没有找到作品" />
            ) : entityView === 'compact' ? (
              <ThumbGrid
                cards={entityLocalPageItems.map((h) => ({
                  itemId: h.id,
                  name: h.name,
                  cover: h.cover,
                }))}
                onOpen={openCard}
              />
            ) : (
              <SearchGrid hits={entityLocalPageItems} onOpen={openHit} />
            )
          ) : entity.type !== 'company' ? (
            entityLoading ? (
              <SpinCenter />
            ) : entityCards.length === 0 ? (
              <Empty description="没有找到作品" />
            ) : (
              <HobbyGrid cards={entityCards} onOpen={openCard} />
            )
          ) : entityTab === 'series' ? (
            seriesLoading ? (
              <SpinCenter />
            ) : seriesCards.length === 0 ? (
              <Empty description="没有找到系列" />
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                {seriesCards.map((s) => (
                  <li
                    key={s.id}
                    className="bg-white rounded-md border-[1px] overflow-hidden cursor-pointer hover:shadow-sm"
                    onClick={() => void openEntity('series', s.id, s.name)}
                  >
                    <div className="aspect-square bg-gray-50">
                      <HpoiImg
                        src={hpoiAnyCoverUrl(s.cover)}
                        className="w-full h-full object-cover"
                        wrapperClassName="w-full h-full"
                      />
                    </div>
                    <div className="p-2 text-xs line-clamp-2 h-8">{s.name}</div>
                  </li>
                ))}
              </ul>
            )
          ) : productsLoading && products.length === 0 ? (
            <SpinCenter />
          ) : products.length === 0 ? (
            <Empty description="没有找到产品" />
          ) : (
            <>
              <HobbyGrid cards={products} onOpen={openCard} />
              <div className="flex justify-center mt-4">
                <Button loading={productsLoading} onClick={loadMoreProducts}>
                  加载更多
                </Button>
              </div>
            </>
          )}
        </div>
        {entityLocal !== null &&
          entityTab === 'products' &&
          entityLocalView.length > 0 && (
            <div className="shrink-0 flex items-center justify-center gap-3 border-t-[1px] border-gray-100 bg-white py-2">
              <Pagination
                current={entityLocalPage}
                pageSize={ENTITY_PAGE_SIZE}
                total={entityLocalView.length}
                showSizeChanger={false}
                showQuickJumper
                onChange={(p) => setEntityLocalPage(p)}
              />
            </div>
          )}
        {/* 右下角：收藏 */}
        <FloatBar>
          <FavFloat kind={entity.type} id={entity.id} />
        </FloatBar>
      </div>
    );
  }

  // ---------------- 列表视图（情报 / 相册） ----------------
  const intelTab = (
    <div
      className="grow overflow-y-auto pb-6"
      onScroll={(e) => {
        if (cursor && !loadingMore && isNearBottom(e.currentTarget))
          void loadMore();
      }}
    >
      {loading ? (
        <div className="flex justify-center py-16">
          <Spin />
        </div>
      ) : items.length === 0 ? (
        <Empty description="暂无情报" />
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((it) => (
              <li
                key={it.itemId}
                className="flex items-center gap-3 bg-white rounded-md border-[1px] p-3 cursor-pointer hover:shadow-sm"
                onClick={() => openItem(it)}
              >
                <HpoiImg
                  src={hpoiCoverUrl(it.cover, 's')}
                  width={56}
                  height={56}
                  className="object-cover rounded-md shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Tag color="blue">{it.eventLabel}</Tag>
                    <span className="text-xs text-gray-400">{it.timeText}</span>
                  </div>
                  <p className="truncate">{it.title || it.shortName}</p>
                  {it.shortName && it.title && (
                    <p className="text-sm text-gray-400 truncate">
                      {it.shortName}
                    </p>
                  )}
                </div>
                <Tag>{it.categoryName || '手办'}</Tag>
              </li>
            ))}
          </ul>
          {cursor && (
            <div className="flex justify-center py-4">
              {loadingMore && <Spin size="small" />}
            </div>
          )}
        </>
      )}
    </div>
  );

  const albumTab = (
    <div
      className="grow overflow-y-auto pb-6"
      onScroll={(e) => {
        if (albumHasMore && !albumLoading && isNearBottom(e.currentTarget))
          void loadAlbums(false);
      }}
    >
      {/* 分类按钮（平铺一行，不用下拉） */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {HPOI_ALBUM_CATEGORY_GROUPS.map((g, gi) => (
          <React.Fragment key={g.label}>
            {gi > 0 && <span className="h-4 w-px bg-gray-200" />}
            <Segmented
              value={albumCategory}
              onChange={(v) => {
                const id = v as number;
                setAlbumCategory(id);
                setAlbums([]);
                setAlbumPage(0);
                void loadAlbums(true, id);
              }}
              options={g.items}
            />
          </React.Fragment>
        ))}
        <Button
          icon={<ReloadOutlined />}
          loading={albumLoading}
          onClick={() => loadAlbums(true)}
        >
          刷新
        </Button>
        <span className="text-xs text-gray-400">
          登录后可访问 R18（设置 → 站点 → hpoi）
        </span>
      </div>
      {albumLoading && albums.length === 0 ? (
        <div className="flex justify-center py-16">
          <Spin />
        </div>
      ) : albums.length === 0 ? (
        <Empty description="暂无相册" />
      ) : (
        <>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {albums.map((a) => (
              <li
                key={a.itemId}
                className="bg-white rounded-md border-[1px] overflow-hidden cursor-pointer hover:shadow-sm group"
                onClick={() => openAlbum(a)}
              >
                <div className="relative aspect-square bg-gray-50">
                  <HpoiImg
                    src={hpoiAlbumCoverUrl(a.cover, 's')}
                    className="w-full h-full object-cover"
                    wrapperClassName="w-full h-full"
                  />
                  {!!a.r18 && (
                    <span className="absolute top-1 left-1 rounded bg-red-500 px-1 text-[10px] text-white">
                      R18
                    </span>
                  )}
                  {a.picCount != null && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[10px] text-white">
                      {a.picCount} 图
                    </span>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs line-clamp-2 h-8">{a.name}</p>
                  <p className="text-[11px] text-gray-400 truncate">
                    {a.user?.nickname || ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {albumHasMore && (
            <div className="flex justify-center py-4">
              {albumLoading && <Spin size="small" />}
            </div>
          )}
        </>
      )}
    </div>
  );

  const favTab = (
    <div className="grow overflow-y-auto pb-8">
      {favLoading ? (
        <SpinCenter />
      ) : favIds.length === 0 ? (
        <Empty description="还没有收藏（词条 / 厂商 / 作品 / 角色…点心形即可）" />
      ) : (
        favData.map((g) => (
          <div key={g.kind} className="mb-5">
            <h3 className="mb-2 font-medium">
              {SEARCH_KIND_LABEL[g.kind]}（{g.hits.length}）
            </h3>
            {g.hits.length === 0 ? (
              <p className="text-xs text-gray-400">
                有收藏但不在离线索引中（可能是新条目，可先「更新词条库」）
              </p>
            ) : (
              <SearchGrid hits={g.hits} onOpen={openHit} />
            )}
          </div>
        ))
      )}
    </div>
  );

  const grouped: Partial<Record<HpoiSearchKind, HpoiSearchHit[]>> = {};
  for (const h of searchHits || []) {
    (grouped[h.kind] ||= []).push(h);
  }
  const kindOrder = SEARCH_KIND_ORDER.filter((k) => grouped[k]?.length);
  const isSearchHobby = searchKind === 'hobby';

  const searchCats = (() => {
    const m = new Map<string, number>();
    for (const h of grouped.hobby || []) {
      const c = h.category || '其他';
      m.set(c, (m.get(c) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const searchCompanies: MakerOption[] = (() => {
    const m = new Map<string, number>();
    for (const h of grouped.hobby || []) {
      const c = (h.companyName || '').trim();
      if (c) m.set(c, (m.get(c) || 0) + 1);
    }
    return [...m.entries()].map(([name, count]) => ({ name, id: name, count }));
  })();
  const searchYears = (() => {
    const m = new Map<string, number>();
    for (const h of grouped.hobby || []) {
      const y = (h.releaseDate || '').slice(0, 4);
      if (/^\d{4}$/.test(y)) m.set(y, (m.get(y) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  })();

  const hitSortVal = (h: HpoiSearchHit) =>
    searchSort === 'add'
      ? h.id
      : searchSort === 'rating'
        ? h.rating || 0
        : searchSort === 'hits7Day'
          ? h.hits7Day || 0
          : searchSort === 'hitsDay'
            ? h.hitsDay || 0
            : h.hits || 0;

  const hobbyView = (grouped.hobby || []).filter((h) => {
    if (searchCat && (h.category || '其他') !== searchCat) return false;
    if (searchCompany && (h.companyName || '').trim() !== searchCompany)
      return false;
    if (searchYear && (h.releaseDate || '').slice(0, 4) !== searchYear)
      return false;
    return true;
  });
  hobbyView.sort((a, b) =>
    searchSort === 'release'
      ? String(b.releaseDate || '').localeCompare(
          String(a.releaseDate || ''),
        ) || b.id - a.id
      : hitSortVal(b) - hitSortVal(a) || b.id - a.id,
  );

  const searchView: HpoiSearchHit[] = isSearchHobby
    ? hobbyView
    : grouped[searchKind] || [];
  const searchPageItems = searchView.slice(
    (searchPage - 1) * SEARCH_PAGE_SIZE,
    searchPage * SEARCH_PAGE_SIZE,
  );

  const searchResults = (
    <div className="grow overflow-y-auto pb-8">
      {searching ? (
        <SpinCenter />
      ) : (searchHits || []).length === 0 ? (
        <Empty description="没有找到（先跑 scripts\build-hpoi-index.cmd 生成离线索引）" />
      ) : (
        <>
          {searchFallback && (
            <p className="text-xs text-gray-400 mb-2">
              本地索引无结果 → 在线搜索结果
            </p>
          )}
          {/* 分类标签（周边 / 角色 / 作品 / 系列 / 人物 / 厂商） */}
          <div className="mt-1 mb-2 flex flex-wrap items-center gap-2">
            {kindOrder.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setSearchKind(k);
                  setSearchPage(1);
                }}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  searchKind === k
                    ? 'border-ant-color-primary text-ant-color-primary font-medium'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {SEARCH_KIND_LABEL[k]}（{grouped[k]!.length}）
              </button>
            ))}
          </div>
          {/* 周边：筛选 + 排序 */}
          {isSearchHobby && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Select
                value={searchCat}
                style={{ width: 150 }}
                onChange={(v) => {
                  setSearchCat(v);
                  setSearchPage(1);
                }}
                options={[
                  {
                    label: `全部类别（${(grouped.hobby || []).length}）`,
                    value: '',
                  },
                  ...searchCats.map(([c, n]) => ({
                    label: `${c}（${n}）`,
                    value: c,
                  })),
                ]}
              />
              <MakerPicker
                value={searchCompany}
                options={searchCompanies}
                onChange={(v) => {
                  setSearchCompany(v == null ? null : String(v));
                  setSearchPage(1);
                }}
              />
              {searchYears.length > 0 && (
                <Select
                  value={searchYear ?? ''}
                  style={{ width: 120 }}
                  onChange={(v) => {
                    setSearchYear(v || null);
                    setSearchPage(1);
                  }}
                  options={[
                    { label: '年份：全部', value: '' },
                    ...searchYears.map(([y, n]) => ({
                      label: `${y}（${n}）`,
                      value: y,
                    })),
                  ]}
                />
              )}
              <Segmented
                value={searchSort}
                onChange={(v) => {
                  setSearchSort(v as typeof searchSort);
                  setSearchPage(1);
                }}
                options={SEARCH_SORT_OPTIONS}
              />
              <span className="text-xs text-gray-400">
                共 {searchView.length} 件
              </span>
            </div>
          )}
          {searchPageItems.length === 0 ? (
            <Empty description="没有符合筛选的条目" />
          ) : (
            <SearchGrid hits={searchPageItems} onOpen={openHit} />
          )}
          {searchView.length > SEARCH_PAGE_SIZE && (
            <div className="flex justify-center py-4">
              <Pagination
                current={searchPage}
                pageSize={SEARCH_PAGE_SIZE}
                total={searchView.length}
                showSizeChanger={false}
                showQuickJumper
                onChange={setSearchPage}
              />
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-screen">
      <div className="shrink-0 pb-3">
        <PageHeader />
        <div>
          <Input.Search
            allowClear
            enterButton="搜索"
            loading={searching}
            placeholder="搜索 hpoi：词条 / 厂商 / 系列 / 作品 / 角色 / 原型"
            value={searchQ}
            onChange={(e) => {
              setSearchQ(e.target.value);
              if (!e.target.value) {
                setSearchHits(null);
                setSearchFallback(false);
              }
            }}
            onSearch={(v) => void onSearch(v)}
          />
        </div>
        {searchHits === null && (
          <div className="shrink-0 flex flex-wrap items-center gap-2 mt-2">
            <Segmented
              value={tab}
              onChange={(v) => setTab(v as string)}
              options={[
                { label: '情报', value: 'intel' },
                { label: '相册', value: 'album' },
                { label: '收藏', value: 'fav' },
              ]}
            />
            {tab === 'intel' && (
              <>
                <Select
                  value={categoryId}
                  options={CATEGORY_OPTIONS}
                  onChange={setCategoryId}
                  style={{ width: 140 }}
                />
                <Segmented
                  value={subType}
                  options={SUB_OPTIONS}
                  onChange={(v) => setSubType(v as HpoiIntelSubType)}
                />
                <Button
                  icon={<ReloadOutlined />}
                  loading={loading}
                  onClick={() => void refreshIntelAll()}
                  className="ml-auto"
                >
                  刷新
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {searchHits !== null
        ? searchResults
        : tab === 'intel'
          ? intelTab
          : tab === 'album'
            ? albumTab
            : favTab}
    </div>
  );
};
