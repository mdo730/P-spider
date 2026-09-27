import { create } from 'zustand';
import { getLatestReleases } from '../github/api';
import { isVersionGt } from '../utils/version';

/** 版本更新检测（启动 + 每 24h；仅在有新版时给侧栏「关于」加红点引导） */
interface UpdateStore {
  checking: boolean;
  hasUpdate: boolean;
  latestVersion: string | null;
  releaseUrl: string | null;
  check: () => Promise<void>;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  checking: false,
  hasUpdate: false,
  latestVersion: null,
  releaseUrl: null,
  check: async () => {
    if (get().checking) return;
    set({ checking: true });
    try {
      const release = await getLatestReleases();
      if (release) {
        const v = release.tag_name.replace(/^v/i, '');
        if (isVersionGt(v, PACKAGE_JSON_VERSION)) {
          set({
            hasUpdate: true,
            latestVersion: v,
            releaseUrl: release.html_url,
          });
        } else {
          set({ hasUpdate: false, latestVersion: v });
        }
      }
    } catch {
      // 忽略（网络/代理不可用等）
    } finally {
      set({ checking: false });
    }
  },
}));
