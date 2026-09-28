import MediaType from '../enums/MediaType';
import { PlatformSource } from '../platforms/types';

export type SubscriptionStatus = 'idle' | 'running' | 'error' | 'paused';

/**
 * 转贴模式（转贴从头到尾都不下载，只进时间流）：
 * - off：不抓转贴
 * - include：抓转贴进时间流（原创照常下载）
 * - only：只抓转贴进时间流，**不下载任何内容**
 */
export type RetweetMode = 'off' | 'include' | 'only';

export interface Subscription {
  id: string;
  /** 平台源：twitter / pawchive（旧数据 migrate 时补为 twitter，kemono 迁移为 pawchive） */
  source: PlatformSource;
  /** 用户 ID（screenName），Pawchive 为 service/数字ID 形式 */
  username: string;
  /** 用户昵称，用于展示（可空，轮询时刷新） */
  displayName?: string;
  /** 头像地址（可空，轮询时刷新） */
  avatar?: string;
  /** 刷新间隔（分钟） */
  intervalMin: number;
  /** 是否启用 */
  enabled: boolean;
  /** 媒体类型过滤 */
  mediaTypes: MediaType[];
  /** 转贴模式（见 RetweetMode；默认 off）。读取请用 retweetModeOf() 兼容旧数据 */
  retweetMode?: RetweetMode;
  /** @deprecated 旧字段（v6 及以前），由 retweetMode 取代；仅用于数据迁移 */
  includeRetweets?: boolean;
  /** 上次检查到的最后一条推文 id，用于增量去重 */
  lastTweetId?: string;
  /** 上次成功检查时间 */
  lastCheckedAt?: number;
  /** 累计下载数量 */
  downloadedCount: number;
  /** 每日新增下载量，key 为 YYYY-MM-DD，value 为 { 数量, 字节数 } */
  dailyStats: Record<string, { count: number; bytes: number }>;
  status: SubscriptionStatus;
  /** 最近一次错误信息 */
  errorMessage?: string;
}
