/* eslint-disable react/prop-types */
import {
  ArrowLeftOutlined,
  CopyOutlined,
  DownloadOutlined,
  ExportOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Dropdown,
  Empty,
  Image,
  Input,
  MenuProps,
  Spin,
  Tag,
} from 'antd';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CategorySidebar } from '../components/figmemo/CategorySidebar';
import { PageHeader } from '../components/PageHeader';
import { PlatformMedia } from '../platforms';
import {
  FigmemoListItem,
  fetchPostDetail,
  fetchPostImages,
  listSitePosts,
  saveFigmemoPost,
  setArticleTags,
} from '../services/figmemo';
import { useFigmemoStore } from '../stores/figmemo';
import { useFigmemoTagsStore } from '../stores/figmemo-tags';
import {
  DEFAULT_LIBRARY_FILTER,
  LibraryFilter,
  buildTagIndex,
  matchesFilter,
  tagCoveredSet,
} from '../utils/library';
import { toAssetUrl } from '../utils/asset';
import { copyImageUrlToClipboard } from '../utils/clipboard';
import { openUrl } from '../utils/shell';

interface PostDetail {
  title: string;
  contentHtml: string;
  link: string;
}

/** 文章级标签分组（可后续扩充；可选值之外还能自定义） */
const TAG_GROUPS: { key: string; options: string[] }[] = [
  { key: '姿势', options: ['站姿', '蹲姿', '坐姿'] },
  { key: '发型', options: ['长发', '短发', '特殊发型'] },
  { key: '体型', options: ['幼女', '成女', '熟女'] },
];

/** fig-memo：标签树筛选 + 本地文章列表 + 网页式详情 */
export const FigmemoPage: React.FC = () => {
  const { message } = App.useApp();
  const tags = useFigmemoTagsStore((s) => s.tags);
  const index = useMemo(() => buildTagIndex(tags), [tags]);

  const [filter, setFilter] = useState<LibraryFilter>(DEFAULT_LIBRARY_FILTER);
  const [items, setItems] = useState<FigmemoListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');

  const [selected, setSelected] = useState<FigmemoListItem | null>(null);
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [images, setImages] = useState<PlatformMedia[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [customInput, setCustomInput] = useState('');
  const [tagSaving, setTagSaving] = useState(false);

  const relOf = (item: FigmemoListItem) => `fig-memo/${item.folderName}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const enabledCategories = useFigmemoStore.getState().enabledCategories;
      setItems(await listSitePosts(enabledCategories));
    } catch (err: any) {
      log.error(err);
      message.error(err?.message || '读取文章列表失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    load();
  }, [load]);

  const openPost = async (item: FigmemoListItem) => {
    setSelected(item);
    setDetail(null);
    setImages([]);
    setDetailLoading(true);
    try {
      const [d, imgs] = await Promise.all([
        fetchPostDetail(item.postId),
        fetchPostImages(item.postId).catch(() => [] as PlatformMedia[]),
      ]);
      setDetail(d);
      setImages(imgs);
    } catch (err: any) {
      log.error(err);
      message.error(err?.message || '读取文章详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const savePost = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const n = await saveFigmemoPost(selected);
      if (n > 0) {
        message.success(`已加入下载队列（${n} 个附件）`);
      } else {
        message.info('该文章没有可下载的图片');
      }
      await load();
    } catch (err: any) {
      message.error(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const applyArticleTags = async (next: Record<string, string[]>) => {
    if (!selected) return;
    const clean: Record<string, string[]> = {};
    for (const [g, vs] of Object.entries(next)) {
      const arr = (vs || []).filter(Boolean);
      if (arr.length) clean[g] = arr;
    }
    setSelected({ ...selected, articleTags: clean });
    setTagSaving(true);
    try {
      await setArticleTags(selected, clean);
    } catch (err: any) {
      message.error(err?.message || '标签保存失败');
    } finally {
      setTagSaving(false);
    }
  };

  const toggleArticleTag = (group: string, value: string) => {
    const cur = selected?.articleTags || {};
    const list = cur[group] || [];
    const next = { ...cur };
    next[group] = list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
    if (next[group].length === 0) delete next[group];
    applyArticleTags(next);
  };

  const addCustomTag = (group: string, value: string) => {
    const v = value.trim();
    if (!v) return;
    const cur = selected?.articleTags || {};
    const list = cur[group] || [];
    if (!list.includes(v)) applyArticleTags({ ...cur, [group]: [...list, v] });
    setCustomInput('');
  };

  const counts = useMemo(() => {
    const byId: Record<string, number> = {};
    for (const t of tags) {
      const covered = tagCoveredSet(index, t.id);
      byId[t.id] = items.filter((it) => covered.has(relOf(it))).length;
    }
    const unclassified = items.filter(
      (it) =>
        useFigmemoTagsStore.getState().getFolderTagIds(relOf(it)).length === 0,
    ).length;
    return { all: items.length, unclassified, byId };
  }, [tags, index, items]);

  const filtered = useMemo(() => {
    let list = items;
    if (filter.kind === 'tags') {
      list = list.filter((it) =>
        matchesFilter(index, filter.tagIds, filter.rule, relOf(it)),
      );
    } else if (filter.kind === 'unclassified') {
      list = list.filter(
        (it) =>
          useFigmemoTagsStore.getState().getFolderTagIds(relOf(it)).length ===
          0,
      );
    }
    const kw = keyword.trim().toLowerCase();
    if (kw) list = list.filter((it) => it.title.toLowerCase().includes(kw));
    return list;
  }, [items, filter, index, keyword]);

  const imageMenu = (media: PlatformMedia): MenuProps => ({
    items: [
      { key: 'copy', label: '复制图片到剪贴板', icon: <CopyOutlined /> },
      { key: 'copyLink', label: '复制图片链接', icon: <LinkOutlined /> },
      { key: 'openImg', label: '在浏览器打开原图', icon: <ExportOutlined /> },
    ],
    onClick: async ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (!media.url) return;
      try {
        if (key === 'copy') {
          await copyImageUrlToClipboard(media.url);
          message.success('图片已复制到剪贴板');
        } else if (key === 'copyLink') {
          await navigator.clipboard.writeText(media.url);
          message.success('图片链接已复制');
        } else if (key === 'openImg') {
          await openUrl(media.url);
        }
      } catch (err: any) {
        message.error(err?.message || '操作失败');
      }
    },
  });

  // 详情视图
  if (selected) {
    return (
      <div className="flex flex-col h-screen">
        <PageHeader />
        <div className="flex items-center gap-2 pb-3">
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => {
              setSelected(null);
              setDetail(null);
              setImages([]);
            }}
          >
            返回列表
          </Button>
          <a
            href={selected.link}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-ant-color-link"
          >
            在原站打开
          </a>
          <Button
            className="ml-auto"
            type="primary"
            icon={<DownloadOutlined />}
            loading={saving}
            onClick={savePost}
          >
            保存该文章
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto pb-10">
          <article className="bg-white rounded-md border-[1px] border-gray-200 max-w-4xl mx-auto p-6">
            <h1 className="text-2xl font-bold leading-snug">
              {selected.title}
            </h1>
            <div className="text-sm text-gray-400 mt-2 flex items-center flex-wrap gap-2">
              <span>{dayjs(selected.date).format('YYYY-MM-DD HH:mm')}</span>
              {selected.categories.map((c) => (
                <Tag key={c.id}>{c.name}</Tag>
              ))}
              {Object.entries(selected.articleTags || {}).flatMap(([g, vs]) =>
                (vs || []).map((v) => (
                  <Tag key={`${g}:${v}`} color="blue">
                    {g}·{v}
                  </Tag>
                )),
              )}
              <span>
                · {selected.imageCount} 张图 ·{' '}
                {selected.exists ? '已下载' : '未下载'}
              </span>
            </div>
            <hr className="my-4 border-gray-100" />

            {detailLoading ? (
              <div className="flex justify-center py-16">
                <Spin size="large" />
              </div>
            ) : (
              <>
                {/* 图片在上，正文在下 */}
                {images.length > 0 && (
                  <Image.PreviewGroup>
                    <ul className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
                      {images.map((m, i) => (
                        <Dropdown
                          key={`${m.id || m.url}-${i}`}
                          trigger={['contextMenu']}
                          menu={imageMenu(m)}
                        >
                          <li className="relative aspect-square bg-white rounded-md overflow-hidden border-[1px] border-gray-100 group">
                            <Image
                              src={m.url}
                              alt={m.fileName || ''}
                              loading="lazy"
                              className="object-cover w-full h-full"
                              wrapperClassName="w-full h-full"
                              preview={{ src: m.url }}
                            />
                          </li>
                        </Dropdown>
                      ))}
                    </ul>
                  </Image.PreviewGroup>
                )}
                {detail && detail.contentHtml.trim() && (
                  <div
                    className="figmemo-article"
                    // 正文来自 fig-memo 原站（可信）；已清洗 script/style/figure/a/img
                    dangerouslySetInnerHTML={{ __html: detail.contentHtml }}
                  />
                )}
                {!detail && images.length === 0 && (
                  <Empty description="正文加载失败" />
                )}
              </>
            )}
          </article>
        </div>

        {/* 右下角悬浮：文章标签（姿势/发型/体型…） */}
        <div className="fixed right-6 bottom-6 z-50 flex flex-col items-end gap-2">
          {activeGroup && (
            <div className="bg-white rounded-lg shadow-xl border-[1px] border-gray-200 p-3 w-64">
              <div className="text-sm font-medium mb-2 flex items-center">
                {activeGroup}
                {tagSaving && <Spin size="small" className="ml-2" />}
                <Button
                  type="text"
                  size="small"
                  className="ml-auto"
                  onClick={() => setActiveGroup(null)}
                >
                  收起
                </Button>
              </div>
              <div className="flex flex-wrap gap-1 mb-3">
                {Array.from(
                  new Set([
                    ...(TAG_GROUPS.find((g) => g.key === activeGroup)
                      ?.options || []),
                    ...((selected.articleTags || {})[activeGroup] || []),
                  ]),
                ).map((v) => (
                  <Tag.CheckableTag
                    key={v}
                    checked={(
                      (selected.articleTags || {})[activeGroup] || []
                    ).includes(v)}
                    onChange={() => toggleArticleTag(activeGroup, v)}
                  >
                    {v}
                  </Tag.CheckableTag>
                ))}
              </div>
              <Input.Search
                size="small"
                placeholder="自定义后回车"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onSearch={(v) => addCustomTag(activeGroup, v)}
                enterButton={<PlusOutlined />}
              />
            </div>
          )}
          <div className="flex items-center gap-2 bg-white rounded-full shadow-xl border-[1px] border-gray-200 px-2 py-1">
            {TAG_GROUPS.map((g) => (
              <Button
                key={g.key}
                size="small"
                shape="round"
                type={activeGroup === g.key ? 'primary' : 'default'}
                onClick={() => {
                  setActiveGroup(activeGroup === g.key ? null : g.key);
                  setCustomInput('');
                }}
              >
                {g.key}
              </Button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 列表视图
  return (
    <div className="flex flex-col h-screen">
      <PageHeader />
      <div className="flex-1 min-h-0 flex gap-4 pb-4">
        <CategorySidebar filter={filter} counts={counts} onChange={setFilter} />
        <section className="flex-1 min-w-0 flex flex-col" aria-label="文章列表">
          <div className="flex items-center flex-wrap gap-2 pb-3">
            <Input
              allowClear
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索标题"
              className="w-52"
            />
            <span className="text-sm text-gray-400">{filtered.length} 篇</span>
            <Button
              className="ml-auto"
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={load}
            >
              刷新
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto pb-6">
            {loading && items.length === 0 ? (
              <div className="flex justify-center py-20">
                <Spin size="large" />
              </div>
            ) : filtered.length === 0 ? (
              <Empty className="mt-16" description="暂无文章" />
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
                {filtered.map((item) => (
                  <li
                    key={item.postId}
                    className="bg-white rounded-md border-[1px] border-gray-100 overflow-hidden group cursor-pointer"
                    onClick={() => openPost(item)}
                  >
                    <div className="h-[12rem] bg-gray-100">
                      {item.coverUrl || item.coverPath ? (
                        <img
                          src={
                            item.coverUrl || toAssetUrl(item.coverPath || '')
                          }
                          alt={item.title}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              'none';
                          }}
                          className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                          无封面
                        </div>
                      )}
                    </div>
                    <div className="px-2 py-2">
                      <p
                        className="text-sm leading-snug line-clamp-2"
                        title={item.title}
                      >
                        {item.title}
                      </p>
                      <div className="text-xs text-gray-400 mt-1 flex items-center gap-1 flex-wrap">
                        <span>{dayjs(item.date).format('YYYY-MM-DD')}</span>
                        {item.categories[0] && (
                          <Tag className="!m-0 !text-xs">
                            {item.categories[0].name}
                          </Tag>
                        )}
                        <span>· {item.imageCount} 图</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
