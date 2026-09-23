import { fs, notification, path } from '@tauri-apps/api';
import { nanoid } from 'nanoid';
import * as R from 'ramda';
import { create } from 'zustand';
import { CreationTask } from '../interfaces/CreationTask';
import { DownloadFilter } from '../interfaces/DownloadFilter';
import { DownloadTask } from '../interfaces/DownloadTask';
import { AriaStatus, aria2 } from '../utils/aria2';
import { getUserMedias, getUserTweets } from '../twitter/api';
import { useSettingsStore } from './settings';
import { resolveVariables } from '../utils/file-name-template';
import { FileNameTemplateData } from '../interfaces/FileNameTemplateData';
import {
  getAdapter,
  PlatformCreator,
  PlatformMedia,
  PlatformPost,
  PlatformSource,
  withCreator,
} from '../platforms';
import { toPlatformPost } from '../platforms/twitter';
import { unicodeFilenamify } from '../utils/unicode';
import dayjs from 'dayjs';
import { notification as antNotification } from 'antd';
import { EventEmitter } from '../utils/event';
import { delay } from '../utils';

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('DL');
  return _log;
}

/** 下载任务完成事件（携带任务信息，订阅功能借此统计字节数） */
export const onTaskCompleted = new EventEmitter<DownloadTask>();

export interface CreateDownloadTaskParams {
  source: PlatformSource;
  post: PlatformPost;
  media: PlatformMedia;
  subscriptionId?: string;
}

async function mergeAriaStatusToDownloadTask(
  ariaStatus: any,
  oldTask: DownloadTask,
  now = Date.now(),
): Promise<DownloadTask> {
  return {
    ...oldTask,
    gid: ariaStatus.gid,
    status: ariaStatus.status,
    completeSize: Number(ariaStatus.completedLength),
    totalSize: Number(ariaStatus.totalLength),
    downloadSpeed: Number(ariaStatus.downloadSpeed) || 0,
    fileName: await path.basename(ariaStatus.files[0].path),
    error: ariaStatus.errorMessage,
    dir: ariaStatus.dir,
    updatedAt: now,
  };
}

/**
 * 计算归档站（pawchive）帖子的保存目录：saveDirBase/创作者名/帖子标题。
 * 帖子含外链时目录名加 [needDL] 后缀，并幂等写入外链清单 txt（标题 + 外链）。
 * 供 prepareDownloadTask（有附件帖）与 checkArchiverSubscription（纯外链帖）复用。
 */
export async function prepareArchiverPostDir(
  post: PlatformPost,
): Promise<{ dir: string; hasExternalLinks: boolean }> {
  const settings = useSettingsStore.getState();
  const creatorName = unicodeFilenamify(
    post.creator?.name || post.creator?.username || 'unknown',
  );
  let postTitle = unicodeFilenamify(post.text || post.id || 'untitled');
  const hasExternalLinks = (post.links?.length || 0) > 0;
  if (hasExternalLinks) {
    postTitle = `${postTitle}[needDL]`;
  }
  const dir = await path.join(
    settings.download.saveDirBase,
    creatorName,
    postTitle,
  );
  if (hasExternalLinks) {
    // 幂等写入外链清单（同一帖多附件重复调用时避免重复写）；写入前确保目录存在
    const txtPath = await path.join(dir, '链接清单.txt');
    if (!(await fs.exists(txtPath))) {
      await fs.createDir(dir, { recursive: true });
      await fs.writeTextFile(
        txtPath,
        [`标题：${post.text || post.id || ''}`, ...(post.links || []), ''].join(
          '\n',
        ),
      );
    }
  }
  return { dir, hasExternalLinks };
}

async function prepareDownloadTask({
  source,
  post,
  media,
  subscriptionId,
}: CreateDownloadTaskParams): Promise<DownloadTask> {
  const settings = useSettingsStore.getState();
  const downloadUrl = media.downloadUrl || media.url;
  if (!downloadUrl) {
    throw new Error('媒体没有下载链接');
  }

  let dir: string;
  let fileName: string;

  if (source !== 'twitter') {
    // 归档站（pawchive）：固定两级目录，附件保留原始文件名
    const { dir: archiverDir } = await prepareArchiverPostDir(post);
    dir = archiverDir;
    fileName = media.fileName || `file-${media.id || Date.now()}`;
  } else {
    // twitter：走文件名模板机制
    const templateData: FileNameTemplateData = { media, post };
    const resolvedDirName = settings.download.dirTemplate
      ? resolveVariables(settings.download.dirTemplate, templateData)
      : '';
    log().info('resolved dirName', resolvedDirName);
    dir = await path.join(settings.download.saveDirBase, resolvedDirName);
    log().info('resolved dir', dir);

    fileName = resolveVariables(
      settings.download.fileNameTemplate,
      templateData,
    );
  }

  log().info('resolved fileName', fileName);

  const task: DownloadTask = {
    gid: '',
    source,
    status: AriaStatus.Waiting,
    completeSize: 0,
    totalSize: Infinity,
    fileName,
    media,
    post,
    error: '',
    dir,
    updatedAt: Date.now(),
    downloadUrl,
    ariaRetryCountRemains: 5,
    subscriptionId,
  };

  return task;
}

const creationTaskAbortControllerMap = new Map<string, AbortController>();

/** 构造 aria2 addUri 的选项：归档站下载加浏览器 UA + Referer，降低 Cloudflare 限流（429） */
function aria2DownloadOptions(task: DownloadTask): Record<string, any> {
  const options: Record<string, any> = {
    dir: task.dir,
    out: task.fileName,
  };
  if (task.source !== 'twitter') {
    options.header = [
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer: https://pawchive.pw/',
      'Accept: image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding: gzip, deflate, br',
      'Sec-Fetch-Dest: image',
      'Sec-Fetch-Mode: no-cors',
      'Sec-Fetch-Site: cross-site',
    ];
  }
  return options;
}

export interface DownloadStore {
  currentTab: string;
  setCurrentTab: (tab: string) => void;

  downloadTasks: DownloadTask[];
  autoSyncTaskIds: string[];
  setAutoSyncTaskIds: (ids: string[]) => void;
  createDownloadTask: (params: CreateDownloadTaskParams) => Promise<void>;
  batchCreateDownloadTask: (
    paramsList: CreateDownloadTaskParams[],
  ) => Promise<void>;
  pauseDownloadTask: (gid: string) => Promise<void>;
  pauseAllDownloadTask: () => Promise<void>;
  unpauseDownloadTask: (gid: string) => Promise<void>;
  unpauseAllDownloadTask: () => Promise<void>;
  removeDownloadTask: (gid: string) => Promise<void>;
  batchRemoveDownloadTasks: (gids: string[]) => Promise<void>;
  syncDownloadTaskStatus: (gid: string) => Promise<void>;
  updateDownloadTask: (task: DownloadTask, now?: number) => void;
  batchUpdateDownloadTasks: (tasks: DownloadTask[]) => void;
  redownloadTask: (gid: string) => Promise<void>;
  batchRedownloadTask: (gid: string[]) => Promise<void>;

  creationTasks: CreationTask[];
  createCreationTask: (
    source: PlatformSource,
    creator: PlatformCreator,
    filter: DownloadFilter,
  ) => void;
  removeCreationTask: (id: string) => void;
  updateCreationTask: (task: CreationTask) => void;
}

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  currentTab: '',
  setCurrentTab: (tab) => set({ currentTab: tab }),

  autoSyncTaskIds: [],
  setAutoSyncTaskIds: (ids) => set({ autoSyncTaskIds: ids }),

  downloadTasks: [],
  createDownloadTask: async (params) => {
    const task = await prepareDownloadTask(params);

    const gid = await aria2.invoke(
      'aria2.addUri',
      [task.downloadUrl],
      aria2DownloadOptions(task),
    );
    task.gid = gid;

    const status = await aria2.tellStatus(task.gid);
    task.status = status.status;

    set({
      downloadTasks: get().downloadTasks.concat(task),
    });
  },
  updateDownloadTask: (task, now = Date.now()) => {
    const oldTasks = get().downloadTasks;
    const oldTaskIndex = get().downloadTasks.findIndex(
      (t) => t.gid === task.gid,
    );
    if (oldTaskIndex === -1) return;
    const oldTask = oldTasks[oldTaskIndex];
    if (oldTask.updatedAt > now) return;
    const newTasks = R.adjust(oldTaskIndex, R.always(task))(oldTasks);
    set({
      downloadTasks: newTasks,
    });
  },
  batchUpdateDownloadTasks: (tasks) => {
    const { downloadTasks: oldTasks } = get();
    const newTaskMap = R.pipe<
      [DownloadTask[]],
      [DownloadTask['gid'], DownloadTask][],
      Record<string, DownloadTask>
    >(
      R.map((t: DownloadTask) => [t.gid, t]),
      R.fromPairs,
    )(tasks);

    const newTasks = oldTasks.map((oldTask) => {
      const newTask = newTaskMap[oldTask.gid];
      if (!newTask) return oldTask;
      if (newTask.updatedAt < oldTask.updatedAt) {
        return oldTask;
      }
      return newTask;
    });

    set({
      downloadTasks: newTasks,
    });
  },
  batchCreateDownloadTask: async (paramsList) => {
    const tasks: DownloadTask[] = [];
    const settings = useSettingsStore.getState();

    for (const params of paramsList) {
      const task = await prepareDownloadTask(params);
      // 跳过本地已存在的同名文件（sameFileSkip 设置开启时），避免重复下载
      if (settings.download.sameFileSkip) {
        const filePath = await path.join(task.dir, task.fileName);
        if (await fs.exists(filePath)) {
          log().info('Skip because sameFileSkip', task.fileName);
          continue;
        }
      }
      tasks.push(task);
    }

    if (tasks.length === 0) {
      return;
    }

    const gids: string[] = (
      await aria2.batchInvoke(
        tasks.map((task) => ({
          methodName: 'aria2.addUri',
          params: [[task.downloadUrl], aria2DownloadOptions(task)],
        })),
      )
    ).flat();

    const statusMap = await aria2.tellStatus(gids);

    tasks.forEach((task, index) => {
      task.gid = gids[index];
      task.status = statusMap[task.gid]?.status || AriaStatus.Active;
    });

    const newTasks = get().downloadTasks.concat(tasks);
    set({
      downloadTasks: newTasks,
    });
  },
  pauseDownloadTask: async (gid) => {
    await aria2.invoke('aria2.pause', gid);
  },
  pauseAllDownloadTask: async () => {
    await aria2.invoke('aria2.pauseAll');
  },
  unpauseDownloadTask: async (gid) => {
    await aria2.invoke('aria2.unpause', gid);
  },
  unpauseAllDownloadTask: async () => {
    await aria2.invoke('aria2.unpauseAll');
  },
  removeDownloadTask: async (gid) => {
    aria2.invoke('aria2.remove', gid).catch((err) => {
      log().warn('Remove aria2 task failed', { gid, err });
    });
    const state = get();
    set({
      downloadTasks: R.filter((v: DownloadTask) => v.gid !== gid)(
        state.downloadTasks,
      ),
      autoSyncTaskIds: R.filter((v: string) => v !== gid)(
        state.autoSyncTaskIds,
      ),
    });
  },
  batchRemoveDownloadTasks: async (gids) => {
    aria2
      .batchInvoke(
        gids.map((gid) => ({
          methodName: 'aria2.remove',
          params: [gid],
        })),
      )
      .catch((err) => {
        log().error({ gids, err });
      });
    set({
      downloadTasks: R.filter((v: DownloadTask) => !gids.includes(v.gid))(
        get().downloadTasks,
      ),
    });
  },
  redownloadTask: async (gid) => {
    const store = get();
    const oldTask = store.downloadTasks.find((t) => t.gid === gid);
    if (!oldTask) {
      throw new Error('找不到旧的下载任务');
    }
    await store.removeDownloadTask(oldTask.gid);
    await store.createDownloadTask({
      source: oldTask.source,
      post: oldTask.post,
      media: oldTask.media,
    });
  },
  batchRedownloadTask: async (gids) => {
    const store = get();
    const oldTasks = store.downloadTasks.filter((t) => gids.includes(t.gid));
    if (oldTasks.length === 0) {
      throw new Error('找不到旧的下载任务');
    }

    await store.batchRemoveDownloadTasks(gids);
    await store.batchCreateDownloadTask(
      oldTasks.map((task) => ({
        source: task.source,
        media: task.media,
        post: task.post,
      })),
    );
  },
  syncDownloadTaskStatus: async (gid) => {
    const { downloadTasks, updateDownloadTask, removeDownloadTask } = get();
    const index = downloadTasks.findIndex((v) => v.gid === gid);
    if (index === -1) {
      return;
    }
    const task = downloadTasks[index];
    const now = Date.now();
    const status = await aria2.tellStatus(gid);

    if (status.status === 'error') {
      if (task.ariaRetryCountRemains > 0) {
        const errMsg = status.errorMessage || '';
        try {
          // Cloudflare 限流/禁止（429/403）时退避再重试，避免重试风暴加剧封禁
          if (/429|403|Too Many|Forbidden/i.test(errMsg)) {
            await delay(5000);
          }
          // 原图 404（pawchive 部分附件未标 preview_only 但原图未归档）：改用缩略图重试
          const useThumb =
            /Resource not found|status=404|404/i.test(errMsg) &&
            !!task.media?.thumbUrl &&
            task.downloadUrl !== task.media.thumbUrl;
          const retryUrl: string = useThumb
            ? task.media.thumbUrl!
            : task.downloadUrl;

          log().warn(
            `Task download failed, retry it. RetryCountRemains: ${task.ariaRetryCountRemains}`,
            { ...task, useThumb },
          );

          const newTask = await prepareDownloadTask({
            source: task.source,
            post: task.post,
            media: task.media,
          });
          newTask.ariaRetryCountRemains = task.ariaRetryCountRemains - 1;
          newTask.downloadUrl = retryUrl;

          const newGid = await aria2.invoke(
            'aria2.addUri',
            [retryUrl],
            aria2DownloadOptions(newTask),
          );
          newTask.gid = newGid;

          // 用新 gid 查询（旧 gid 已被移除，查旧 gid 会抛错导致新任务丢失）
          const newStatus = await aria2.tellStatus(newGid);
          newTask.status = newStatus.status;

          // 新任务成功加入后再移除旧任务，避免任何一步抛错导致任务从列表消失
          removeDownloadTask(task.gid);
          set({
            downloadTasks: get().downloadTasks.concat(newTask),
          });
        } catch (retryErr) {
          // 重试过程异常（prepare/addUri/tellStatus 抛错）：保留旧任务为错误状态，不丢失
          log().error('Retry failed, keep task as error', {
            gid: task.gid,
            retryErr,
          });
          updateDownloadTask(
            {
              ...task,
              status: AriaStatus.Error,
              error:
                typeof retryErr === 'string'
                  ? retryErr
                  : (retryErr as any)?.message || '重试失败',
            },
            now,
          );
        }
      } else {
        const newTask = await mergeAriaStatusToDownloadTask(status, task);
        const msg = '任务下载失败';
        const desc = `${newTask.fileName}\n${newTask.error || '未知原因'}`;
        log().error('Task download failed', newTask);
        antNotification.error({
          message: msg,
          description: desc,
        });
        notification.sendNotification({
          title: msg,
          body: desc,
        });
      }
    } else {
      const newTask = await mergeAriaStatusToDownloadTask(status, task);
      updateDownloadTask(newTask, now);

      // 任务首次完成时触发，供订阅统计与下载历史记录使用
      if (status.status === 'complete' && task.status !== 'complete') {
        onTaskCompleted.emit(newTask);
      }
    }
  },

  creationTasks: [],
  createCreationTask: (source, creator, filter) => {
    const id = nanoid();
    const abortController = new AbortController();
    creationTaskAbortControllerMap.set(id, abortController);
    set({
      creationTasks: [
        ...get().creationTasks,
        {
          id,
          source,
          creator,
          filter,
          status: 'waiting',
          completeCount: 0,
          skipCount: 0,
        },
      ],
    });
  },
  removeCreationTask: (id) => {
    const abortController = creationTaskAbortControllerMap.get(id);
    if (!abortController) {
      return;
    }
    abortController.abort();
    creationTaskAbortControllerMap.delete(id);
    set({
      creationTasks: get().creationTasks.filter((v) => v.id !== id),
    });
  },
  updateCreationTask: (task) => {
    set({
      creationTasks: get().creationTasks.map((oldTask) => {
        if (oldTask.id === task.id) return task;
        return oldTask;
      }),
    });
  },
}));

async function runCreationTask(task: CreationTask, abortSignal: AbortSignal) {
  log().info('Run creation task', task);
  const { filter, creator, source } = task;

  const { batchCreateDownloadTask, updateCreationTask } =
    useDownloadStore.getState();
  const settings = useSettingsStore.getState();

  let completeCount = 0;
  let skipCount = 0;

  let now = dayjs();
  const since = filter.dateRange?.[0] || dayjs.unix(0);
  const until = filter.dateRange?.[1] || now.clone();
  let nextCursor: string | undefined | null = undefined;

  // 按平台分发「拉一页」：twitter 走原始 api（转 Platform 模型），归档站走适配器
  const fetchPage = async (
    cursor?: string,
  ): Promise<{ posts: PlatformPost[]; cursor: string | null }> => {
    if (source === 'twitter') {
      const getListFn =
        filter.source === 'medias' ? getUserMedias : getUserTweets;
      const { twitterPosts, cursor: next } = await getListFn(
        creator.id,
        cursor,
      );
      return { posts: twitterPosts.map(toPlatformPost), cursor: next };
    }
    const adapter = getAdapter(source);
    return adapter.fetchPosts(creator.id, cursor, 50);
  };

  const getMediaCounts = R.reduce((acc: number, elem: PlatformPost) => {
    return acc + (elem.medias?.length || 0);
  }, 0);

  while (nextCursor !== null && now.isAfter(since)) {
    if (abortSignal.aborted) {
      return;
    }

    log().info('CreationTask fetching', nextCursor);
    const { posts, cursor } = await fetchPage(nextCursor);
    if (abortSignal.aborted) break;
    nextCursor = cursor;
    // 本页最早帖时间作为推进基线；若本页全无发布时间则视为到底，避免死循环
    const lastPub = R.last(posts)?.publishedAt;
    now = lastPub || dayjs.unix(0);
    log().info('Now', now.format('YYYY-MM-DD'), 'next cursor', nextCursor);
    // fetchPosts 返回的帖子 creator 无 name，填充已解析的 creator（目录命名用创作者名）
    const enrichedPosts = withCreator(posts, task.creator);
    const filteredPosts = enrichedPosts.filter(
      R.allPass([
        (post) => (post.medias ? post.medias.length >= 0 : false),
        (post) => {
          if (!post.publishedAt) return true;
          return until ? post.publishedAt.isBefore(until) : true;
        },
        (post) => {
          if (!post.publishedAt) return true;
          return since ? post.publishedAt.isAfter(since) : true;
        },
      ]),
    );

    const filteredCount = getMediaCounts(posts) - getMediaCounts(filteredPosts);
    skipCount += filteredCount;
    log().info('FilteredPosts', filteredPosts);

    if (filteredPosts.length === 0) {
      updateCreationTask({
        ...task,
        completeCount,
        skipCount,
      });
      continue;
    }

    const paramsList: CreateDownloadTaskParams[] = [];

    for (const post of filteredPosts) {
      const filteredMedias = (post.medias || []).filter(
        R.allPass([
          (media) => {
            if (!filter.mediaTypes) return false;
            return filter.mediaTypes.includes(media.type);
          },
        ]),
      );

      log().info('FilteredMedias', filteredMedias);
      for (const media of filteredMedias) {
        const prepared = await prepareDownloadTask({
          source,
          post,
          media,
        });
        log().info('Prepared download task', prepared);
        const filePath = await path.join(prepared.dir, prepared.fileName);
        log().info('Resolved file path', filePath);
        if (settings.download.sameFileSkip && (await fs.exists(filePath))) {
          skipCount++;
          log().info('Skip because sameFileSkip', media);
          continue;
        }
        paramsList.push({
          source,
          media,
          post,
        });
      }
    }

    log().info('Params', paramsList);

    if (paramsList.length === 0) {
      updateCreationTask({
        ...task,
        completeCount,
        skipCount,
      });
      continue;
    }

    await batchCreateDownloadTask(paramsList);
    completeCount += paramsList.length;
    updateCreationTask({
      ...task,
      completeCount,
      skipCount,
    });

    if (abortSignal.aborted) break;
  }
}

// Schedules creation tasks
async function scheduleCreationTasks() {
  const { creationTasks, removeCreationTask, updateCreationTask } =
    useDownloadStore.getState();

  if (R.isEmpty(creationTasks)) {
    requestIdleCallback(scheduleCreationTasks);
    return;
  }

  // Check if there was a creation task running
  if (creationTasks.find((task) => task.status === 'active')) {
    requestIdleCallback(scheduleCreationTasks);
    return;
  }

  // Pick one waiting task from head
  const task = R.head(creationTasks) as CreationTask;
  const abortController = creationTaskAbortControllerMap.get(
    task.id,
  ) as AbortController;

  if (abortController.signal.aborted) {
    log().info('Aborted creation task, remove it', task);
    removeCreationTask(task.id);
    requestIdleCallback(scheduleCreationTasks);
    return;
  }

  task.status = 'active';
  updateCreationTask(task);

  try {
    await runCreationTask(task, abortController.signal);
    log().info('Completed creation task, remove it', task);
    removeCreationTask(task.id);
  } catch (err: any) {
    log().error('runCreationTaskError', err);
    removeCreationTask(task.id);
    const reason = typeof err === 'string' ? err : err?.message || '未知原因';
    notification.sendNotification({
      title: '爬虫任务运行失败',
      body: reason,
    });
    antNotification.error({
      message: `爬虫任务运行失败：${reason}`,
    });
  }

  requestIdleCallback(scheduleCreationTasks);
}

scheduleCreationTasks();

const INTERVAL = 500;
// Auto sync tasks
async function scheduleAutoSyncTasks() {
  const ids = useDownloadStore.getState().autoSyncTaskIds;
  if (ids.length === 0) {
    setTimeout(scheduleAutoSyncTasks, INTERVAL);
    return;
  }

  const now = Date.now();
  const resultMap = await aria2.tellStatus(ids);
  const { downloadTasks, batchUpdateDownloadTasks } =
    useDownloadStore.getState();
  const newTasks = await Promise.all(
    downloadTasks.map<Promise<DownloadTask>>(async (oldTask) => {
      // Do not update status after someone updated it during query
      if (oldTask.updatedAt > now) return oldTask;
      if (!resultMap[oldTask.gid]) return oldTask;
      return mergeAriaStatusToDownloadTask(
        resultMap[oldTask.gid],
        oldTask,
        now,
      );
    }),
  );

  batchUpdateDownloadTasks(newTasks);

  setTimeout(scheduleAutoSyncTasks, INTERVAL);
}

scheduleAutoSyncTasks();
