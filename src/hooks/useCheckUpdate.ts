import { useLockFn } from 'ahooks';
import { getLatestReleases } from '../github/api';
import { isVersionGt } from '../utils/version';
import { ask } from '@tauri-apps/api/dialog';
import { open } from '@tauri-apps/api/shell';

export function useCheckUpdate() {
  return useLockFn(async () => {
    const release = await getLatestReleases(false);
    if (!release) {
      throw new Error('无法获取最新软件版本');
    }
    const latestVersion = release.tag_name.slice(1) as string;

    if (isVersionGt(latestVersion, PACKAGE_JSON_VERSION)) {
      ask('软件有最新版本，是否前往下载？', {
        title: '更新提示',
        okLabel: '现在就去',
        cancelLabel: '下次一定',
      }).then((result) => {
        if (result) {
          open(release.html_url);
        }
      });
      return true;
    }
    return false;
  });
}
