import dayjs from 'dayjs';
import MediaType from '../enums/MediaType';
import { useDownloadStore } from '../stores/download';
import { PlatformMedia, PlatformPost } from '../platforms/types';

/**
 * 把 hpoi 词条 / 相册的图片加入下载队列（走统一下载管线）。
 * 保存到 saveDirBase/hpoi/<标题>/；图片经代理 + Referer（download.ts 里按 source=hpoi 加）。
 */
export async function downloadHpoiImages(
  title: string,
  images: (string | undefined | null)[],
): Promise<number> {
  const urls = Array.from(
    new Set(images.filter((u): u is string => !!u && /^https?:/i.test(u))),
  );
  if (urls.length === 0) return 0;

  const medias: PlatformMedia[] = urls.map((u, i) => {
    const base =
      decodeURIComponent(u.split('?')[0].split('/').pop() || '') || `img-${i}`;
    return {
      id: `${i}-${base}`,
      type: MediaType.Photo,
      url: u,
      downloadUrl: u,
      fileName: base,
    };
  });

  const post: PlatformPost = {
    id: `hpoi-${Date.now()}`,
    creator: { id: 'hpoi', name: 'hpoi', username: 'hpoi' },
    publishedAt: dayjs(),
    text: title || 'hpoi',
    medias,
    links: [],
    source: 'hpoi',
  };

  await useDownloadStore
    .getState()
    .batchCreateDownloadTask(
      medias.map((media) => ({ source: 'hpoi', post, media })),
    );
  return medias.length;
}
