import { fs, invoke, notification, path } from '@tauri-apps/api';
import { listen } from '@tauri-apps/api/event';
import { nanoid } from 'nanoid';
import MediaType from '../enums/MediaType';
import { DownloadTask } from '../interfaces/DownloadTask';
import { PlatformMedia, PlatformPost } from '../platforms';
import { useAppStateStore } from '../stores/app-state';
import { prepareArchiverPostDir, useDownloadStore } from '../stores/download';
import { useSettingsStore } from '../stores/settings';
import { AriaStatus } from '../utils/aria2';

/**
 * MEGA 公开链接自动下载（自研 Rust 解码，不走 aria2）。
 * 归档站（pawchive）帖子正文里的 mega.nz 链接会在批量/订阅下载时
 * 自动解析并下载到该帖子目录下的 `mega/` 子夹，并以独立任务出现在下载管理。
 */

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('MEGA');
  return _log;
}

/** 是否为 mega.nz 链接（含子域） */
export function isMegaLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'mega.nz' || host.endsWith('.mega.nz');
  } catch {
    return false;
  }
}

/** 抽出帖子里的 MEGA 链接 */
export function extractMegaLinks(post: PlatformPost): string[] {
  return (post.links || []).filter(isMegaLink);
}

function resolveProxyUrl(): string {
  const settings = useSettingsStore.getState();
  if (!settings.proxy.enable) return '';
  return settings.proxy.useSystem
    ? useAppStateStore.getState().systemProxyUrl
    : settings.proxy.url;
}

interface MegaProgress {
  id: string;
  written: number;
  total: number;
}

let listenerReady = false;

/** 懒注册 mega-progress 事件监听（仅 Tauri 环境；失败不致命） */
async function ensureProgressListener(): Promise<void> {
  if (listenerReady) return;
  listenerReady = true;
  try {
    await listen<MegaProgress>('mega-progress', (e) => {
      const { id, written, total } = e.payload;
      const store = useDownloadStore.getState();
      const task = store.downloadTasks.find((t) => t.gid === id);
      if (!task) return;
      store.updateDownloadTask({
        ...task,
        status: AriaStatus.Active,
        completeSize: written,
        totalSize: total || task.totalSize,
        updatedAt: Date.now(),
      });
    });
  } catch (err) {
    log().warn('mega-progress 监听注册失败', err);
  }
}

/**
 * 下载单个 MEGA 链接到 dir，作为独立任务进下载管理并实时更新进度。
 * 失败时任务标记为 error 并抛错（由上层决定是否提示）。
 */
export async function downloadMegaLink(
  url: string,
  post: PlatformPost,
  dir: string,
): Promise<void> {
  await ensureProgressListener();
  const store = useDownloadStore.getState();
  const gid = `mega:${nanoid()}`;
  const media: PlatformMedia = {
    id: url,
    type: MediaType.Photo,
    url,
    downloadUrl: url,
    fileName: 'MEGA',
  };
  const baseTask: DownloadTask = {
    gid,
    source: post.source || 'pawchive',
    post,
    media,
    fileName: 'MEGA 下载中…',
    dir,
    totalSize: Infinity,
    completeSize: 0,
    status: AriaStatus.Active,
    updatedAt: Date.now(),
    downloadUrl: url,
    ariaRetryCountRemains: 0,
    isMega: true,
  };
  store.addExternalDownloadTask(baseTask);

  try {
    const res = await invoke<{
      bytes: number;
      count: number;
      root: string;
      is_dir: boolean;
    }>('mega_download', {
      url,
      outDir: dir,
      proxyUrl: resolveProxyUrl(),
      progressId: gid,
    });
    useDownloadStore.getState().updateDownloadTask({
      ...baseTask,
      status: AriaStatus.Complete,
      completeSize: res.bytes,
      totalSize: res.bytes,
      fileName: res.root || 'MEGA',
      updatedAt: Date.now(),
    });
  } catch (err: any) {
    useDownloadStore.getState().updateDownloadTask({
      ...baseTask,
      status: AriaStatus.Error,
      error: typeof err === 'string' ? err : err?.message || '未知原因',
      updatedAt: Date.now(),
    });
    throw err;
  }
}

interface MegaJob {
  post: PlatformPost;
  url: string;
}

const queue: MegaJob[] = [];
/** 仅在队/进行中的链接 URL，完成后移除 → 允许手动重复下载（内容层面再靠 Rust 跳过已存在文件） */
const inflight = new Set<string>();
let draining = false;

/**
 * 把含 MEGA 链接的帖子加入后台串行下载队列。
 * 去重：① 进行中的链接不重复排队；② 下载管理里已有任务的链接跳过（批量重复检测）。
 * 串行避免多个大文件并发抢带宽；不阻塞调用方（爬虫/订阅循环）。
 */
export function enqueueMegaDownloads(posts: PlatformPost[]): number {
  const known = new Set(
    useDownloadStore
      .getState()
      .downloadTasks.filter((t) => t.isMega)
      .map((t) => t.downloadUrl),
  );
  let added = 0;
  for (const post of posts) {
    for (const url of extractMegaLinks(post)) {
      if (inflight.has(url) || known.has(url)) continue;
      inflight.add(url);
      queue.push({ post, url });
      added++;
    }
  }
  if (added > 0) void drain();
  return added;
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const job = queue.shift()!;
    try {
      const { dir } = await prepareArchiverPostDir(job.post);
      const megaDir = await path.join(dir, 'mega');
      await fs.createDir(megaDir, { recursive: true });
      await downloadMegaLink(job.url, job.post, megaDir);
      notification.sendNotification({
        title: 'MEGA 下载完成',
        body: `${job.post.text || job.post.id}`,
      });
    } catch (err: any) {
      log().error('MEGA 下载失败', { postId: job.post.id, url: job.url, err });
      notification.sendNotification({
        title: 'MEGA 下载失败',
        body: `${job.post.text || job.post.id}：${err?.message || err}`,
      });
    } finally {
      inflight.delete(job.url);
    }
  }
  draining = false;
}
