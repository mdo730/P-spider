import dayjs from 'dayjs';
import MediaType from '../enums/MediaType';
import { request } from '../ipc/network';
import {
  PlatformAdapter,
  PlatformCreator,
  PlatformMedia,
  PlatformPost,
  PlatformSource,
} from './types';

/**
 * 归档站（kemono 系）通用适配器工厂。
 *
 * kemono / pawchive 等站点共用同一套 API 模型：
 * - GET /api/v1/{service}/user/{id}/posts 拉帖子（offset 分页）
 * - 帖子字段：id/service/user/title/content(HTML)/embed/file/attachments/published
 * - 媒体 path 为相对路径，原图 = {fileRoot}{path}，缩略图 = {thumbRoot}/thumbnail{path}
 * 各站差异集中在：域名、分页参数、创作者解析方式，由 config 注入。
 */

/** 附件类型：按 URL 扩展名推断，无法识别时兜底为照片 */
function resolveMediaType(url: string): MediaType {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
  if (ext === 'gif') return MediaType.Gif;
  if (['mp4', 'webm', 'mov', 'mkv', 'flv'].includes(ext)) {
    return MediaType.Video;
  }
  return MediaType.Photo;
}

function toPlatformMedia(
  att: { name?: string; path?: string; preview_only?: boolean },
  config: ArchiverAdapterConfig,
): PlatformMedia | null {
  if (!att?.path) return null;
  // 归档站 media path 为 /xx/yy/hash.ext（不含 /data），完整 URL 需补 /data 前缀
  const url = `${config.fileRoot}/data${att.path}`;
  const thumbUrl = config.thumbRoot
    ? `${config.thumbRoot}/thumbnail/data${att.path}`
    : url;
  const previewOnly = att.preview_only === true;
  return {
    id: att.name || att.path,
    type: resolveMediaType(att.path),
    url,
    thumbUrl,
    // preview_only 附件原图未归档（404），退而下载缩略图（img.pawchive.pw 保留原格式）
    downloadUrl: previewOnly ? thumbUrl : url,
    fileName: att.name || att.path.split('/').pop() || att.path,
    previewOnly,
  };
}

/** 是否为站点自身域名之外的链接（网盘/外部资源等） */
function isExternalLink(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return !(hostname.includes('kemono') || hostname.includes('pawchive'));
  } catch (err) {
    return false;
  }
}

/** 从 embed 与正文 HTML 中提取外部链接 */
function extractExternalLinks(
  content: string | undefined,
  embed: any,
): string[] {
  const links = new Set<string>();
  if (embed?.url && isExternalLink(embed.url)) {
    links.add(embed.url);
  }
  if (content) {
    const regex = /href=["'](https?:\/\/[^"'#]+)["']/gi;
    for (const m of content.matchAll(regex)) {
      const href = m[1];
      if (isExternalLink(href)) {
        links.add(href.split('#')[0]);
      }
    }
  }
  return Array.from(links);
}

function toPlatformPost(
  post: any,
  creator: PlatformCreator,
  config: ArchiverAdapterConfig,
): PlatformPost {
  const medias: PlatformMedia[] = [
    ...(Array.isArray(post?.attachments) ? post.attachments : []),
    ...(post?.file ? [post.file] : []),
  ]
    .map((att) => toPlatformMedia(att, config))
    .filter((m): m is PlatformMedia => m !== null);

  const service = post.service || creator.username.split('/')[0];
  const userId = creator.id.split('/')[1];
  const postUrl =
    service && userId
      ? `${config.siteRoot}/${service}/user/${userId}/post/${post.id}`
      : undefined;

  return {
    id: String(post.id),
    creator,
    publishedAt: post.published ? dayjs(post.published) : undefined,
    text: post.title || '',
    medias,
    links: extractExternalLinks(post.content, post.embed),
    postUrl,
    source: config.source,
  };
}

export interface ArchiverAdapterConfig {
  source: PlatformSource;
  /** API 根，如 https://pawchive.pw/api/v1 */
  apiRoot: string;
  /** 媒体原图域名根（不含 /data），如 https://file.pawchive.pw */
  fileRoot: string;
  /** 缩略图域名根（不含 /data 与 /thumbnail），如 https://img.pawchive.pw */
  thumbRoot?: string;
  /** 网页根，如 https://pawchive.pw */
  siteRoot: string;
  /** 分页参数名：kemono 用 offset，pawchive 用 o */
  offsetParam: string;
  /** 分页步进：1=按返回数量动态推进；>1=强制固定步进（如 pawchive 强制 50） */
  offsetStep: number;
  /** 附加请求头（如 kemono.cr 需要 Accept: text/css 过反爬） */
  headers?: Record<string, string>;
  /** 绕过代理直连（pawchive 免登录且直连更快） */
  bypassProxy?: boolean;
  /** 请求最大重试次数（直连站点建议 3，避免重试风暴） */
  maxRetry?: number;
  /** 按标识（service/user）解析创作者，各站实现不同 */
  resolveCreatorByIdentifier: (identifier: string) => Promise<PlatformCreator>;
}

/** 解析订阅标识：service/user 二元组（user 为数字 id 或 slug） */
export function parseIdentifier(identifier: string): {
  service: string;
  user: string;
} {
  const [service, user] = identifier.split('/');
  if (!service || !user) {
    throw new Error('订阅格式应为 service/user，如 patreon/3295915');
  }
  return { service, user };
}

export function createArchiverAdapter(
  config: ArchiverAdapterConfig,
): PlatformAdapter {
  return {
    source: config.source,
    resolveCreator: config.resolveCreatorByIdentifier,
    async fetchPosts(creatorId: string, cursor?: string) {
      const [service, userId] = creatorId.split('/');
      if (!service || !userId) {
        throw new Error(`非法的 creatorId: ${creatorId}`);
      }
      const offset = cursor ? Number(cursor) : 0;
      const resp = await request({
        method: 'GET',
        responseType: 'json',
        url: `${config.apiRoot}/${service}/user/${userId}/posts`,
        query: { [config.offsetParam]: offset },
        headers: config.headers,
        bypassProxy: config.bypassProxy,
        maxRetry: config.maxRetry,
      });
      if (resp.status >= 400) {
        throw new Error(`拉取帖子失败（status=${resp.status}）`);
      }
      const list = (resp.body as any[]) || [];
      const creator: PlatformCreator = {
        id: creatorId,
        name: '',
        username: creatorId,
      };
      const posts = list.map((p) => toPlatformPost(p, creator, config));

      let nextOffset: number | null;
      if (list.length === 0) {
        nextOffset = null;
      } else if (config.offsetStep > 1 && list.length < config.offsetStep) {
        // 强制步进的站点不满一页说明已到底
        nextOffset = null;
      } else {
        nextOffset =
          offset + (config.offsetStep > 1 ? config.offsetStep : list.length);
      }

      return {
        posts,
        cursor: nextOffset !== null ? String(nextOffset) : null,
      };
    },
  };
}
