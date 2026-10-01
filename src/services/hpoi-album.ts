import { request } from '../ipc/network';

/**
 * hpoi 相册 + 登录数据层（迁移自 hpoi-desktop 的 `hpoi-core/{auth,album,client}.ts`）。
 *
 * - App JSON 接口走 `www.hpoi.net/api/*`（`robots.txt` 禁抓，灰色地带：限速 + 缓存）；
 * - 相册图片列表 `album/detail` 不返回，只能抓相册网页 `/album/<itemId>` 解析 `pic/n`；
 * - 图片 `rfx.hpoi.net` 防盗链，取图需带 `Referer: https://www.hpoi.net/`；
 * - 登录态 `utoken` 由前端注入（`setHpoiCookie`），hpoi-core 本身不依赖 store。
 */

const SITE = 'https://www.hpoi.net';
const BASE = 'https://www.hpoi.net/api';
const IMG_ROOT = 'https://rfx.hpoi.net/gk';
const UA_APP = 'hpoi/android';
const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/** 全局登录态 Cookie（形如 `utoken=UTK...`） */
let hpoiCookie = '';

export function setHpoiCookie(cookie: string) {
  hpoiCookie = cookie || '';
}

export function getHpoiCookie(): string {
  return hpoiCookie;
}

/**
 * 相册分区（category）。hpoi 相册分两组：
 *  - 相册组（按手办大类）：60001 手办 / 60002 动漫模型 / 60003 Doll娃娃 / 60004 真实模型 / 60005 毛绒布偶；
 *  - GK/DIY 组：60101 原创作品 / 60102 灰模上色 / 60103 改造 / 60104 翻新修复。
 */
export const HPOI_ALBUM_CATEGORY = {
  手办: 60001,
  动漫模型: 60002,
  Doll娃娃: 60003,
  真实模型: 60004,
  毛绒布偶: 60005,
  原创作品: 60101,
  灰模上色: 60102,
  改造: 60103,
  翻新修复: 60104,
} as const;

/** 相册分类按钮（分组平铺用） */
export const HPOI_ALBUM_CATEGORY_GROUPS: {
  label: string;
  items: { label: string; value: number }[];
}[] = [
  {
    label: '相册',
    items: [
      { label: '手办', value: 60001 },
      { label: '动漫模型', value: 60002 },
      { label: 'Doll娃娃', value: 60003 },
      { label: '真实模型', value: 60004 },
      { label: '毛绒布偶', value: 60005 },
    ],
  },
  {
    label: 'GK / DIY',
    items: [
      { label: '原创作品', value: 60101 },
      { label: '灰模上色', value: 60102 },
      { label: '改造', value: 60103 },
      { label: '翻新修复', value: 60104 },
    ],
  },
];

export interface HpoiAlbum {
  /** 相册条目的 itemId（相册页 http 资源 id 用，详情页 `/album/<itemId>`） */
  itemId: number;
  name: string;
  cover?: string;
  picCount?: number;
  r18?: number;
  addTime?: string;
  categoryId?: number;
  user?: {
    nickname?: string;
    userId?: number;
    header?: string;
  };
}

export function hpoiAlbumCoverUrl(
  cover?: string,
  size: 's' | 'n' = 's',
): string | undefined {
  if (!cover) return undefined;
  if (/^https?:\/\//.test(cover)) {
    return cover.replace(/\/cover\/[sn]\//, `/cover/${size}/`);
  }
  return `${IMG_ROOT}/cover/${size}/${cover}`;
}

export function hpoiAlbumUrl(itemId: number | string): string {
  return `${SITE}/album/${itemId}`;
}

/** hpoi App JSON 接口 GET（带登录 cookie），返回 `data` */
async function hpoiGet<T = any>(
  path: string,
  query: Record<string, string>,
): Promise<T> {
  const res = await request({
    method: 'GET',
    responseType: 'json',
    url: `${BASE}${path}`,
    query,
    headers: {
      'User-Agent': UA_APP,
      ...(hpoiCookie ? { Cookie: hpoiCookie } : {}),
    },
    bypassProxy: true,
    maxRetry: 2,
  });
  if (res.status >= 400) throw new Error(`hpoi 请求失败 status=${res.status}`);
  const body = res.body as any;
  if (body && body.success === false) {
    throw new Error(body.msg || 'hpoi 接口返回错误');
  }
  return (body?.data ?? {}) as T;
}

// ---------------- 登录 ----------------

export interface HpoiLoginResult {
  /** 登录态 token（cookie 值，形如 `UTK...`） */
  utoken: string;
  raw?: any;
}

/**
 * 账号密码登录 hpoi（网页登录接口）。
 * - `loginType=7`：手机号（内部自动补 `+86-` 区号）
 * - `loginType=6`：邮箱
 * 成功后从 `Set-Cookie` 取 `utoken`（有效期约 10 年）。
 */
export async function loginHpoi(
  account: string,
  password: string,
  useEmail = false,
): Promise<HpoiLoginResult> {
  const acc = useEmail
    ? account.trim()
    : account.trim().startsWith('+')
      ? account.trim()
      : `+86-${account.trim()}`;
  const body = new URLSearchParams({
    loginType: useEmail ? '6' : '7',
    account: acc,
    password,
  }).toString();

  const res = await request({
    method: 'POST',
    responseType: 'json',
    url: `${SITE}/user/login/submitV2`,
    body,
    headers: {
      'User-Agent': UA_BROWSER,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    bypassProxy: true,
    maxRetry: 1,
  });

  const data = res.body as any;
  if (!data?.success) {
    throw new Error(data?.msg || `登录失败（status=${res.status}）`);
  }
  const setCookieKey = Object.keys(res.headers || {}).find(
    (k) => k.toLowerCase() === 'set-cookie',
  );
  const cookies = setCookieKey ? res.headers[setCookieKey] : [];
  const utoken =
    (cookies || []).map((c) => c.match(/utoken=([^;]+)/)?.[1]).find(Boolean) ||
    data?.data?.utoken ||
    '';
  if (!utoken) throw new Error('登录成功但未取到 utoken');
  return { utoken, raw: data?.data };
}

// ---------------- 相册 ----------------

/** 相册列表（`/api/album/list`，按时间倒序） */
export async function fetchAlbumList(
  page = 1,
  pageSize = 30,
  category = 60001,
): Promise<HpoiAlbum[]> {
  const data = await hpoiGet<{ list?: HpoiAlbum[] }>('/album/list', {
    page: String(page),
    pageSize: String(pageSize),
    category: String(category),
  });
  return (data.list || []) as HpoiAlbum[];
}

/** 相册大图 URL（pic/n），按页面出现顺序去重 */
const PIC_RE =
  /https?:\/\/rfx\.hpoi\.net\/gk\/pic\/n\/[0-9/]+[a-zA-Z0-9]+\.(?:jpg|jpeg|png|webp)/gi;

/**
 * 相册图片列表。
 * ⚠️ `album/detail` 接口不返回图片列表，只能抓相册网页 `/album/<itemId>` 解析 `pic/n`。
 */
export async function fetchAlbumPics(itemId: number): Promise<string[]> {
  const res = await request({
    method: 'GET',
    responseType: 'text',
    url: hpoiAlbumUrl(itemId),
    headers: {
      'User-Agent': UA_BROWSER,
      'Accept-Language': 'zh-CN',
      ...(hpoiCookie ? { Cookie: hpoiCookie } : {}),
    },
    bypassProxy: true,
    maxRetry: 2,
  });
  const html: string = (res.body as any) || '';
  if (res.status >= 400 || !html) {
    throw new Error(`打开 hpoi 相册失败 status=${res.status}`);
  }
  return Array.from(new Set(html.match(PIC_RE) || []));
}

// ---------------- 相册详情 ----------------

export interface HpoiAlbumRef {
  id: number;
  name: string;
  cover?: string;
}

export interface HpoiAlbumDetail {
  itemId: number;
  name: string;
  cover?: string;
  categoryId?: number;
  picCount?: number;
  r18?: number;
  /** 浏览量 */
  hits?: number;
  addTime?: string;
  user?: { nickname?: string; userId?: number; header?: string };
  /** 正文（纯文本） */
  body?: string;
  /** 关联条目（手办） */
  refs: HpoiAlbumRef[];
  /** 正文图片（pic/n 大图） */
  pics: string[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** 去掉正文 HTML 标签，保留换行 */
function stripHtml(s: string): string {
  return decodeEntities(
    s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 相册详情：解析 `/album/<itemId>`。
 * 元数据/正文来自 `fn_share.init('{...JSON...}')`；关联条目来自 `#relate-list`；
 * 图片取正文 `pic/n` 大图。
 */
export async function fetchAlbumDetail(
  itemId: number,
): Promise<HpoiAlbumDetail> {
  const res = await request({
    method: 'GET',
    responseType: 'text',
    url: hpoiAlbumUrl(itemId),
    headers: {
      'User-Agent': UA_BROWSER,
      'Accept-Language': 'zh-CN',
      ...(hpoiCookie ? { Cookie: hpoiCookie } : {}),
    },
    bypassProxy: true,
    maxRetry: 2,
  });
  const html: string = (res.body as any) || '';
  if (res.status >= 400 || !html) {
    throw new Error(`打开 hpoi 相册失败 status=${res.status}`);
  }

  let j: any = {};
  const mm = html.match(/fn_share\.init\('([\s\S]*?)',\s*'/);
  if (mm) {
    try {
      j = JSON.parse(decodeEntities(mm[1]));
    } catch {
      j = {};
    }
  }

  const refs: HpoiAlbumRef[] = [];
  const start = html.indexOf('id="relate-list"');
  if (start >= 0) {
    let end = html.indexOf('album-list', start);
    if (end < 0) end = start + 8000;
    const seg = html.slice(start, end);
    const re =
      /href="hobby\/(\d+)"[^>]*?title="([^"]{1,160})"[^>]*?>\s*<img[^>]*?src="([^"]+)"/g;
    const seen = new Set<number>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(seg))) {
      const id = Number(m[1]);
      if (seen.has(id)) continue;
      seen.add(id);
      refs.push({ id, name: decodeEntities(m[2].trim()), cover: m[3] });
    }
  }

  const pics = Array.from(new Set(html.match(PIC_RE) || []));

  return {
    itemId,
    name: j.nameCN || j.name || `相册 ${itemId}`,
    cover: j.cover,
    categoryId: j.categoryId,
    picCount: j.picCount,
    r18: j.r18,
    hits: j.hits,
    addTime: j.addTime,
    user: j.user
      ? {
          nickname: j.user.nickname,
          userId: j.user.userId,
          header: j.user.header,
        }
      : undefined,
    body: j.detail ? stripHtml(String(j.detail)) : '',
    refs,
    pics,
  };
}
