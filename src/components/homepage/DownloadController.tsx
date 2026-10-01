/* eslint-disable react/prop-types */
import {
  App,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Popconfirm,
  Radio,
  Select,
  Space,
} from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import React, { useState } from 'react';
import MediaType from '../../enums/MediaType';
import { DownloadFilter } from '../../interfaces/DownloadFilter';
import { useDownloadStore } from '../../stores/download';
import { useHomepageStore } from '../../stores/homepage';
import { useSubscriptionStore } from '../../stores/subscription';
import { toPlatformCreator } from '../../platforms/twitter';

const INTERVAL_OPTIONS = [
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 180, label: '3 小时' },
  { value: 360, label: '6 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '1 天' },
];

export const DownloadController: React.FC = () => {
  const { message } = App.useApp();
  const { filter, setFilter, user } = useHomepageStore((s) => ({
    filter: s.filter,
    setFilter: s.setFilter,
    user: s.userInfo.data,
  }));
  const { createCreationTask } = useDownloadStore((s) => ({
    createCreationTask: s.createCreationTask,
  }));
  const { addSubscription, removeSubscription, subscriptions } =
    useSubscriptionStore();
  const [subscribing, setSubscribing] = useState(false);
  const [intervalMin, setIntervalMin] = useState(720);
  /** 订阅时是否包含转推（转贴只进时间流，不下载；默认关） */
  const [includeRetweets, setIncludeRetweets] = useState(false);

  // 当前检索账号的订阅（主页为 X 平台场景，只匹配 twitter 订阅）
  const existingSub = subscriptions.find(
    (s) =>
      s.source === 'twitter' &&
      s.username.toLowerCase() === (user?.screenName || '').toLowerCase(),
  );

  const onUnsubscribe = () => {
    if (!existingSub) return;
    removeSubscription(existingSub.id);
    message.success(`已取消订阅 @${user?.screenName ?? ''}`);
  };

  const onStartDownload = async () => {
    if (!user) {
      message.error('请先加载用户');
      return;
    }

    if (!filter.mediaTypes || filter.mediaTypes.length === 0) {
      message.error('请至少选择一个媒体类型');
      return;
    }

    try {
      createCreationTask('twitter', toPlatformCreator(user), filter);
      message.success('已成功创建下载任务，请到下载管理页查看');
    } catch (err: any) {
      log.error(err);
      message.error('创建下载任务失败');
    }
  };

  const onSubscribe = async () => {
    if (!user) {
      message.error('请先加载用户');
      return;
    }
    if (!filter.mediaTypes || filter.mediaTypes.length === 0) {
      message.error('请至少选择一个媒体类型');
      return;
    }
    setSubscribing(true);
    try {
      // 已存在则更新选项（不会重复添加）
      const result = await addSubscription({
        username: user.screenName,
        intervalMin,
        mediaTypes: filter.mediaTypes,
        retweetMode: includeRetweets ? 'include' : 'off',
        observe: false,
      });
      if (result === 'updated') {
        message.success(`已更新 @${user.screenName} 的订阅选项`);
      } else {
        message.success(
          `已订阅 @${user.screenName}，将每 ${intervalMin} 分钟检查一次新内容并自动下载`,
        );
      }
    } catch (err: any) {
      log.error(err);
      message.error(`订阅失败：${err?.message || '未知原因'}`);
    } finally {
      setSubscribing(false);
    }
  };

  const onObserve = async () => {
    if (!user) {
      message.error('请先加载用户');
      return;
    }
    setSubscribing(true);
    try {
      const result = await addSubscription({
        username: user.screenName,
        intervalMin,
        mediaTypes: filter.mediaTypes?.length
          ? filter.mediaTypes
          : [MediaType.Photo, MediaType.Video, MediaType.Gif],
        retweetMode: includeRetweets ? 'include' : 'off',
        observe: true,
      });
      message.success(
        result === 'updated'
          ? `已切换 @${user.screenName} 为观察（只进时间流）`
          : `已观察 @${user.screenName}（只进时间流，不下载）`,
      );
    } catch (err: any) {
      log.error(err);
      message.error(`观察失败：${err?.message || '未知原因'}`);
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <section className="p-4 bg-white rounded-md mt-3 border-[1px]">
      <h2 className="font-bold mb-4">下载配置</h2>
      <Form<DownloadFilter>
        layout="inline"
        initialValues={filter}
        onValuesChange={(_, values) => {
          setFilter(values);
        }}
      >
        <Form.Item name="dateRange" label="日期范围">
          <DatePicker.RangePicker
            presets={[
              {
                label: '至今',
                value: [dayjs.unix(0), dayjs()],
              },
              {
                label: '最近 7 天',
                value: [dayjs().subtract(7, 'day'), dayjs()],
              },
              {
                label: '最近 15 天',
                value: [dayjs().subtract(15, 'day'), dayjs()],
              },
              {
                label: '最近 1 个月',
                value: [dayjs().subtract(1, 'month'), dayjs()],
              },
              {
                label: '最近 6 个月',
                value: [dayjs().subtract(6, 'month'), dayjs()],
              },
              {
                label: '最近 1 年',
                value: [dayjs().subtract(1, 'year'), dayjs()],
              },
            ]}
            disabledDate={(cur) => cur && cur > dayjs().endOf('day')}
          />
        </Form.Item>
        <Form.Item name="mediaTypes" label="媒体类型">
          <Checkbox.Group
            options={[
              {
                label: '视频',
                value: MediaType.Video,
              },
              {
                label: '照片',
                value: MediaType.Photo,
              },
              {
                label: 'GIF',
                value: MediaType.Gif,
              },
            ]}
          />
        </Form.Item>
        <Form.Item tooltip="订阅时抓取该用户的转贴；转贴只进时间流，不下载（默认关闭）">
          <Checkbox
            checked={includeRetweets}
            onChange={(e) => setIncludeRetweets(e.target.checked)}
          >
            转推
          </Checkbox>
        </Form.Item>
        <Form.Item
          name="source"
          label="下载源"
          tooltip="帖子能下载到更早的推文，但爬取速度较慢；媒体可能下载不到更早的推文，但爬取速度更快。"
        >
          <Radio.Group
            options={[
              {
                label: '帖子',
                value: 'tweets',
              },
              {
                label: '媒体',
                value: 'medias',
              },
            ]}
          />
        </Form.Item>
      </Form>
      <hr className="my-4" />
      <section className="flex items-center space-x-2">
        <Button type="primary" onClick={onStartDownload}>
          <Space>
            <span>开始下载</span>
          </Space>
        </Button>
        <Select
          value={intervalMin}
          onChange={setIntervalMin}
          options={INTERVAL_OPTIONS}
          style={{ width: 110 }}
          title="订阅刷新间隔"
        />
        {existingSub && !existingSub.observe ? (
          <Popconfirm
            title={`取消订阅 @${user?.screenName ?? ''}？`}
            okText="取消订阅"
            cancelText="再想想"
            onConfirm={onUnsubscribe}
          >
            <Button type="default" danger icon={<CheckOutlined />}>
              已订阅
            </Button>
          </Popconfirm>
        ) : (
          <Button
            onClick={onSubscribe}
            loading={subscribing}
            disabled={!user || !filter.mediaTypes?.length}
            type="default"
          >
            订阅
          </Button>
        )}
        {existingSub?.observe ? (
          <Popconfirm
            title={`取消观察 @${user?.screenName ?? ''}？`}
            okText="取消观察"
            cancelText="再想想"
            onConfirm={onUnsubscribe}
          >
            <Button type="default" danger icon={<CheckOutlined />}>
              已观察
            </Button>
          </Popconfirm>
        ) : (
          <Button
            onClick={onObserve}
            loading={subscribing}
            disabled={!user}
            type="default"
          >
            👀 观察
          </Button>
        )}
      </section>
    </section>
  );
};
