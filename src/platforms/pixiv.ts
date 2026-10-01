import dayjs from 'dayjs';
import MediaType from '../enums/MediaType';
import {
  fetchPixivUgoiraMeta,
  fetchPixivUser,
  fetchPixivWorkDetail,
  fetchPixivWorks,
  parsePixivInput,
  PixivWork,
  resolveWorkAuthorId,
} from '../services/pixiv';
import {
  PlatformAdapter,
  PlatformCreator,
  PlatformMedia,
  PlatformPost,
} from './types';

/**
 * 本地并发限流（不引 utils/library 桶——那会经 trace → download-history 形成
 * `download → platforms → pixiv → library → trace → download-history` 环形依赖，
 * 启动时 download-history 里 `onTaskCompleted.listen` 会撞上 TDZ 而白屏）。
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return out;
}

/** pixiv 平台标识 */
export const PIXIV_SOURCE = 'pixiv';

/**
 * pixiv 适配器（供 `createCreationTask` 批量建库 / L3 订阅复用）。
 *
 * 说明：列表接口（/v1/user/illusts）只给缩略图，原图需逐个 `illust/detail` 取，
 * 因此 fetchPosts 会对本页每件作品拉一次详情（并发 4，压节奏）；
 * **ugoira 动图**产出带 `media.ugoira`（zip+帧）的媒体，由批量任务走「zip→转码」支路。
 */
async function resolvePixivCreator(
  identifier: string,
): Promise<PlatformCreator> {
  const parsed = parsePixivInput(identifier);
  let userId = parsed.userId;
  if (!userId && parsed.workId) {
    userId = await resolveWorkAuthorId(parsed.workId);
  }
  if (!userId) throw new Error('无法识别 pixiv 链接/ID');
  const u = await fetchPixivUser(userId);
  return {
    id: u.id,
    name: u.name || u.account || u.id,
    username: u.account || u.id,
    avatar: u.avatar,
    profileUrl: `https://www.pixiv.net/users/${u.id}`,
  };
}

async function workToPost(work: PixivWork): Promise<PlatformPost> {
  const creator: PlatformCreator = {
    id: work.userId,
    name: work.userNick,
    username: work.userName,
    avatar: work.userAvatar,
    profileUrl: `https://www.pixiv.net/users/${work.userId}`,
  };
  const medias: PlatformMedia[] = [];
  if (work.type === 'ugoira') {
    // 动图：拉 ugoira 元数据（zip + 帧序列），交给批量任务里的「zip→转码」支路处理
    try {
      const meta = await fetchPixivUgoiraMeta(work.id);
      if (meta.zipUrl && meta.frames.length > 0) {
        medias.push({
          id: `${work.id}-0`,
          type: MediaType.Video,
          // 合成一个 mp4 地址仅用于「文件名模板」的 EXT（实际由转换命令产出）
          url: `https://i.pximg.net/ugoira/${work.id}.mp4`,
          thumbUrl: work.thumbUrl,
          downloadUrl: meta.zipUrl,
          ugoira: { zipUrl: meta.zipUrl, frames: meta.frames },
        });
      }
    } catch {
      // 取不到元数据则不产出媒体（跳过），不阻断整页
    }
  } else {
    try {
      const detail = await fetchPixivWorkDetail(work.id);
      detail.urls.forEach((url, i) => {
        medias.push({
          id: `${work.id}-${i}`,
          type: MediaType.Photo,
          url,
          thumbUrl: work.thumbUrl,
          downloadUrl: url,
        });
      });
    } catch {
      // 详情失败：用缩略图兜底（至少可下压缩图）
      if (work.thumbUrl) {
        medias.push({
          id: `${work.id}-0`,
          type: MediaType.Photo,
          url: work.thumbUrl,
          thumbUrl: work.thumbUrl,
          downloadUrl: work.thumbUrl,
        });
      }
    }
  }
  return {
    id: work.id,
    creator,
    publishedAt: dayjs(work.createDate),
    text: work.title,
    medias,
    tags: work.tags,
    postUrl: `https://www.pixiv.net/artworks/${work.id}`,
    source: PIXIV_SOURCE,
  };
}

export const pixivAdapter: PlatformAdapter = {
  source: PIXIV_SOURCE,
  resolveCreator: resolvePixivCreator,
  async fetchPosts(creatorId, cursor, _count, options) {
    // 按「作品类型」勾选决定拉哪些列表；复合游标 "type:offset"（插画列表到底后接着漫画）
    const types =
      options?.workTypes && options.workTypes.length
        ? options.workTypes
        : ['illust', 'manga'];
    const needIllust = types.includes('illust') || types.includes('ugoira');
    const needManga = types.includes('manga');
    const matches = (w: PixivWork) => types.includes(w.type);
    const first = needIllust ? 'illust' : needManga ? 'manga' : null;
    if (!first) return { posts: [], cursor: null };

    const [t, offStr] = (cursor || `${first}:0`).split(':');
    const type: 'illust' | 'manga' = t === 'manga' ? 'manga' : 'illust';
    const offset = Number(offStr) || 0;
    const { works, nextOffset } = await fetchPixivWorks(
      creatorId,
      offset,
      type,
    );
    const posts = await mapLimit(works.filter(matches), 4, (w) =>
      workToPost(w),
    );
    let next: string | null;
    if (nextOffset !== null) next = `${type}:${nextOffset}`;
    else if (type === 'illust' && needManga) next = 'manga:0';
    else next = null;
    return { posts, cursor: next };
  },
};
