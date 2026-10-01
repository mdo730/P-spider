/* eslint-disable react/prop-types */
import {
  Alert,
  App,
  Avatar,
  Button,
  Checkbox,
  DatePicker,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
} from 'antd';
import {
  CheckOutlined,
  DownloadOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import React, { useCallback, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { InfiniteScroll } from '../components/InfiniteScroll';
import { GridViewItemActions } from '../components/homepage/GridViewItemActions';
import { useRemoteImageSrc } from '../hooks/useRemoteImage';
import { PlatformCreator } from '../platforms';
import { pixivImageHeaders, PixivWork, PixivWorkType } from '../services/pixiv';
import { downloadPixivWork } from '../services/pixiv-download';
import { useDownloadStore } from '../stores/download';
import { useSubscriptionStore } from '../stores/subscription';
import { usePixivStore, filterPixivWorks } from '../stores/pixiv';
import { useRouteStore } from '../stores/route';
import { useSettingsStore } from '../stores/settings';
import { ROUTES } from '../constants/routes';
import { openUrl } from '../utils/shell';
import MediaType from '../enums/MediaType';

const TYPE_OPTIONS: { label: string; value: PixivWorkType }[] = [
  { label: '插画', value: 'illust' },
  { label: '漫画', value: 'manga' },
  { label: '动图', value: 'ugoira' },
];

const TYPE_LABEL: Record<PixivWorkType, string> = {
  illust: '插画',
  manga: '漫画',
  ugoira: '动图',
};

const INTERVAL_OPTIONS = [
  { value: 60, label: '1 小时' },
  { value: 180, label: '3 小时' },
  { value: 360, label: '6 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '1 天' },
  { value: 2880, label: '2 天' },
];

/** 经后端（走代理 + Referer）拉取的缩略图，避免 i.pximg.net 防盗链裂图 */
const PixivThumb: React.FC<{ url: string; alt?: string }> = ({ url, alt }) => {
  const src = useRemoteImageSrc(url, { headers: pixivImageHeaders() });
  return (
    <img
      alt={alt || 'pixiv'}
      src={src}
      loading="lazy"
      className="object-cover w-full h-full transform transition-transform group-hover:scale-105"
    />
  );
};

export const PixivPage: React.FC = () => {
  const { message } = App.useApp();
  const refreshToken = useSettingsStore((s) => s.pixiv?.refreshToken);
  const {
    keyword,
    setKeyword,
    filter,
    setFilter,
    userInfo,
    works,
    loading,
    loadingMore,
    hasMore,
    loadUser,
  } = usePixivStore();
  const [downloading, setDownloading] = useState(false);
  const { addSubscription, removeSubscription, subscriptions } =
    useSubscriptionStore();
  const [subInterval, setSubInterval] = useState(720);
  const [subscribing, setSubscribing] = useState(false);
  const existingSub = userInfo.data
    ? subscriptions.find(
        (s) => s.source === 'pixiv' && s.username === userInfo.data!.id,
      )
    : undefined;
  const onUnsubscribe = () => {
    if (!existingSub) return;
    removeSubscription(existingSub.id);
    message.success('已取消订阅该画师');
  };
  // pixiv 头像也走 Referer（i.pximg.net 防盗链）
  const avatarSrc = useRemoteImageSrc(userInfo.data?.avatar, {
    headers: pixivImageHeaders(),
  });

  const onSubscribe = async () => {
    const user = userInfo.data;
    if (!user) return;
    // 订阅按「下载配置 → 作品类型」的勾选走
    if (filter.types.length === 0) {
      message.error('请先在「下载配置 → 作品类型」至少勾选一种');
      return;
    }
    setSubscribing(true);
    try {
      const r = await addSubscription({
        source: 'pixiv',
        username: user.id,
        intervalMin: subInterval,
        mediaTypes: [MediaType.Photo],
        workTypes: filter.types,
        observe: false,
      });
      message.success(
        r === 'updated'
          ? '已更新该画师的订阅间隔'
          : `已订阅该画师，每 ${
              INTERVAL_OPTIONS.find((o) => o.value === subInterval)?.label ||
              `${subInterval} 分钟`
            }检查一次新作品`,
      );
    } catch (err: any) {
      message.error(err?.message || '订阅失败');
    } finally {
      setSubscribing(false);
    }
  };

  const onObserve = async () => {
    const user = userInfo.data;
    if (!user) return;
    setSubscribing(true);
    try {
      const r = await addSubscription({
        source: 'pixiv',
        username: user.id,
        intervalMin: subInterval,
        mediaTypes: [MediaType.Photo],
        workTypes: filter.types.length ? filter.types : ['illust', 'ugoira'],
        observe: true,
      });
      message.success(
        r === 'updated'
          ? '已切换该画师为观察（只进时间流）'
          : '已观察该画师（只进时间流，不下载）',
      );
    } catch (err: any) {
      message.error(err?.message || '观察失败');
    } finally {
      setSubscribing(false);
    }
  };

  const goSettings = () => {
    const settings = ROUTES.find((r) => r.id === 'settings');
    if (settings) useRouteStore.getState().setRoute(settings);
  };

  const startSearch = async (input: string) => {
    const s = (input || '').trim();
    if (!s) return;
    setKeyword(s);
    try {
      await loadUser(s);
    } catch (err: any) {
      message.error(err?.message || '加载失败，请检查链接 / ID');
    }
  };

  const filtered = useMemo(
    () => filterPixivWorks(works, filter),
    [works, filter],
  );

  const requestFn = useCallback(async () => {
    const st = usePixivStore.getState();
    if (st.hasMore) {
      try {
        await st.loadMore();
      } catch (err: any) {
        message.error(err?.message || '加载更多失败');
      }
    }
    return { hasMore: usePixivStore.getState().hasMore };
  }, [message]);

  const onDownloadAll = () => {
    const user = userInfo.data;
    if (!user) return;
    if (filter.types.length === 0) {
      message.error('请至少选择一种作品类型');
      return;
    }
    const creator: PlatformCreator = {
      id: user.id,
      name: user.name || user.account || user.id,
      username: user.account || user.id,
      avatar: user.avatar,
      profileUrl: `https://www.pixiv.net/users/${user.id}`,
    };
    useDownloadStore.getState().createCreationTask('pixiv', creator, {
      source: 'medias',
      // 含 Video 以便 ugoira 动图通过媒体类型过滤（动图走「zip→转码」支路）
      mediaTypes: [MediaType.Photo, MediaType.Video],
      dateRange: filter.dateRange,
      workTypes: filter.types,
    });
    message.success('已创建下载任务（按作品类型勾选）');
  };

  const onDownloadWork = async (work: PixivWork) => {
    setDownloading(true);
    try {
      const n = await downloadPixivWork(work);
      message.success(`已加入下载（${n} 个媒体）`);
    } catch (err: any) {
      message.error(err?.message || '下载失败');
    } finally {
      setDownloading(false);
    }
  };

  if (!refreshToken) {
    return (
      <div>
        <PageHeader />
        <Alert
          type="warning"
          showIcon
          message="尚未配置 pixiv 登录"
          description={
            <div className="space-y-2">
              <p>
                请到「设置 → pixiv」粘贴 <b>refresh_token</b>
                （推荐，长期有效）；Cookie 为可选兜底。
              </p>
              <Button type="primary" onClick={goSettings}>
                去设置
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <div>
        <PageHeader />
        <div className="shrink-0">
          <section aria-label="搜索 pixiv">
            <Space.Compact block>
              <Input
                type="search"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onPressEnter={() => startSearch(keyword)}
                placeholder="画师主页链接 / 作品链接 / 数字 ID（如 123456 或 pixiv.net/users/123456）"
                className="text-center"
              />
              <Button
                type="primary"
                loading={loading}
                disabled={!keyword}
                onClick={() => startSearch(keyword)}
              >
                加载
              </Button>
            </Space.Compact>
          </section>

          {userInfo.data && (
            <>
              <section
                aria-label="画师信息"
                className="bg-white border-[1px] border-gray-300 rounded-md mt-4"
              >
                <a
                  className="flex items-center p-4"
                  href={`https://www.pixiv.net/users/${userInfo.data.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Avatar src={avatarSrc} size={50} alt="头像" />
                  <div className="ml-2">
                    <p>{userInfo.data.name || '未知画师'}</p>
                    <p className="text-ant-color-text-secondary text-sm mt-1">
                      @{userInfo.data.account} · pixiv ID {userInfo.data.id}
                    </p>
                  </div>
                </a>
              </section>

              <section className="p-4 bg-white rounded-md mt-3 border-[1px] space-y-4">
                <h2 className="font-bold">下载配置</h2>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">作品类型</span>
                    <Checkbox.Group
                      value={filter.types}
                      onChange={(v) =>
                        setFilter({ ...filter, types: v as PixivWorkType[] })
                      }
                      options={TYPE_OPTIONS}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">时间范围</span>
                    <DatePicker.RangePicker
                      value={filter.dateRange}
                      onChange={(v) =>
                        setFilter({
                          ...filter,
                          dateRange:
                            v && v[0] && v[1] ? [v[0], v[1]] : undefined,
                        })
                      }
                      presets={[
                        { label: '至今', value: [dayjs.unix(0), dayjs()] },
                        {
                          label: '最近 1 个月',
                          value: [dayjs().subtract(1, 'month'), dayjs()],
                        },
                        {
                          label: '最近 1 年',
                          value: [dayjs().subtract(1, 'year'), dayjs()],
                        },
                      ]}
                    />
                  </div>
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    loading={downloading}
                    onClick={onDownloadAll}
                  >
                    开始下载全部（按筛选）
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-gray-500">订阅追新</span>
                  <Select
                    value={subInterval}
                    onChange={setSubInterval}
                    options={INTERVAL_OPTIONS}
                    style={{ width: 110 }}
                  />
                  {existingSub && !existingSub.observe ? (
                    <Popconfirm
                      title="取消订阅该画师？"
                      okText="取消订阅"
                      cancelText="再想想"
                      onConfirm={onUnsubscribe}
                    >
                      <Button type="default" danger icon={<CheckOutlined />}>
                        已订阅
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button onClick={onSubscribe} loading={subscribing}>
                      订阅该画师
                    </Button>
                  )}
                  {existingSub?.observe ? (
                    <Popconfirm
                      title="取消观察该画师？"
                      okText="取消观察"
                      cancelText="再想想"
                      onConfirm={onUnsubscribe}
                    >
                      <Button type="default" danger icon={<CheckOutlined />}>
                        已观察
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button onClick={onObserve} loading={subscribing}>
                      👀 观察
                    </Button>
                  )}
                  <span className="text-xs text-gray-400">
                    按上方「作品类型」勾选追新并自动下载，结果进时间流
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  R18 内容需 pixiv 账号开启「R-18 表示」。ugoira 动图默认存
                  mp4， 勾选「GIF 转真 gif」时存 gif。
                </p>
              </section>
            </>
          )}
        </div>
      </div>

      {userInfo.data && (
        <section className="relative grow mt-4 pb-4 overflow-hidden h-full min-h-[50vh]">
          <InfiniteScroll
            requestFn={requestFn}
            className="overflow-y-auto pb-10 h-[inherit]"
          >
            {loading && works.length === 0 ? (
              <div className="py-10 text-center text-gray-400">
                <LoadingOutlined className="mr-2" />
                正在加载作品…
              </div>
            ) : filtered.length === 0 ? (
              <Empty
                description={
                  works.length === 0 ? '该画师暂无作品' : '没有命中筛选的作品'
                }
              />
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
                {filtered.map((work) => (
                  <li
                    key={work.id}
                    tabIndex={0}
                    className="relative h-[12rem] overflow-hidden bg-white group"
                  >
                    <div className="h-full">
                      <PixivThumb url={work.thumbUrl} alt={work.title} />
                      <span className="absolute right-2 top-2 rounded-sm bg-[rgba(0,0,0,0.6)] px-1 text-xs text-white">
                        {TYPE_LABEL[work.type]}
                        {work.pageCount > 1 ? ` · ${work.pageCount}图` : ''}
                      </span>
                      {work.xRestrict > 0 && (
                        <span className="absolute left-2 top-2 rounded-sm bg-rose-500 px-1 text-xs text-white">
                          R18
                        </span>
                      )}
                      <div className="absolute top-0 left-0 w-full h-full bg-[rgba(0,0,0,0.7)] transition-opacity opacity-0 group-hover:opacity-100 has-[:focus]:opacity-100">
                        <GridViewItemActions
                          actions={[
                            {
                              name: '打开原作品',
                              onClick: () =>
                                openUrl(
                                  `https://www.pixiv.net/artworks/${work.id}`,
                                ),
                            },
                            {
                              name: '下载（全部页）',
                              onClick: () => onDownloadWork(work),
                            },
                          ]}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {loadingMore && (
              <div className="flex justify-center py-4">
                <Spin size="small" />
              </div>
            )}
            {!hasMore && works.length > 0 && (
              <p className="text-center text-sm text-gray-400 py-4">
                已加载全部 {works.length} 件作品
              </p>
            )}
          </InfiniteScroll>
        </section>
      )}

      {userInfo.loading && (
        <div className="flex justify-center py-10">
          <Spin size="large" />
        </div>
      )}
    </div>
  );
};
