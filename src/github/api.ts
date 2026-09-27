import { request } from '../ipc/network';

// 用 releases.atom 订阅源而非 api.github.com：
// 匿名调用 GitHub REST API 很容易触发限流（403 rate limit，代理出口 IP 常被共享）。
const FEED_URL = 'https://github.com/mdo730/P-spider/releases.atom';

export interface GithubRelease {
  tag_name: string;
  html_url: string;
  prerelease: boolean;
}

/** 取最新 release（atom feed 第一条，按时间倒序） */
export async function getLatestReleases(): Promise<GithubRelease | null> {
  const resp = await request({
    method: 'GET',
    responseType: 'text',
    url: FEED_URL,
    headers: {
      'User-Agent': 'P-Spider',
      Accept: 'application/atom+xml',
    },
  });

  if (resp.status !== 200) {
    throw new Error('无法获取最新软件版本，请稍后再试。');
  }

  const body = String(resp.body || '');
  // 第一条 entry 即最新
  const m = /<entry>[\s\S]*?<link[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(
    body,
  );
  if (!m) return null;
  const html_url = m[1];
  const tm = html_url.match(/\/releases\/tag\/([^/?#]+)/);
  if (!tm) return null;
  return { tag_name: tm[1], html_url, prerelease: false };
}
