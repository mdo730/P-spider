import dayjs, { Dayjs } from 'dayjs';
import { request } from '../ipc/network';
import { useSettingsStore } from '../stores/settings';

/**
 * pixiv 客户端（L2/L3 共用）
 *
 * 登录：**refresh_token 优先**——用 refresh_token 走 OAuth 换 access_token，
 * 之后调用官方 App API（app-api.pixiv.net）；用户名/头像从换 token 响应或 /v1/user/detail 取。
 * Cookie 为**可选兜底**：填了会附加到请求头（部分接口需要），当前主流程不依赖它。
 *
 * 参考（非官方公开）：token 端点 oauth.secure.pixiv.net；App API 需 App-OS/UA + Bearer。
 */

const OAUTH_TOKEN_URL = 'https://oauth.secure.pixiv.net/auth/token';
const APP_API = 'https://app-api.pixiv.net';
// Android 客户端固定凭据（社区通用）
const CLIENT_ID = 'MOBrBDS8blbauoSck0ZfDbtuzpyT';
const CLIENT_SECRET = 'lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj';
const APP_UA = 'PixivAndroidApp/5.0.234 (Android 11; Pixel 4)';
// 授权码交换用 iOS 头（gppt 实测）
const APP_UA_IOS = 'PixivIOSApp/7.13.3 (iOS 14.6; iPhone13,2)';
// OAuth2 PKCE 授权码流程（pixiv 已关闭 password grant，这是唯一能拿到 refresh_token 的方式）
const PIXIV_LOGIN_URL = 'https://app-api.pixiv.net/web/v1/login';
const PIXIV_CALLBACK_URI =
  'https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback';

export interface PixivUser {
  id: string;
  /** 昵称 */
  name: string;
  /** 画师 ID（@account） */
  account: string;
  avatar?: string;
}

export type PixivWorkType = 'illust' | 'manga' | 'ugoira';

export interface PixivWork {
  id: string;
  title: string;
  /** 投稿时间（ISO） */
  createDate: string;
  pageCount: number;
  type: PixivWorkType;
  /** 网格缩略图（medium） */
  thumbUrl: string;
  userId: string;
  /** 画师 ID（account） */
  userName: string;
  /** 昵称 */
  userNick: string;
  userAvatar?: string;
  tags: string[];
  xRestrict: number;
}

/** 下载 i.pximg.net 图片 / ugoira zip 用的请求头（Referer 破防盗链） */
export function pixivImageHeaders(): Record<string, string> {
  return {
    Referer: 'https://www.pixiv.net/',
    'User-Agent': APP_UA,
  };
}

/** 从 profile_image_urls 里挑一张头像（不同接口的 key 不一样：medium / px_170x170 / large …） */
function pickAvatar(pii?: Record<string, string>): string | undefined {
  if (!pii) return undefined;
  return (
    pii.medium ||
    pii.px_170x170 ||
    pii.large ||
    pii.px_50x50 ||
    pii.px_16x16 ||
    Object.values(pii)[0]
  );
}

function baseHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': APP_UA,
    'App-OS': 'android',
    'App-OS-Version': '11',
    'App-Version': '5.0.234',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  const cookie = useSettingsStore.getState().pixiv?.cookie;
  if (cookie) headers.Cookie = cookie;
  return headers;
}

// ---- access_token 缓存（内存；过期或用 401 时重换） ----
let tokenCache: { token: string; expiresAt: number } | null = null;

function workTypeOf(raw: any): PixivWorkType {
  if (raw?.type === 'ugoira' || raw?.illust_type === 2) return 'ugoira';
  if (raw?.type === 'manga' || raw?.illust_type === 1) return 'manga';
  return 'illust';
}

function normalizeWork(raw: any): PixivWork {
  const user = raw?.user || {};
  const thumb =
    raw?.image_urls?.medium ||
    raw?.image_urls?.large ||
    raw?.image_urls?.square_medium ||
    '';
  return {
    id: String(raw?.id ?? ''),
    title: raw?.title || '',
    createDate: raw?.create_date
      ? new Date(raw.create_date.replace(' ', 'T')).toISOString()
      : new Date().toISOString(),
    pageCount: Number(raw?.page_count ?? 1),
    type: workTypeOf(raw),
    thumbUrl: thumb,
    userId: String(user?.id ?? raw?.user_id ?? ''),
    userName: user?.account || '',
    userNick: user?.name || '',
    userAvatar: pickAvatar(user?.profile_image_urls),
    tags: Array.isArray(raw?.tags)
      ? raw.tags.map((t: any) => t?.name).filter(Boolean)
      : [],
    xRestrict: Number(raw?.x_restrict ?? 0),
  };
}

async function exchangeToken(force = false): Promise<{ user?: PixivUser }> {
  if (!force && tokenCache && Date.now() < tokenCache.expiresAt) {
    return {};
  }
  const refreshToken = useSettingsStore.getState().pixiv?.refreshToken?.trim();
  if (!refreshToken) {
    throw new Error('未配置 pixiv refresh_token，请到「设置 → pixiv」填写');
  }
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    include_policy: 'true',
    refresh_token: refreshToken,
  }).toString();
  const resp = await request({
    method: 'POST',
    url: OAUTH_TOKEN_URL,
    responseType: 'json',
    body,
    headers: {
      ...baseHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    maxRetry: 3,
  });
  const data = resp.body as any;
  if (resp.status >= 400 || !data?.access_token) {
    const msg =
      data?.errors?.system?.message ||
      data?.error_description ||
      data?.error ||
      `换 token 失败（status=${resp.status}）`;
    throw new Error(`pixiv 登录失败：${msg}`);
  }
  const expiresIn = Number(data?.expires_in ?? 3600);
  tokenCache = {
    token: data.access_token,
    // 提前 60s 过期，避免边界失败
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  // refresh_token 轮换：服务端可能下发新的
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    void useSettingsStore
      .getState()
      .updateOne('pixiv', 'refreshToken', data.refresh_token)
      .catch(() => undefined);
  }
  const u = data.user;
  return {
    user: u
      ? {
          id: String(u.id),
          name: u.name || '',
          account: u.account || '',
          avatar: pickAvatar(u.profile_image_urls),
        }
      : undefined,
  };
}

async function getToken(): Promise<string> {
  if (!tokenCache || Date.now() >= tokenCache.expiresAt) {
    await exchangeToken(true);
  }
  return tokenCache!.token;
}

async function apiGet(
  path: string,
  query: Record<string, any> = {},
): Promise<any> {
  const doGet = async (token: string) =>
    request({
      method: 'GET',
      url: `${APP_API}${path}`,
      query: { ...query, filter: 'for_android' },
      responseType: 'json',
      headers: { ...baseHeaders(), Authorization: `Bearer ${token}` },
      maxRetry: 3,
    });
  let token = await getToken();
  let resp = await doGet(token);
  if (resp.status === 401) {
    // token 失效：强制重换后重试一次
    tokenCache = null;
    token = await getToken();
    resp = await doGet(token);
  }
  const data = resp.body as any;
  if (resp.status >= 400) {
    const msg =
      data?.error?.user_message ||
      data?.error?.message ||
      data?.message ||
      `status=${resp.status}`;
    throw new Error(`pixiv 请求失败：${msg}`);
  }
  return data;
}

/** 校验登录：强制换一次 token，返回用户信息（并回写设置缓存） */
export async function verifyPixivLogin(): Promise<PixivUser> {
  const { user } = await exchangeToken(true);
  if (!user) throw new Error('无法获取 pixiv 用户信息');
  await useSettingsStore.getState().updateOne('pixiv', 'userId', user.id);
  await useSettingsStore.getState().updateOne('pixiv', 'userName', user.name);
  await useSettingsStore
    .getState()
    .updateOne('pixiv', 'userAccount', user.account);
  await useSettingsStore
    .getState()
    .updateOne('pixiv', 'userAvatar', user.avatar || '');
  return user;
}

// ---- OAuth2 PKCE 授权码登录（pixiv 已关闭 password grant，只能走这条） ----

let pkceVerifier = '';

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持 WebCrypto，无法完成 pixiv 登录');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

/**
 * 生成 PKCE 登录 URL：用系统浏览器打开它，登录后浏览器会跳到
 * `pixiv://account/login?code=...`（把地址栏整段粘回 `exchangePixivCode` 即可）。
 * code_verifier 存在内存里，供同一次会话交换使用。
 */
export async function buildPixivLoginUrl(): Promise<string> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  pkceVerifier = base64Url(verifierBytes);
  const challenge = base64Url(
    await sha256(new TextEncoder().encode(pkceVerifier)),
  );
  const params = new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: 'S256',
    client: 'pixiv-android',
  });
  return `${PIXIV_LOGIN_URL}?${params.toString()}`;
}

/** 从「粘贴的整段 URL / code=… 片段 / 纯 code」里提取授权码 */
function extractPixivCode(text: string): string {
  const pasted = (text || '').trim();
  if (!pasted) throw new Error('请粘贴登录后的链接或 code');
  let code = '';
  if (pasted.includes('=')) {
    const query = pasted.includes('?')
      ? pasted.slice(pasted.indexOf('?') + 1)
      : pasted;
    code = (new URLSearchParams(query).get('code') || '').trim();
  } else {
    code = pasted;
  }
  if (!code || /\s/.test(code)) {
    throw new Error('没能从粘贴内容里识别出 code，请粘贴完整链接');
  }
  return code;
}

/**
 * 用授权码换 `refresh_token` 并登录（**只保存 refresh_token**）。
 * 交换成功后失效本次 PKCE，需重新「打开登录页」再登录。
 */
export async function exchangePixivCode(input: string): Promise<PixivUser> {
  if (!pkceVerifier) {
    throw new Error('登录会话已失效，请重新点「打开 pixiv 登录页」');
  }
  const code = extractPixivCode(input);
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    include_policy: 'true',
    code,
    code_verifier: pkceVerifier,
    grant_type: 'authorization_code',
    redirect_uri: PIXIV_CALLBACK_URI,
  }).toString();
  const resp = await request({
    method: 'POST',
    url: OAUTH_TOKEN_URL,
    responseType: 'json',
    body,
    headers: {
      'user-agent': APP_UA_IOS,
      'app-os': 'ios',
      'app-os-version': '14.6',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    maxRetry: 2,
  });
  const data = resp.body as any;
  if (!data?.access_token || !data?.refresh_token) {
    const msg =
      data?.errors?.system?.message ||
      data?.error_description ||
      data?.error ||
      `登录失败（status=${resp.status}）`;
    throw new Error(`pixiv 登录失败：${msg}`);
  }
  const expiresIn = Number(data?.expires_in ?? 3600);
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  const u = data.user || {};
  const user: PixivUser = {
    id: String(u.id ?? ''),
    name: u.name || '',
    account: u.account || '',
    avatar: pickAvatar(u.profile_image_urls),
  };
  const store = useSettingsStore.getState();
  await store.updateOne('pixiv', 'refreshToken', data.refresh_token);
  if (user.id) await store.updateOne('pixiv', 'userId', user.id);
  await store.updateOne('pixiv', 'userName', user.name);
  await store.updateOne('pixiv', 'userAccount', user.account);
  await store.updateOne('pixiv', 'userAvatar', user.avatar || '');
  pkceVerifier = '';
  return user;
}

/** 画师信息 */
export async function fetchPixivUser(userId: string): Promise<PixivUser> {
  const data = await apiGet('/v1/user/detail', { user_id: userId });
  const u = data?.user || {};
  return {
    id: String(u.id ?? userId),
    name: u.name || '',
    account: u.account || '',
    avatar: pickAvatar(u.profile_image_urls),
  };
}

/** 画师作品列表（分页 offset）；type: illust(含动图) / manga；返回本页作品与下一个 offset（null=到底） */
export async function fetchPixivWorks(
  userId: string,
  offset = 0,
  type: 'illust' | 'manga' = 'illust',
): Promise<{ works: PixivWork[]; nextOffset: number | null }> {
  const data = await apiGet('/v1/user/illusts', {
    user_id: userId,
    type,
    offset,
  });
  const list: any[] = Array.isArray(data?.illusts) ? data.illusts : [];
  const works = list.map(normalizeWork).filter((w) => w.id);
  // next_url 存在才说明还有下一页
  const nextOffset = data?.next_url ? offset + works.length : null;
  return { works, nextOffset };
}

export interface PixivWorkDetail {
  id: string;
  title: string;
  createDate: string;
  pageCount: number;
  type: PixivWorkType;
  userId: string;
  userName: string;
  userNick: string;
  userAvatar?: string;
  tags: string[];
  xRestrict: number;
  /** 各页原图 URL（多图全下用） */
  urls: string[];
}

/** 作品详情（取多页原图 / ugoira 判定） */
export async function fetchPixivWorkDetail(
  workId: string,
): Promise<PixivWorkDetail> {
  const data = await apiGet('/v1/illust/detail', { illust_id: workId });
  const illust = data?.illust || {};
  const urls: string[] = [];
  if (Array.isArray(illust.meta_pages) && illust.meta_pages.length > 0) {
    for (const p of illust.meta_pages) {
      const u = p?.image_urls?.original || p?.image_urls?.large;
      if (u) urls.push(u);
    }
  } else if (illust.meta_single_page?.original_image_url) {
    urls.push(illust.meta_single_page.original_image_url);
  }
  return {
    id: String(illust.id ?? workId),
    title: illust.title || '',
    createDate: illust.create_date
      ? new Date(illust.create_date.replace(' ', 'T')).toISOString()
      : new Date().toISOString(),
    pageCount: Number(illust.page_count ?? urls.length ?? 1),
    type: workTypeOf(illust),
    userId: String(illust.user?.id ?? ''),
    userName: illust.user?.account || '',
    userNick: illust.user?.name || '',
    userAvatar: pickAvatar(illust.user?.profile_image_urls),
    tags: Array.isArray(illust.tags)
      ? illust.tags.map((t: any) => t?.name).filter(Boolean)
      : [],
    xRestrict: Number(illust.x_restrict ?? 0),
    urls,
  };
}

export interface PixivUgoiraMeta {
  zipUrl: string;
  frames: { file: string; delay: number }[];
}

/** ugoira 动图元数据（帧序列 + zip 地址，转 mp4/gif 用） */
export async function fetchPixivUgoiraMeta(
  workId: string,
): Promise<PixivUgoiraMeta> {
  const data = await apiGet('/v1/ugoira/metadata', { illust_id: workId });
  const meta = data?.ugoira_metadata || {};
  return {
    zipUrl: meta?.zip_urls?.medium || '',
    frames: Array.isArray(meta?.frames)
      ? meta.frames.map((f: any) => ({
          file: String(f?.file ?? ''),
          delay: Number(f?.delay ?? 100),
        }))
      : [],
  };
}

/**
 * 解析用户输入：画师主页链接 / 作品链接 / 纯数字 ID。
 * 返回 userId（优先）或 workId；纯数字先当 userId，调用方失败后再当 workId。
 */
export function parsePixivInput(input: string): {
  userId?: string;
  workId?: string;
} {
  const s = (input || '').trim();
  if (!s) return {};
  const art = s.match(/artworks\/(\d+)/i);
  if (art) return { workId: art[1] };
  const user = s.match(/users\/(\d+)/i);
  if (user) return { userId: user[1] };
  if (/^\d+$/.test(s)) return { userId: s };
  const idLike = s.match(/(\d{4,})/);
  if (idLike) return { userId: idLike[1] };
  return {};
}

/** 用作品 id 反查画师 id */
export async function resolveWorkAuthorId(workId: string): Promise<string> {
  const detail = await fetchPixivWorkDetail(workId);
  if (!detail.userId) throw new Error('无法解析该作品所属画师');
  return detail.userId;
}

/** 投稿时间 → dayjs（供筛选比较） */
export function pixivDate(work: Pick<PixivWork, 'createDate'>): Dayjs {
  return dayjs(work.createDate);
}
