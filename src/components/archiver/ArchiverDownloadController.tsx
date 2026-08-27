/* eslint-disable react/prop-types */
import { App, Button, Checkbox, DatePicker, Form, Select } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import React, { useState } from 'react';
import MediaType from '../../enums/MediaType';
import { DownloadFilter } from '../../interfaces/DownloadFilter';
import { useArchiverBrowseStore } from '../../stores/archiver-browse';
import { useDownloadStore } from '../../stores/download';
import { useSubscriptionStore } from '../../stores/subscription';

const INTERVAL_OPTIONS = [
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 180, label: '3 小时' },
  { value: 360, label: '6 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '1 天' },
];

/**
 * Pawchive 批量下载 + 订阅：
 * - 批量下载：创建爬虫任务（爬全部页），目录走归档站两级文件夹逻辑
 * - 订阅：按当前创作者建 Pawchive 订阅，新帖自动下载
 */
export const ArchiverDownloadController: React.FC = () => {
  const { message } = App.useApp();
  const { creator, sources } = useArchiverBrowseStore();
  const { createCreationTask } = useDownloadStore();
  const { addSubscription, subscriptions } = useSubscriptionStore();
  const [filter, setFilter] = useState<DownloadFilter>({
    mediaTypes: [MediaType.Photo, MediaType.Video, MediaType.Gif],
    source: 'medias',
  });
  const [intervalMin, setIntervalMin] = useState(720);
  const [subscribing, setSubscribing] = useState(false);

  // 是否已订阅当前创作者（Pawchive 订阅按 service/id 匹配）
  const alreadySubscribed = subscriptions.some(
    (s) =>
      s.source === 'pawchive' &&
      !!creator &&
      s.username.toLowerCase() === creator.username.toLowerCase(),
  );

  const onStartDownload = async () => {
    if (!creator) {
      message.info('请先检索创作者');
      return;
    }
    if (!filter.mediaTypes || filter.mediaTypes.length === 0) {
      message.error('请至少选择一个媒体类型');
      return;
    }
    const available = sources.filter((s) => !s.failed && s.posts.length > 0);
    if (available.length === 0) {
      message.info('还没有内容');
      return;
    }
    for (const s of available) {
      createCreationTask(s.source, creator, {
        mediaTypes: filter.mediaTypes,
        source: 'medias',
        dateRange: filter.dateRange,
      });
    }
    message.success('已创建下载任务，请到下载管理页查看');
  };

  const onSubscribe = async () => {
    if (!creator) return;
    if (alreadySubscribed) {
      message.info(`已订阅过 ${creator.name || creator.username}，无需重复`);
      return;
    }
    if (!filter.mediaTypes || filter.mediaTypes.length === 0) {
      message.error('请至少选择一个媒体类型');
      return;
    }
    setSubscribing(true);
    try {
      await addSubscription({
        source: 'pawchive',
        username: creator.username,
        intervalMin,
        mediaTypes: filter.mediaTypes,
      });
      message.success(
        `已订阅 ${creator.name || creator.username}，将每 ${intervalMin} 分钟检查一次新帖并自动下载`,
      );
    } catch (err: any) {
      log.error(err);
      message.error(`订阅失败：${err?.message || '未知原因'}`);
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <section className="p-4 bg-white rounded-md mt-3 border-[1px]">
      <h2 className="font-bold mb-4">批量下载与订阅</h2>
      <Form<DownloadFilter>
        layout="inline"
        initialValues={filter}
        onValuesChange={(_, values) => setFilter(values)}
      >
        <Form.Item name="dateRange" label="日期范围">
          <DatePicker.RangePicker
            presets={[
              { label: '至今', value: [dayjs.unix(0), dayjs()] },
              {
                label: '最近 7 天',
                value: [dayjs().subtract(7, 'day'), dayjs()],
              },
              {
                label: '最近 30 天',
                value: [dayjs().subtract(30, 'day'), dayjs()],
              },
              {
                label: '最近 90 天',
                value: [dayjs().subtract(90, 'day'), dayjs()],
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
              { label: '照片', value: MediaType.Photo },
              { label: '视频', value: MediaType.Video },
              { label: 'GIF', value: MediaType.Gif },
            ]}
          />
        </Form.Item>
      </Form>
      <hr className="my-4" />
      <section className="flex items-center space-x-2">
        <Button type="primary" onClick={onStartDownload} disabled={!creator}>
          开始下载全部
        </Button>
        <Select
          value={intervalMin}
          onChange={setIntervalMin}
          options={INTERVAL_OPTIONS}
          style={{ width: 110 }}
          title="订阅刷新间隔"
        />
        <Button
          onClick={onSubscribe}
          loading={subscribing}
          disabled={!creator || !filter.mediaTypes?.length || alreadySubscribed}
          icon={alreadySubscribed ? <CheckOutlined /> : undefined}
        >
          {alreadySubscribed ? '已订阅' : '订阅'}
        </Button>
        <span className="text-sm text-gray-400">
          下载到 保存目录/创作者名/帖子标题
        </span>
      </section>
    </section>
  );
};
