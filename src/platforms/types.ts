import { Dayjs } from 'dayjs';
import MediaType from '../enums/MediaType';

/**
 * 平台统一模型（平台无关）。
 *
 * 已接入平台：twitter（X）、pawchive（归档站）。
 * 新增平台：在 platforms/ 下实现 PlatformAdapter（可复用 archiver 工厂），
 * 注册进 index.ts 的 getAdapter 即可，store 通过 getAdapter(source) 使用。
 * 下载直链解析为平台特有逻辑，由各适配器转换 PlatformMedia 时填充 downloadUrl。
 */

/** 平台标识 */
export type PlatformSource = 'twitter' | 'pawchive' | 'figmemo';

/** 创作者（用户/作者），跨平台统一 */
export interface PlatformCreator {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  /** 平台主页 URL（适配器转换时填充，供 UI 跳转） */
  profileUrl?: string;
}

/** 媒体资源，跨平台统一（type 复用通用 MediaType 枚举） */
export interface PlatformMedia {
  id?: string;
  type: MediaType;
  url?: string;
  thumbUrl?: string;
  width?: number;
  height?: number;
  /**
   * 下载直链（适配器转换时算好）：
   * twitter = orig 原图 / 最高码率视频变体 / gif 视频直链；pawchive = CDN 原链
   */
  downloadUrl?: string;
  /** 原始文件名（pawchive 附件保存用，twitter 走文件名模板忽略） */
  fileName?: string;
  /**
   * 仅预览标记（pawchive 部分帖子的原图未归档，只有缩略图）。
   * 该附件不可下载，网格显示缩略图并标记。
   */
  previewOnly?: boolean;
  /** 平台扩展：视频/动图变体信息（twitter 特有，下载时可自行挑选） */
  videoInfo?: {
    duration?: number;
    variants?: { bitrate?: number; contentType?: string; url?: string }[];
    aspectRatio?: [number, number];
    url?: string;
  };
}

/** 内容（推文/帖子），跨平台统一 */
export interface PlatformPost {
  id: string;
  creator: PlatformCreator;
  publishedAt?: Dayjs;
  text?: string;
  medias?: PlatformMedia[];
  /** 标签（twitter hashtags，pawchive 留空） */
  tags?: string[];
  /** 帖子内外部链接（pawchive 的 embed/正文网盘链接等），供外链清单使用 */
  links?: string[];
  /** 平台详情页 URL（适配器转换时填充，供 UI 跳转） */
  postUrl?: string;
  /** 来源平台（twitter/pawchive），标识下载源 */
  source?: PlatformSource;
}

/** 拉取一页内容的结果 */
export interface PlatformPage {
  posts: PlatformPost[];
  cursor: string | null;
}

/** 平台适配器接口：各平台实现 resolveCreator + fetchPosts */
export interface PlatformAdapter {
  readonly source: PlatformSource;
  /** 按标识（用户名/slug 等）解析创作者 */
  resolveCreator: (identifier: string) => Promise<PlatformCreator>;
  /** 拉取某创作者的一页内容 */
  fetchPosts: (
    creatorId: string,
    cursor?: string,
    count?: number,
  ) => Promise<PlatformPage>;
}
