import { invoke, shell } from '@tauri-apps/api';
import { createCrossPlatformInvoker } from './cross-platform';

export const showInFolder = createCrossPlatformInvoker<
  (path: string, isFile?: boolean) => Promise<void>
>({
  async windows(path: string, isFile = false) {
    await new shell.Command(
      'explorer',
      isFile ? ['/select,', path] : [path],
    ).execute();
  },
});

/** 用系统默认程序打开文件/文件夹 */
export async function openPath(path: string): Promise<void> {
  await shell.open(path);
}

/** 用系统默认浏览器打开外部链接 */
export async function openUrl(url: string): Promise<void> {
  await shell.open(url);
}

/**
 * 打开链接并把浏览器窗口提到最前（Rust 端 AllowSetForegroundWindow + SetForegroundWindow）。
 * 用于以图搜图：app 不在前台时（资源管理器右键启动 / 最小化到托盘）也能看见结果。
 * 非 Tauri 环境回退到 shell.open。
 */
export async function openUrlForeground(url: string): Promise<void> {
  if (!('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) {
    await shell.open(url);
    return;
  }
  try {
    await invoke('open_url_foreground', { url });
  } catch (err) {
    log.warn('open_url_foreground 失败，回退 shell.open', err);
    await shell.open(url);
  }
}
