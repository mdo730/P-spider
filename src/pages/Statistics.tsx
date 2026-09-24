/* eslint-disable react/prop-types */
import { Empty, Select, Table, Tooltip } from 'antd';
import clsx from 'clsx';
import dayjs from 'dayjs';
import React, { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useSubscriptionStore } from '../stores/subscription';
import { useFigmemoStore } from '../stores/figmemo';
import { buildUserUrl } from '../twitter/url';
import figmemoIcon from '../assets/platform-icons/figmemo.png';

const RANGE_OPTIONS = [
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
  { value: 90, label: '近 90 天' },
];

function getDateKeys(range: number): string[] {
  const keys: string[] = [];
  const today = dayjs();
  for (let i = range - 1; i >= 0; i--) {
    keys.push(today.subtract(i, 'day').format('YYYY-MM-DD'));
  }
  return keys;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * 计算柱状图的 y 轴刻度：
 * 输入实际最大值，内部放大 1.2 倍留出顶部余量，
 * 生成 0, step, 2*step ... 的 nice 刻度（step 取 1/2/5 × 10^n），
 * 顶部刻度始终为 step 的整数倍且高于实际最大值
 */
function getNiceTicks(maxValue: number): number[] {
  const padded = maxValue * 1.2;
  const targetCount = 5;
  const rawStep = padded / targetCount;

  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;

  let niceStep: number;
  if (normalized < 1.5) niceStep = 1;
  else if (normalized < 3.5) niceStep = 2;
  else if (normalized < 7.5) niceStep = 5;
  else niceStep = 10;

  let step = niceStep * magnitude;
  // 媒体数量为整数，步长不小于 1
  if (step < 1) step = 1;

  // 顶部刻度取 step 的整数倍，确保高于实际最大值
  const topTick = Math.ceil(padded / step) * step;

  const ticks: number[] = [];
  for (let v = 0; v <= topTick; v += step) {
    ticks.push(Math.round(v));
  }
  return ticks;
}

export const StatisticsPage: React.FC = () => {
  const [range, setRange] = useState(30);
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const figmemoStats = useFigmemoStore((s) => s.dailyStats);
  const figmemoCount = useFigmemoStore((s) => s.downloadedCount);

  const dateKeys = useMemo(() => getDateKeys(range), [range]);

  // 按字节数显示柱状图，tooltip 里同时给数量和大小
  const chartData = useMemo(() => {
    return dateKeys.map((date) => {
      let bytes = 0;
      let count = 0;
      for (const sub of subscriptions) {
        const stat = sub.dailyStats?.[date];
        if (stat) {
          bytes += stat.bytes || 0;
          count += stat.count || 0;
        }
      }
      const fm = figmemoStats?.[date];
      if (fm) {
        bytes += fm.bytes || 0;
        count += fm.count || 0;
      }
      return { date, bytes, count };
    });
  }, [dateKeys, subscriptions, figmemoStats]);

  const maxCount = useMemo(
    () => Math.max(...chartData.map((d) => d.count), 1),
    [chartData],
  );

  // y 轴刻度（按媒体数量，顶部刻度 >= 最大值）
  const ticks = useMemo(() => getNiceTicks(maxCount), [maxCount]);
  const axisMax = ticks[ticks.length - 1];

  const tableData = useMemo(() => {
    const rows = subscriptions.map((sub) => {
      let rangeCount = 0;
      let rangeBytes = 0;
      let totalBytes = 0;
      for (const [date, stat] of Object.entries(sub.dailyStats || {})) {
        const isInRange = dateKeys.includes(date);
        if (isInRange) {
          rangeCount += stat.count || 0;
          rangeBytes += stat.bytes || 0;
        }
        totalBytes += stat.bytes || 0;
      }
      return {
        key: sub.id,
        username: sub.username,
        displayName: sub.displayName as string | undefined,
        avatar: sub.avatar as string | undefined,
        rangeCount,
        rangeBytes,
        totalCount: sub.downloadedCount,
        totalBytes,
        isFigmemo: false,
      };
    });

    // fig-memo 作为独立统计项
    let fmRangeCount = 0;
    let fmRangeBytes = 0;
    let fmTotalBytes = 0;
    for (const [date, stat] of Object.entries(figmemoStats || {})) {
      if (dateKeys.includes(date)) {
        fmRangeCount += stat.count || 0;
        fmRangeBytes += stat.bytes || 0;
      }
      fmTotalBytes += stat.bytes || 0;
    }
    if (figmemoCount > 0 || fmTotalBytes > 0) {
      rows.push({
        key: 'figmemo',
        username: 'fig-memo',
        displayName: 'fig-memo',
        avatar: figmemoIcon as string | undefined,
        rangeCount: fmRangeCount,
        rangeBytes: fmRangeBytes,
        totalCount: figmemoCount,
        totalBytes: fmTotalBytes,
        isFigmemo: true,
      });
    }

    return rows.sort((a, b) => b.rangeCount - a.rangeCount);
  }, [subscriptions, dateKeys, figmemoStats, figmemoCount]);

  const overallRangeCount = useMemo(
    () => chartData.reduce((acc, d) => acc + d.count, 0),
    [chartData],
  );
  const overallRangeBytes = useMemo(
    () => chartData.reduce((acc, d) => acc + d.bytes, 0),
    [chartData],
  );

  return (
    <>
      <PageHeader />

      <section className="space-y-4">
        <div className="bg-white rounded-md p-4 border-[1px]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">每日新增下载量</h2>
            <Select
              value={range}
              onChange={setRange}
              options={RANGE_OPTIONS}
              style={{ width: 120 }}
            />
          </div>

          {overallRangeCount === 0 ? (
            <Empty
              description="所选时间段内暂无新增下载，订阅抓取到新推文后这里会显示统计"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <>
              <div className="text-sm text-gray-400 mb-2">
                近 {range} 天共新增{' '}
                <span className="text-ant-color-primary font-bold">
                  {overallRangeCount}
                </span>{' '}
                个媒体文件（约{' '}
                <span className="text-ant-color-primary font-bold">
                  {formatBytes(overallRangeBytes)}
                </span>
                ）
              </div>
              <div className="flex">
                {/* y 轴刻度 */}
                <div className="w-10 shrink-0 relative h-44 mr-2">
                  {ticks.map((tick, i) => {
                    const isFirst = i === 0;
                    const isLast = i === ticks.length - 1;
                    // 顶部刻度贴顶向下、底部刻度贴底向上、中间刻度居中对齐刻度线
                    const style: React.CSSProperties = isLast
                      ? { top: 0, bottom: 'auto' }
                      : isFirst
                        ? { bottom: 0, top: 'auto' }
                        : {
                            top: `${(1 - tick / axisMax) * 100}%`,
                            transform: 'translateY(-50%)',
                          };
                    return (
                      <span
                        key={tick}
                        className="absolute right-1 text-xs text-gray-400 leading-none"
                        style={style}
                      >
                        {tick}
                      </span>
                    );
                  })}
                </div>
                {/* 柱状图 + 网格线 */}
                <div className="flex-1 relative">
                  <div className="absolute inset-0">
                    {ticks.map((tick) => (
                      <div
                        key={tick}
                        className="absolute left-0 right-0 border-t border-dashed border-gray-200"
                        style={{ bottom: `${(tick / axisMax) * 100}%` }}
                      />
                    ))}
                  </div>
                  <div className="relative flex items-end space-x-[2px] h-44">
                    {chartData.map(({ date, bytes, count }) => (
                      <Tooltip
                        key={date}
                        title={`${date}: ${count} 个 / ${formatBytes(bytes)}`}
                      >
                        <div
                          className={clsx(
                            'flex-1 rounded-t transition-all cursor-pointer',
                            count > 0
                              ? 'bg-ant-color-primary hover:opacity-80'
                              : 'bg-gray-100',
                          )}
                          style={{
                            height: `${Math.max((count / axisMax) * 100, 2)}%`,
                            minHeight: '2px',
                          }}
                        />
                      </Tooltip>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>{dateKeys[0]}</span>
                <span>{dateKeys[Math.floor(dateKeys.length / 2)]}</span>
                <span>{dateKeys[dateKeys.length - 1]}</span>
              </div>
            </>
          )}
        </div>

        <div className="bg-white rounded-md p-4 border-[1px]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">订阅新增排行</h2>
            <span className="text-sm text-gray-400">
              按近 {range} 天新增量排序
            </span>
          </div>
          <Table
            size="small"
            pagination={false}
            dataSource={tableData}
            locale={{ emptyText: '暂无订阅数据' }}
            columns={[
              {
                title: '用户',
                key: 'user',
                render: (_, row) => (
                  <div className="flex items-center">
                    <img
                      src={row.avatar}
                      alt="头像"
                      className="w-7 h-7 rounded-full mr-2 object-cover"
                    />
                    {row.isFigmemo ? (
                      <span className="font-medium">fig-memo</span>
                    ) : (
                      <>
                        <a
                          href={buildUserUrl(row.username)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium"
                        >
                          {row.displayName || row.username}
                        </a>
                        <span className="text-gray-400 text-xs ml-1">
                          @{row.username}
                        </span>
                      </>
                    )}
                  </div>
                ),
              },
              {
                title: `近 ${range} 天新增`,
                dataIndex: 'rangeCount',
                key: 'rangeCount',
                width: 120,
                align: 'right' as const,
                sorter: (a, b) => a.rangeCount - b.rangeCount,
                defaultSortOrder: 'descend' as const,
              },
              {
                title: `近 ${range} 天大小`,
                key: 'rangeBytes',
                width: 120,
                align: 'right' as const,
                sorter: (a, b) => a.rangeBytes - b.rangeBytes,
                render: (_, row) => formatBytes(row.rangeBytes),
              },
              {
                title: '累计下载',
                dataIndex: 'totalCount',
                key: 'totalCount',
                width: 120,
                align: 'right' as const,
                sorter: (a, b) => a.totalCount - b.totalCount,
              },
              {
                title: '累计大小',
                key: 'totalBytes',
                width: 120,
                align: 'right' as const,
                sorter: (a, b) => a.totalBytes - b.totalBytes,
                render: (_, row) => formatBytes(row.totalBytes),
              },
            ]}
          />
        </div>
      </section>
    </>
  );
};
