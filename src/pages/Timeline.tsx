/* eslint-disable react/prop-types */
import { Empty, Image, Spin } from 'antd';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import {
  getMediaOriginalUrl,
  getMediaThumbUrl,
  getTimelineGroups,
  TimelineGroup,
} from '../stores/download-history';
import { buildUserUrl } from '../twitter/url';

const PAGE_SIZE = 25;
const LOAD_MORE_STEP = 5;

const MEDIA_TYPE_LABEL: Record<string, string> = {
  photo: '图片',
  video: '视频',
  animated_gif: 'GIF',
};

export const TimelinePage: React.FC = () => {
  const [groups, setGroups] = useState<TimelineGroup[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await getTimelineGroups(7);
      setGroups(data);
      setVisibleCount(Math.min(PAGE_SIZE, data.length));
      setLoading(false);
    })();
  }, []);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    // 模拟异步，避免快速连续触发
    setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + LOAD_MORE_STEP, groups.length));
      setLoadingMore(false);
    }, 200);
  }, [groups.length]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && visibleCount < groups.length) {
        loadMore();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [groups.length, visibleCount, loadMore]);

  const visibleGroups = groups.slice(0, visibleCount);

  return (
    <>
      <PageHeader />
      <section className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-20">
            <Spin size="large" />
          </div>
        ) : visibleGroups.length === 0 ? (
          <Empty description="近 7 天还没有下载记录，订阅自动下载后这里会显示时间流" />
        ) : (
          <>
            <p className="text-sm text-gray-400">
              近 7 天共 {groups.length} 条推文（含媒体）
            </p>
            <ul className="space-y-4">
              {visibleGroups.map((group) => (
                <TimelineItem key={group.postId} group={group} />
              ))}
            </ul>
            <div ref={sentinelRef} className="h-2" />
            {loadingMore && (
              <div className="flex justify-center py-4">
                <Spin size="small" />
              </div>
            )}
            {visibleCount >= groups.length && (
              <p className="text-center text-gray-400 text-sm py-4">
                已加载全部 {groups.length} 条
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
};

const TimelineItem: React.FC<{ group: TimelineGroup }> = ({ group }) => {
  const first = group.records[0];
  const url = first?.username
    ? buildUserUrl(first.username)
    : 'javascript:void(0);';

  return (
    <li className="bg-white rounded-md border-[1px] p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          {first?.displayName || first?.username ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="font-medium"
            >
              {first?.displayName || first?.username}
            </a>
          ) : (
            <span className="font-medium">未知用户</span>
          )}
          <span className="text-gray-400 text-sm ml-2">@{first?.username}</span>
        </div>
        <span className="text-sm text-gray-400 shrink-0">
          {dayjs(group.tweetTime).format('MM-DD HH:mm')}
        </span>
      </div>

      {group.fullText && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap mb-3 break-words">
          {group.fullText}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {group.records.map((record, idx) => {
          const thumbUrl = getMediaThumbUrl(record);
          const originalUrl = getMediaOriginalUrl(record);
          return (
            <Image
              key={`${record.postId}-${idx}`}
              src={thumbUrl}
              alt={record.fileName}
              className="object-cover rounded-md"
              width={160}
              height={160}
              preview={{
                mask: MEDIA_TYPE_LABEL[record.mediaType] || '查看',
                src: originalUrl,
              }}
            />
          );
        })}
      </div>
    </li>
  );
};
