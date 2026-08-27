import { request } from '../ipc/network';
import { createArchiverAdapter } from './archiver';
import { PlatformCreator } from './types';

/** Pawchive 平台标识 */
export const PAWCHIVE_SOURCE = 'pawchive';

/**
 * Pawchive：基于 Kemono 架构的活跃归档站（Patreon/Fanbox/Discord）。
 * 调研结论（2026-08）：
 * - API 根 https://pawchive.pw/api/v1，公开只读，免登录
 * - 帖子列表 GET /{service}/user/{id}/posts?o={offset}，offset 强制 50 步进
 * - 创作者按数字 id：GET /{service}/user/{id}/profile；无按 slug 查询端点
 * - 媒体原图 https://file.pawchive.pw/data{path}?f={原名}，缩略图 https://img.pawchive.pw/thumbnail/data{path}
 * - 订阅 username 存 service/数字id，如 patreon/3295915
 */
const API_ROOT = 'https://pawchive.pw/api/v1';
const SITE_ROOT = 'https://pawchive.pw';
const FILE_ROOT = 'https://file.pawchive.pw';
const THUMB_ROOT = 'https://img.pawchive.pw';

/** 按 service/user_id（必须为数字 id）解析创作者 */
async function resolvePawchiveCreator(
  identifier: string,
): Promise<PlatformCreator> {
  const [service, userId] = identifier.split('/');
  if (!service || !userId) {
    throw new Error(
      'Pawchive 订阅格式应为 service/user_id，如 patreon/3295915',
    );
  }
  if (!/^\d+$/.test(userId)) {
    throw new Error(
      'Pawchive 需用数字创作者 ID（如 patreon/3295915），可在创作者页 URL 中看到',
    );
  }
  const resp = await request({
    method: 'GET',
    responseType: 'json',
    url: `${API_ROOT}/${service}/user/${userId}/profile`,
    bypassProxy: true,
    maxRetry: 3,
  });
  if (resp.status >= 400) {
    throw new Error(`找不到该 Pawchive 创作者（status=${resp.status}）`);
  }
  const data = resp.body as any;
  if (!data || !data.id) {
    throw new Error('找不到该 Pawchive 创作者');
  }
  return {
    // creator.id 编码 service + pawchive user id，供 fetchPosts 定位
    id: `${service}/${data.id}`,
    name: data.name || identifier,
    username: identifier,
    avatar: data.avatar || `${SITE_ROOT}/icons/${service}/${data.id}`,
    profileUrl: `${SITE_ROOT}/${service}/user/${data.id}`,
  };
}

export const pawchiveAdapter = createArchiverAdapter({
  source: PAWCHIVE_SOURCE,
  apiRoot: API_ROOT,
  fileRoot: FILE_ROOT,
  thumbRoot: THUMB_ROOT,
  siteRoot: SITE_ROOT,
  offsetParam: 'o',
  offsetStep: 50,
  bypassProxy: true,
  maxRetry: 3,
  resolveCreatorByIdentifier: resolvePawchiveCreator,
});
