import { fs, path } from '@tauri-apps/api';
import { invoke } from '@tauri-apps/api';
import dayjs from 'dayjs';
import MediaType from '../enums/MediaType';
import { PlatformMedia, PlatformPost } from '../platforms';
import { prepareDownloadTask, useDownloadStore } from '../stores/download';
import { appendDownloadHistory } from '../stores/download-history';
import { useAppStateStore } from '../stores/app-state';
import { useSettingsStore } from '../stores/settings';
import {
  fetchPixivUgoiraMeta,
  fetchPixivWorkDetail,
  PixivWork,
  pixivImageHeaders,
} from './pixiv';

function buildPost(
  detail: Awaited<ReturnType<typeof fetchPixivWorkDetail>>,
  thumbUrl: string,
): PlatformPost {
  const medias: PlatformMedia[] = detail.urls.map((url, i) => ({
    id: `${detail.id}-${i}`,
    type: MediaType.Photo,
    url,
    thumbUrl,
    downloadUrl: url,
  }));
  return {
    id: detail.id,
    creator: {
      id: detail.userId,
      name: detail.userNick,
      username: detail.userName,
      avatar: detail.userAvatar,
      profileUrl: `https://www.pixiv.net/users/${detail.userId}`,
    },
    publishedAt: dayjs(detail.createDate),
    text: detail.title,
    medias,
    tags: detail.tags,
    postUrl: `https://www.pixiv.net/artworks/${detail.id}`,
    source: 'pixiv',
  };
}

/**
 * 下载一件 pixiv 作品（多图全下）。
 * - 普通插画/漫画：逐页走 aria2（source=pixiv，模板命名 + Referer）
 * - ugoira 动图：下载 zip → Rust(ffmpeg) 转 mp4（勾选 GIF 转真 gif 时转 gif）
 * 返回加入下载的媒体数。
 */
export async function downloadPixivWork(work: PixivWork): Promise<number> {
  const detail = await fetchPixivWorkDetail(work.id);
  if (detail.type === 'ugoira') {
    await downloadPixivUgoira(detail, work.thumbUrl);
    return 1;
  }
  if (detail.urls.length === 0) {
    throw new Error('该作品没有可下载的图片');
  }
  const post = buildPost(detail, work.thumbUrl);
  const { createDownloadTask } = useDownloadStore.getState();
  let count = 0;
  for (const media of post.medias || []) {
    await createDownloadTask({ source: 'pixiv', post, media });
    count += 1;
  }
  return count;
}

async function downloadPixivUgoira(
  detail: Awaited<ReturnType<typeof fetchPixivWorkDetail>>,
  thumbUrl: string,
): Promise<void> {
  const meta = await fetchPixivUgoiraMeta(detail.id);
  if (!meta.zipUrl || meta.frames.length === 0) {
    throw new Error('ugoira 元数据缺失，可能需要在 pixiv 账号开启动图权限');
  }
  const post: PlatformPost = {
    id: detail.id,
    creator: {
      id: detail.userId,
      name: detail.userNick,
      username: detail.userName,
      avatar: detail.userAvatar,
      profileUrl: `https://www.pixiv.net/users/${detail.userId}`,
    },
    publishedAt: dayjs(detail.createDate),
    text: detail.title,
    medias: [
      {
        id: `${detail.id}-0`,
        type: MediaType.Video,
        url: `https://i.pximg.net/ugoira/${detail.id}.mp4`,
        downloadUrl: meta.zipUrl,
        thumbUrl,
        ugoira: { zipUrl: meta.zipUrl, frames: meta.frames },
      },
    ],
    tags: detail.tags,
    postUrl: `https://www.pixiv.net/artworks/${detail.id}`,
    source: 'pixiv',
  };
  await downloadUgoiraFromMedia(post, post.medias![0]);
}

/**
 * 下载一件 ugoira 动图（zip → 解压 → ffmpeg 转 mp4/gif）。
 * 供「单条下载」与「批量开始下载全部」共用（media.ugoira 携带 zip+帧）。
 * 返回 1（已下载）或 0（跳过/无数据）。
 */
export async function downloadUgoiraFromMedia(
  post: PlatformPost,
  media: PlatformMedia,
): Promise<number> {
  const ugo = media.ugoira;
  if (!ugo || !ugo.zipUrl || ugo.frames.length === 0) return 0;
  const settings = useSettingsStore.getState();
  const format: 'mp4' | 'gif' = settings.download.gifToRealGif ? 'gif' : 'mp4';
  // 借模板机制算目录/文件名（合成一个 mp4/gif 媒体，只为命名与 EXT）
  const mediaForName: PlatformMedia = {
    ...media,
    url: `https://i.pximg.net/ugoira/${post.id}.${format}`,
    downloadUrl: `https://i.pximg.net/ugoira/${post.id}.${format}`,
  };
  const task = await prepareDownloadTask({
    source: 'pixiv',
    post,
    media: mediaForName,
  });
  const outPath = await path.join(task.dir, task.fileName);
  if (settings.download.sameFileSkip && (await fs.exists(outPath))) {
    return 0;
  }
  await fs.createDir(task.dir, { recursive: true });

  const appState = useAppStateStore.getState();
  const proxyUrl = settings.proxy.useSystem
    ? appState.systemProxyUrl
    : settings.proxy.url;
  await invoke('download_and_convert_ugoira', {
    url: ugo.zipUrl,
    headers: pixivImageHeaders(),
    enableProxy: settings.proxy.enable,
    proxyUrl,
    framesJson: JSON.stringify(ugo.frames),
    outPath,
    format,
  });

  await appendDownloadHistory({
    postId: post.id,
    tweetTime: post.publishedAt?.toISOString?.() || new Date().toISOString(),
    fullText: post.text,
    username: post.creator?.username,
    displayName: post.creator?.name,
    avatar: post.creator?.avatar,
    mediaType: MediaType.Video,
    mediaUrl: media.thumbUrl,
    filePath: outPath,
    fileName: task.fileName,
    downloadedAt: Date.now(),
    source: 'manual',
    platform: 'pixiv',
    postUrl: post.postUrl,
  });
  return 1;
}
