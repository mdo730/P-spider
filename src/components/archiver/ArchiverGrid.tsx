/* eslint-disable react/prop-types */
import { LoadingOutlined } from '@ant-design/icons';
import { App } from 'antd';
import * as R from 'ramda';
import React from 'react';
import MediaType from '../../enums/MediaType';
import { PlatformPost } from '../../platforms';
import { useArchiverBrowseStore } from '../../stores/archiver-browse';
import { useDownloadStore } from '../../stores/download';
import { InfiniteScroll } from '../InfiniteScroll';
import {
  GridViewItemAction,
  GridViewItemActions,
} from '../homepage/GridViewItemActions';
import { RemoteThumb } from './RemoteThumb';

/** 是否为图片类 URL（按扩展名判断，zip/视频等无缩略图，不能当封面） */
function isImageUrl(url?: string): boolean {
  if (!url) return false;
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
}

/** Pawchive 帖子网格：一个帖子一个格子，缩略图取首媒体，支持整帖下载（跳过仅预览附件） */
export const ArchiverGrid: React.FC = () => {
  const { message } = App.useApp();
  const { mergedPosts, loading, loadingMore, loadMore } =
    useArchiverBrowseStore();
  const { batchCreateDownloadTask } = useDownloadStore();

  const requestFn = async () => {
    await loadMore();
    return { hasMore: useArchiverBrowseStore.getState().hasMore };
  };

  return (
    <InfiniteScroll
      requestFn={requestFn}
      className="overflow-y-auto pb-10 overflow-hidden h-[inherit]"
    >
      {loading && (
        <div role="status">
          <LoadingOutlined
            className="text-ant-color-primary mr-2"
            aria-hidden
          />
          加载中...
        </div>
      )}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
        {mergedPosts.map((post: PlatformPost) => {
          const medias = post.medias || [];
          // 封面：只取图片类媒体（zip/视频等无缩略图，作封面会裂）
          const coverMedia =
            medias.find((m) => isImageUrl(m.thumbUrl || m.url)) ||
            medias.find((m) => m.thumbUrl) ||
            medias[0];
          const cover = coverMedia?.thumbUrl || coverMedia?.url;
          const hasPreviewOnly = medias.some((m) => m.previewOnly);
          // 全部仅预览时下载的是缩略图，提示用户
          const allPreviewOnly =
            medias.length > 0 && medias.every((m) => m.previewOnly);

          const actionOpen: GridViewItemAction | undefined = post.postUrl
            ? { name: '打开帖子', href: post.postUrl }
            : undefined;

          const commonDownload = async () => {
            if (medias.length === 0) {
              message.info('该帖没有可下载的附件');
              return;
            }
            try {
              await batchCreateDownloadTask(
                medias.map((media) => ({
                  source: post.source || 'pawchive',
                  post,
                  media,
                })),
              );
              message.success(`已添加 ${medias.length} 个附件到下载队列`);
            } catch (err: any) {
              log.error(err);
              message.error(`创建下载任务失败：${err?.message}`);
            }
          };

          const actionDownload: GridViewItemAction = {
            name: allPreviewOnly
              ? `下载缩略图 (${medias.length})`
              : `下载 (${medias.length})`,
            onClick: commonDownload,
          };

          return (
            <li
              tabIndex={0}
              key={post.id}
              className="relative h-[12rem] overflow-hidden bg-white group"
            >
              <div className="h-full">
                {cover ? (
                  <RemoteThumb
                    src={cover}
                    alt="帖子封面"
                    className="object-cover w-full h-full transform transition-transform group-hover:scale-105"
                    placeholderClassName="!bg-gray-200"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 bg-gray-100">
                    无媒体
                  </div>
                )}
                <span className="block absolute left-2 top-2 text-xs text-white bg-[rgba(0,0,0,0.6)] rounded-sm px-[0.3rem] py-[0.1rem]">
                  {medias.length} 附件
                </span>
                {hasPreviewOnly && (
                  <span className="block absolute left-2 bottom-2 text-xs text-yellow-300 bg-[rgba(0,0,0,0.6)] rounded-sm px-[0.3rem] py-[0.1rem]">
                    部分仅预览
                  </span>
                )}
                {coverMedia?.type === MediaType.Video && (
                  <span className="block absolute right-2 bottom-2 text-white bg-[rgba(0,0,0,0.6)] rounded-sm px-[0.3rem] text-sm">
                    视频
                  </span>
                )}
                <div className="absolute top-0 left-0 w-full h-full bg-[rgba(0,0,0,0.7)] transition-opacity opacity-0 group-hover:opacity-100 has-[:focus]:opacity-100">
                  <GridViewItemActions
                    actions={[actionOpen, actionDownload].filter(R.isNotNil)}
                  />
                </div>
              </div>
            </li>
          );
        })}
        {loadingMore && (
          <li
            className="h-[15rem] flex items-center justify-center bg-white"
            tabIndex={0}
          >
            <LoadingOutlined
              className="text-6xl text-ant-color-primary"
              aria-hidden
            />
          </li>
        )}
      </ul>
      {!loading && !loadingMore && mergedPosts.length === 0 && (
        <div
          className="mt-4 text-sm text-ant-color-text-secondary text-center"
          role="alert"
        >
          暂无内容
        </div>
      )}
    </InfiniteScroll>
  );
};
