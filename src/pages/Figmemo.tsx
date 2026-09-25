/* eslint-disable react/prop-types */
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { App, Button, Empty, Input, Select, Spin, Tag } from 'antd';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import {
  FigmemoListItem,
  fetchPostDetail,
  listLocalPosts,
} from '../services/figmemo';
import { toAssetUrl } from '../utils/asset';

interface PostDetail {
  title: string;
  contentHtml: string;
  link: string;
}

/** fig-memo：本地文章列表 + 网页式文章详情（去广告） */
export const FigmemoPage: React.FC = () => {
  const { message } = App.useApp();
  const [items, setItems] = useState<FigmemoListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState<number | 'all'>('all');

  const [selected, setSelected] = useState<FigmemoListItem | null>(null);
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listLocalPosts();
      setItems(list);
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
    setDetailLoading(true);
    try {
      const d = await fetchPostDetail(item.postId);
      setDetail(d);
    } catch (err: any) {
      log.error(err);
      message.error(err?.message || '读取文章详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const categoryOptions = useMemo(() => {
    const map = new Map<number, { id: number; name: string; count: number }>();
    for (const it of items) {
      for (const c of it.categories) {
        const e = map.get(c.id) || { id: c.id, name: c.name, count: 0 };
        e.count += 1;
        map.set(c.id, e);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (categoryId !== 'all') {
      list = list.filter((it) =>
        it.categories.some((c) => c.id === categoryId),
      );
    }
    const kw = keyword.trim().toLowerCase();
    if (kw) list = list.filter((it) => it.title.toLowerCase().includes(kw));
    return list;
  }, [items, categoryId, keyword]);

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
            ) : detail ? (
              <div
                className="figmemo-article"
                // 正文来自 fig-memo 原站（可信）；已移除 script
                dangerouslySetInnerHTML={{ __html: detail.contentHtml }}
              />
            ) : (
              <Empty description="正文加载失败" />
            )}
          </article>
        </div>
      </div>
    );
  }

  // 列表视图
  return (
    <div className="flex flex-col h-screen">
      <PageHeader />
      <div className="flex items-center flex-wrap gap-2 pb-3">
        <Input
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索标题"
          className="w-56"
        />
        <Select
          value={categoryId}
          onChange={setCategoryId}
          style={{ minWidth: 200 }}
          options={[
            { value: 'all' as const, label: `全部分类（${items.length}）` },
            ...categoryOptions.map((c) => ({
              value: c.id,
              label: `${c.name}（${c.count}）`,
            })),
          ]}
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
                  {item.coverPath ? (
                    <img
                      src={toAssetUrl(item.coverPath)}
                      alt={item.title}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                      {item.exists ? '无封面' : '未下载'}
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
    </div>
  );
};
