import { TwitterMedia } from '../interfaces/TwitterMedia';
import { TwitterPost } from '../interfaces/TwitterPost';
import { TwitterUser } from '../interfaces/TwitterUser';
import { getUser, getUserMedias, getUserTweets } from '../twitter/api';
import { buildPostUrl, buildUserUrl } from '../twitter/url';
import { getDownloadUrl as twitterGetDownloadUrl } from '../twitter/utils';
import {
  PlatformAdapter,
  PlatformCreator,
  PlatformMedia,
  PlatformPage,
  PlatformPost,
} from './types';

/** X（Twitter）平台标识 */
export const TWITTER_SOURCE = 'twitter';

export function toPlatformCreator(user: TwitterUser): PlatformCreator {
  return {
    id: user.id,
    name: user.name,
    username: user.screenName,
    avatar: user.avatar,
    profileUrl: buildUserUrl(user.screenName),
  };
}

export function toPlatformMedia(media: TwitterMedia): PlatformMedia {
  let downloadUrl: string | undefined;
  try {
    downloadUrl = twitterGetDownloadUrl(media);
  } catch (err) {
    // 媒体缺链接等场景不阻断转换，下载时报错由下载层处理
    downloadUrl = undefined;
  }
  return {
    id: media.id,
    type: media.type,
    url: media.url,
    thumbUrl: media.url ? `${media.url}?format=jpg&name=thumb` : undefined,
    width: media.width,
    height: media.height,
    downloadUrl,
    videoInfo: 'videoInfo' in media ? media.videoInfo : undefined,
  };
}

export function toPlatformPost(post: TwitterPost): PlatformPost {
  return {
    id: post.id,
    creator: toPlatformCreator(post.user),
    publishedAt: post.createdAt,
    text: post.fullText,
    medias: post.medias?.map(toPlatformMedia),
    tags: post.tags,
    postUrl: post.user?.screenName
      ? buildPostUrl(post.user.screenName, post.id)
      : undefined,
    source: TWITTER_SOURCE,
  };
}

export function toPlatformPage(page: {
  twitterPosts: TwitterPost[];
  cursor: string | null;
}): PlatformPage {
  return {
    posts: page.twitterPosts.map(toPlatformPost),
    cursor: page.cursor,
  };
}

/**
 * X（Twitter）平台适配器：包装现有 twitter/api，暴露统一模型。
 * fetchPosts 默认走媒体流（getUserMedias），与订阅/主页行为一致。
 */
export const twitterAdapter: PlatformAdapter = {
  source: TWITTER_SOURCE,
  async resolveCreator(identifier: string) {
    return toPlatformCreator(await getUser(identifier));
  },
  async fetchPosts(creatorId: string, cursor?: string, count = 20) {
    return toPlatformPage(await getUserMedias(creatorId, cursor, count));
  },
};

/** 附加导出：拉推文流（非媒体流）的能力，供需要完整时间线的场景使用 */
export async function fetchTwitterTweetsPage(
  creatorId: string,
  cursor?: string,
  count = 20,
): Promise<PlatformPage> {
  return toPlatformPage(await getUserTweets(creatorId, cursor, count));
}
