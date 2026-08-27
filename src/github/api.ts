import { request } from '../ipc/network';
import * as R from 'ramda';

const REPO_API_URL = 'https://api.github.com/repos/mdo730/P-spider/releases';

export interface GithubRelease {
  tag_name: string;
  html_url: string;
  prerelease: boolean;
}

export async function getLatestReleases(
  pre = false,
): Promise<GithubRelease | null> {
  let url = REPO_API_URL;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const resp = await request({
      method: 'GET',
      responseType: 'text',
      url,
      headers: {
        'User-Agent': 'P-Spider',
      },
    });

    if (resp.status !== 200) {
      throw new Error('无法获取最新软件版本，请稍后再试。');
    }

    const body = JSON.parse(resp.body);

    if (!body[0]) {
      throw new Error('无法获取最新软件版本，请稍后再试。');
    }

    if (pre) {
      return body[0] || null;
    }

    const latest = body.find((item: any) => !item.prerelease);

    if (latest) {
      return latest;
    }

    if (!resp.headers.link || resp.headers.link.length === 0) {
      return null;
    }

    const links = R.fromPairs(
      resp.headers.link[0].split(', ').map((item: string) => {
        const [link, rel] = item.split('; rel=');
        return [rel.replace(/"(.+)"/, '$1'), link.replace(/<(.+)>/, '$1')];
      }),
    );

    if (!links.next) return null;

    url = links.next;
  }
}
