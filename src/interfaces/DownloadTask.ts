import { AriaStatus } from '../utils/aria2';
import { PlatformMedia, PlatformPost, PlatformSource } from '../platforms';

export interface DownloadTask {
  gid: string;
  /** 平台源，决定目录/文件名生成逻辑（twitter 走模板，pawchive 走两级目录） */
  source: PlatformSource;
  post: PlatformPost;
  media: PlatformMedia;
  fileName: string;
  dir: string;
  totalSize: number;
  completeSize: number;
  /** 当前下载速度（字节/秒，aria2 tellStatus 的 downloadSpeed） */
  downloadSpeed?: number;
  status: AriaStatus;
  error?: string;
  updatedAt: number;
  downloadUrl: string;
  ariaRetryCountRemains: number;
  /** 订阅关联 ID（由订阅功能发起的下载） */
  subscriptionId?: string;
}
