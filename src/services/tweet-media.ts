import { getUser, getUserMedias } from '../twitter/api';
import { bestVideoUrl } from './retweets';

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('DL');
  return _log;
}

const cache = new Map<string, string | null>();

/**
 * 按「用户名 + 推文 ID」反查该推文的视频/GIF 直链（mp4）。
 * 用途：本地文件被删、且下载历史里没存直链时，重新从用户媒体流里找回来（带 Cookie、支持敏感推）。
 * 结果缓存；找不到返回 null。
 */
export async function resolveTweetMediaUrl(
  username: string,
  postId: string,
  maxPages = 5,
): Promise<string | null> {
  const key = `${username.toLowerCase()}::${postId}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const user = await getUser(username);
    let cursor: string | null | undefined = undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const { twitterPosts, cursor: next } = await getUserMedias(
        user.id,
        cursor || undefined,
        40,
      );
      if (!twitterPosts || twitterPosts.length === 0) break;
      const hit = twitterPosts.find((p) => String(p.id) === String(postId));
      if (hit) {
        for (const m of hit.medias || []) {
          const url = bestVideoUrl(m);
          if (url) {
            cache.set(key, url);
            return url;
          }
        }
        break;
      }
      if (!next) break;
      cursor = next;
    }
  } catch (err) {
    log().warn('反查推文媒体失败', { username, postId, err });
  }
  cache.set(key, null);
  return null;
}
