import { fs, path } from '@tauri-apps/api';
import { request } from '../ipc/network';
import { getHpoiCookie } from './hpoi-album';

/**
 * hpoi 情报流（「最新情报」）数据层。
 *
 * 迁移自 hpoi-desktop 的 `src/hpoi-core/{intel,detail,urls}.ts`（可迁移内核，无状态、无 UI）。
 * ⚠️ 与 `services/hpoi.ts` 并存：那个是 fig-memo 的**图鉴匹配**（HpoiMatch），这里是**情报流 + 词条正文**（HpoiDetail）。
 *
 * 约束（hpoi robots.txt `Disallow: /api/`，灰色地带）：
 * - 情报接口返回**服务端渲染 HTML 片段**（非 JSON），必须浏览器 UA；
 * - 图片 `rfx.hpoi.net` 有防盗链，取图需带 `Referer: https://www.hpoi.net/`；
 * - 限速 + 缓存，禁止高频全量抓取。
 */

export const HPOI_SITE = 'https://www.hpoi.net';
export const HPOI_IMG_ROOT = 'https://rfx.hpoi.net/gk';
export const HPOI_REFERER = 'https://www.hpoi.net/';
const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/** hpoi 术语分类 id */
export const HPOI_CATEGORY_ID = {
  手办: 100,
  动漫模型: 200,
  Doll娃娃: 300,
  毛绒布偶: 400,
  真实模型: 500,
} as const;

const CATEGORY_NAME: Record<number, string> = {
  100: '手办',
  200: '动漫模型',
  300: 'Doll娃娃',
  400: '毛绒布偶',
  500: '真实模型',
};

/** 情报事件类型（`/hobby/action/get` 的 subType） */
export type HpoiIntelSubType =
  | 'all'
  | 'confirm'
  | 'official_pic'
  | 'preorder'
  | 'release'
  | 'delay'
  | 'reorder';

export const HPOI_SUB_LABEL: Record<HpoiIntelSubType, string> = {
  all: '全部',
  confirm: '制作决定',
  official_pic: '官图更新',
  preorder: '预定时间',
  release: '出荷时间',
  delay: '出荷延期',
  reorder: '再版确定',
};

/** 情报流条目 */
export interface HpoiIntel {
  /** 词条 id（正文即 `hobby/<itemId>` 详情页） */
  itemId: number;
  /** 分类名：手办 / 动漫模型 / Doll娃娃 / 毛绒布偶 / 真实模型 */
  categoryName: string;
  eventType: HpoiIntelSubType;
  /** 事件标签：制作决定 / 官图更新 / 预定时间 / 出荷时间 / 出荷延期 / 再版确定 */
  eventLabel: string;
  /** 相对时间文案，如「53分钟前」 */
  timeText: string;
  /** 完整一句话摘要 */
  title: string;
  /** 短名 */
  shortName: string;
  cover?: string;
  url: string;
}

/** 情报流一页（含下一页游标） */
export interface HpoiIntelPage {
  items: HpoiIntel[];
  /** 下一页游标（`lastTime`），无更多时为空 */
  lastTime?: string;
}

/** 词条详情（详情页 JSON-LD + 图集解析结果） */
export interface HpoiDetail {
  itemId: number;
  nameCN: string;
  /** alternateName 列表（中文全名 / 日文原名等） */
  nameAlt: string[];
  /** 从 alternateName 里挑出的日文原名 */
  nameJa?: string;
  companyName: string;
  scale?: number;
  /** 准确均分（aggregateRating.ratingValue） */
  rating?: number;
  /** 评分人数（aggregateRating.ratingCount） */
  ratingCount?: number;
  /** 大封面（cover/n） */
  cover?: string;
  releaseDate?: string;
  /** 分类，如「比例人形」 */
  category?: string;
  price?: number;
  currency?: string;
  /** 原始描述（含量产信息） */
  description?: string;
  /** 从 description 拆出的键值对：属性/比例/定价/出货日/制作/角色/作品/尺寸/材质 … */
  specs: Record<string, string>;
  /** 官方图集（pic/n 大图 URL，按页面顺序；已排除实物照片） */
  images: string[];
  /** 实物照片（用户实拍，pic/n 大图 URL） */
  userPhotos: string[];
  /** 进程时间轴（制作决定 / 预订 / 官图更新 / 出荷 / 延期 …，页面为时间倒序） */
  process: HpoiProcessItem[];
  /** 结构化关联（厂商等，来自 description 的 `制作: [{link=company/…, value=…}]`） */
  refs: HpoiRef[];
  /** 相关相册（用户围绕该词条建的实物相册） */
  albums: HpoiRelatedAlbum[];
  /** 正文「商品介绍」HTML（页面 `hpoi-detail-box`，比 JSON-LD 的 spec 串完整） */
  descriptionHtml?: string;
  /** 内部 node id（评论接口 `/api/comment/*` 用；页面 `fn_comment.init('…')`） */
  nodeId?: number;
  /** 评分分布（五柱：神物 / 满足 / 眼缘 / 微妙 / 邪神 + 票数） */
  ratingBars: { label: string; count: number }[];
  /** 规格标签（内嵌 JSON 的 `specTags`，如「可拆卸」；补全「属性」） */
  specTags: string[];
  tags: string[];
}

/** 相关相册（`hpoi-entry-album` 卡片） */
export interface HpoiRelatedAlbum {
  /** 相册 id（`album/<id>`） */
  id: number;
  name: string;
  cover?: string;
  /** 点赞数 */
  praise?: number;
}

/** 进程时间轴的一项 */
export interface HpoiProcessItem {
  /** 事件名：制作决定 / 预订时间 / 官图更新 / 出荷时间 / 出荷延期 … */
  event: string;
  /** 相对时间文案，如「5小时前」 */
  time: string;
  /** 详情短句 */
  detail: string;
  /** 完整标题（title 属性），如「… 2026年9月30日出货」 */
  title?: string;
}

/** 结构化关联实体（厂商 / 作品 / 角色 / 原型师 …） */
export interface HpoiRef {
  type: 'company' | 'works' | 'charactar' | 'person';
  id: number;
  name: string;
  cover?: string;
  /** 词条主页 URL（`https://www.hpoi.net/<type>/<id>`） */
  url: string;
  /** 所属 description 字段名（制作 / 作品 / 原型 / 色彩 …） */
  field: string;
}

/** 词条主页 URL */
export function hpoiDetailUrl(itemId: number | string): string {
  return `${HPOI_SITE}/hobby/${itemId}`;
}

/**
 * 词条封面 URL：list/情报给的 cover 可能是相对路径（`2026/07/xxx.jpg`）或完整 URL。
 * @param size `s`=小图（默认），`n`=大图
 */
export function hpoiCoverUrl(
  cover?: string,
  size: 's' | 'n' = 's',
): string | undefined {
  if (!cover) return undefined;
  if (/^https?:\/\//.test(cover)) {
    return cover.replace(/\/cover\/[sn]\//, `/cover/${size}/`);
  }
  return `${HPOI_IMG_ROOT}/cover/${size}/${cover}`;
}

function clean(s?: string): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/**
 * 拉情报流（hpoi「最新情报」）。
 * 分页：首次不传 `lastTime`，返回里的游标用于下一页。
 */
export async function fetchIntelFeed(
  opts: {
    categoryId?: number;
    subType?: HpoiIntelSubType;
    lastTime?: string;
  } = {},
): Promise<HpoiIntelPage> {
  const categoryId = opts.categoryId ?? HPOI_CATEGORY_ID.手办;
  const subType: HpoiIntelSubType = opts.subType ?? 'all';
  const qs = new URLSearchParams({
    categoryId: String(categoryId),
    subType,
  });
  if (opts.lastTime) qs.set('lastTime', opts.lastTime);

  const res = await request({
    method: 'GET',
    responseType: 'text',
    url: `${HPOI_SITE}/hobby/action/get?${qs.toString()}`,
    headers: {
      'User-Agent': UA_BROWSER,
      'Accept-Language': 'zh-CN',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${HPOI_SITE}/hobby/`,
    },
    bypassProxy: true,
    maxRetry: 1,
  });
  const html: string = (res.body as any) || '';
  if (res.status >= 400 || !html) {
    throw new Error(`获取 hpoi 情报失败 status=${res.status}`);
  }

  const items: HpoiIntel[] = [];
  const blocks = html.split('<div class="hpoi-conter-left">').slice(1);
  for (const block of blocks) {
    const idm = block.match(/href="hobby\/(\d+)"/);
    if (!idm) continue;
    const itemId = Number(idm[1]);
    const cover = block.match(/<img[^>]*src="([^"]+)"/)?.[1];
    const left = block.split('class="right-leioan"')[0] || '';
    const right = block.split('class="right-leioan"')[1] || '';
    const categoryName =
      clean(left.match(/<span>([^<]+)<\/span>/)?.[1]) ||
      CATEGORY_NAME[categoryId] ||
      '';
    const spans = [...right.matchAll(/<span>([^<]+)<\/span>/g)].map((m) =>
      clean(m[1]),
    );
    const plainDivs = [...right.matchAll(/<div>\s*([^<]+?)\s*<\/div>/g)].map(
      (m) => clean(m[1]),
    );
    // 时间文案：精确取「刚刚 / N秒|分钟|小时|天|月|年前」那个 span（别用 spans[1]，部分条目会取到「情报」等）
    const timeText =
      clean(
        right.match(
          /<span>((?:刚刚|刚刚更新|\d+\s*个?\s*(?:秒|分钟|小时|天|月|年)前))<\/span>/,
        )?.[1],
      ) || '';
    items.push({
      itemId,
      categoryName,
      eventType: subType,
      eventLabel: spans[0] || HPOI_SUB_LABEL[subType],
      timeText,
      title: plainDivs[0] || '',
      shortName: plainDivs[1] || '',
      cover,
      url: hpoiDetailUrl(itemId),
    });
  }

  const lastTime = html.match(/id="actionLastId\d+"[^>]*value="(\d+)"/)?.[1];
  return { items, lastTime };
}

// ---------------- 词条详情（JSON-LD Product + 图集） ----------------

function extractProduct(html: string): any | null {
  const re =
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let j: any;
    try {
      j = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const cands: any[] = [j, j?.mainEntity];
    if (Array.isArray(j?.['@graph'])) cands.push(...j['@graph']);
    for (const c of cands) {
      if (c && c['@type'] === 'Product') return c;
    }
  }
  return null;
}

/** 官方图集 / 实物照片：均以 `href` 抓，实物照片带 `class="boutique"` 前缀 */
const ALL_PIC_RE = /href="(https?:\/\/rfx\.hpoi\.net\/gk\/pic\/n\/[^"]+)"/g;
const BOUTIQUE_PIC_RE =
  /class="boutique"[\s\S]{0,300}?href="(https?:\/\/rfx\.hpoi\.net\/gk\/pic\/n\/[^"]+)"/g;

function matchAllUrls(html: string, re: RegExp): string[] {
  const out: string[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/**
 * 解析 description 里的结构化「制作」链接：
 * `制作: [{link=company/789, cover=…, value=AniGame}, {link=company/49, value=AmiAmi}]`
 * → 拆成 refs，并把 description 里的「制作」还原为 `AniGame、AmiAmi`（避免被逗号拆碎）。
 */
function extractDescRefs(desc: string): { cleaned: string; refs: HpoiRef[] } {
  const refs: HpoiRef[] = [];
  // 任意「字段: [{link=…, value=…}, …]」形式（制作 / 作品 / 原型 / 色彩 …）
  const cleaned = desc.replace(
    /([^\s,，:：]+)\s*[:：]\s*\[([\s\S]*?)\]/g,
    (whole, field: string, inner: string) => {
      const names: string[] = [];
      const objRe = /\{([^}]*)\}/g;
      let om: RegExpExecArray | null;
      while ((om = objRe.exec(inner))) {
        const seg = om[1];
        const value = seg.match(/value\s*=\s*([^,}]+)/)?.[1]?.trim();
        if (!value) continue;
        const link = seg.match(/link\s*=\s*([^,\s}]+)/)?.[1];
        const cover = seg.match(/cover\s*=\s*([^,\s}]+)/)?.[1];
        const lm = link?.match(/^([a-z]+)\/(\d+)/i);
        const type = (lm?.[1] as HpoiRef['type']) || 'company';
        const id = lm ? Number(lm[2]) : 0;
        refs.push({
          type,
          id,
          name: value,
          cover,
          url: id ? `${HPOI_SITE}/${type}/${id}` : '',
          field,
        });
        names.push(value);
      }
      return names.length ? `${field}: ${names.join('、')}` : whole;
    },
  );
  return { cleaned, refs };
}

/**
 * 解析页面「关联资料」（`hpoi-infoList-item`：`<span>字段名</span>` + `<a href="type/id">名字</a>`）。
 * 字段名与 description 的键一致（制作 / 发行 / 原型 / 原画 / 角色 / 作品 …），
 * 用于把右键值渲染成**可点链接**（description 里这些常是纯文本）。
 */
function parseInfoList(html: string): HpoiRef[] {
  const refs: HpoiRef[] = [];
  const blocks = html.split('hpoi-infoList-item').slice(1);
  for (const b of blocks) {
    const field = b.match(/<span>([^<]+)<\/span>/)?.[1]?.trim();
    if (!field) continue;
    const re =
      /href="(company|works|charactar|person)\/(\d+)"[^>]*>([^<]+)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b))) {
      const type = m[1] as HpoiRef['type'];
      const id = Number(m[2]);
      refs.push({
        type,
        id,
        name: decodeEntities(m[3].trim()),
        url: `${HPOI_SITE}/${type}/${id}`,
        field,
      });
    }
  }
  return refs;
}

/** 按「字段 + 类型 + id」去重（description 的 refs 带 cover，优先保留） */
function dedupeRefs(refs: HpoiRef[]): HpoiRef[] {
  const seen = new Set<string>();
  const out: HpoiRef[] = [];
  for (const r of refs) {
    const key = `${r.field}|${r.type}|${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** 从字符串里截取第一个平衡的 JSON 对象并解析（页面内嵌数据是 entity 编码 + 可能有尾随） */
function firstJsonObject(s: string): any | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 规格标签（内嵌 `fn_share.init('{...specTags...}')`，补全「属性」） */
function parseSpecTags(html: string): string[] {
  const m = html.match(/fn_share\.init\('([\s\S]*?)'\);/);
  if (!m) return [];
  const obj = firstJsonObject(decodeEntities(m[1]));
  const list = obj?.specTags;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const t of list) {
    const name = t?.nameCN || t?.name;
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 解析相关相册（swiper-album 的 hpoi-entry-album 卡片） */
function parseRelatedAlbums(html: string): HpoiRelatedAlbum[] {
  const slides = html.split('hpoi-entry-album').slice(1);
  const out: HpoiRelatedAlbum[] = [];
  const seen = new Set<number>();
  for (const s of slides) {
    const idm = s.match(/href="album\/(\d+)"/);
    if (!idm) continue;
    const id = Number(idm[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: s.match(/title="([^"]*)"/)?.[1] || '',
      cover: s.match(/<img[^>]*src="(https?:\/\/[^"]+)"/)?.[1],
      praise:
        Number(s.match(/icon_praise[\s\S]{0,160}?<span>(\d+)<\/span>/)?.[1]) ||
        undefined,
    });
  }
  return out;
}

/** 解析进程时间轴（swiper-process 的 items-process 卡片，页面为时间倒序） */
function parseProcess(html: string): HpoiProcessItem[] {
  const slides = html.split('swiper-slide items-process').slice(1);
  const out: HpoiProcessItem[] = [];
  for (const s of slides) {
    const tm = s.match(
      /class="item-time[^"]*">\s*<span>([^<]*)<\/span>\s*<span>([^<]*)<\/span>/,
    );
    const detailM = s.match(/class="item-detail"[^>]*>\s*([^<]*?)\s*<\/div>/);
    const titleM = s.match(/class="item-detail"[^>]*title="([^"]*)"/);
    const event = tm?.[1]?.trim() || '';
    if (!event && !detailM) continue;
    out.push({
      event,
      time: tm?.[2]?.trim() || '',
      detail: detailM?.[1]?.trim() || '',
      title: titleM?.[1]?.trim() || undefined,
    });
  }
  return out;
}

/** 把 description 里的「键: 值」拆成对象（`属性: …, 定价: …, 比例: …`） */
function parseSpecs(desc: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of desc.split(/[,，]/)) {
    const m = part.match(/([^:：]+)[:：]\s*(.+)/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function parseScale(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s
    .replace(/\s/g, '')
    .match(/(?:[0-9]+\s*[/／]\s*)?([0-9]+(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : undefined;
}

/**
 * 按 hpoi 词条 id 取详情：抓详情页 HTML 的 JSON-LD Product + 图集。
 * ⚠️ 必须用浏览器 UA，`hpoi/android` 会被降级成无 JSON-LD 的精简页。
 */
export async function fetchHpoiIntelDetail(
  itemId: number,
): Promise<HpoiDetail> {
  const cookie = getHpoiCookie();
  const res = await request({
    method: 'GET',
    responseType: 'text',
    url: hpoiDetailUrl(itemId),
    headers: {
      'User-Agent': UA_BROWSER,
      'Accept-Language': 'zh-CN',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    bypassProxy: true,
    maxRetry: 2,
  });
  const html: string = (res.body as any) || '';
  if (res.status >= 400 || !html) {
    throw new Error(`打开 hpoi 词条失败 status=${res.status}`);
  }
  const prod = extractProduct(html);
  if (!prod) throw new Error('未能从 hpoi 页面解析出词条信息');

  const { cleaned, refs: descRefs } = extractDescRefs(prod.description || '');
  const desc = cleaned;
  const specs = parseSpecs(desc);
  // 合并「关联资料」里的类型链接（让 发行/角色/作品/原型 等纯文本字段也可点）
  const refs = dedupeRefs([...descRefs, ...parseInfoList(html)]);
  const alt: string[] = Array.isArray(prod.alternateName)
    ? prod.alternateName
    : prod.alternateName
      ? [prod.alternateName]
      : [];
  const nameJa = alt.find((s: string) => /[\u3040-\u30ff]/.test(s));
  const ar = prod.aggregateRating || {};

  // 实物照片（a.boutique）与官方图集（其余 pic/n）分开
  const userPhotos = Array.from(new Set(matchAllUrls(html, BOUTIQUE_PIC_RE)));
  const userSet = new Set(userPhotos.map((u) => u.split('?')[0]));
  const images = Array.from(new Set(matchAllUrls(html, ALL_PIC_RE))).filter(
    (u) => !userSet.has(u.split('?')[0]),
  );
  const process = parseProcess(html);
  const albums = parseRelatedAlbums(html);

  // 正文「商品介绍」（页面 hpoi-detail-box 的 HTML）
  const detailBox = html.match(
    /<div class="hpoi-detail-box">([\s\S]*?)<\/div>/,
  );
  const descriptionHtml = detailBox ? detailBox[1].trim() : '';

  // 内部 node id（评论接口用）
  const nodeId =
    Number(html.match(/fn_comment\.init\('(\d+)'/)?.[1]) || undefined;

  // 评分分布：内联 `arrayOfData = new Array(['5','神物'], ...)`
  const ratingBars: { label: string; count: number }[] = [];
  const arrM = html.match(/arrayOfData\s*=\s*new Array\(([\s\S]*?)\);/);
  if (arrM) {
    for (const m of arrM[1].matchAll(/\['([^']*)'\s*,\s*'([^']*)'\]/g)) {
      ratingBars.push({ count: Number(m[1]) || 0, label: m[2] });
    }
  }

  return {
    itemId,
    nameCN: prod.name || `hpoi ${itemId}`,
    nameAlt: alt,
    nameJa,
    companyName: prod.manufacturer?.name || '',
    scale: parseScale(specs['比例']),
    rating: ar.ratingValue ? Number(ar.ratingValue) : undefined,
    ratingCount: ar.ratingCount ? Number(ar.ratingCount) : undefined,
    cover: prod.image || undefined,
    releaseDate: prod.releaseDate,
    category: prod.category,
    price: prod.offers?.price ? Number(prod.offers.price) : undefined,
    currency: prod.offers?.priceCurrency,
    description: desc || undefined,
    specs,
    images,
    userPhotos,
    process,
    refs,
    albums,
    descriptionHtml: descriptionHtml || undefined,
    nodeId,
    ratingBars,
    specTags: parseSpecTags(html),
    tags: [],
  };
}

// ---------------- 评论（需登录；App 接口） ----------------

export interface HpoiComment {
  id: number;
  content: string;
  addTime?: string;
  floor?: number;
  praiseCount?: number;
  user?: { userId?: number; nickname?: string; header?: string };
}

/** 日元 → 人民币汇率（近似值，可后续做成可配置） */
const JPY_TO_CNY = 0.048;

/**
 * 价格统一格式：
 * - 人民币 → `¥2780`
 * - 日元 → 按汇率换算人民币并附原价 `¥133（2780円）`
 */
export function formatHpoiPrice(price: number, currency?: string): string {
  const c = (currency || '').toLowerCase();
  const isJpy = c.includes('yen') || c.includes('jpy') || c.includes('日元');
  if (isJpy) {
    const cny = Math.round(price * JPY_TO_CNY);
    return `¥${cny.toLocaleString()}（${price.toLocaleString()}円）`;
  }
  return `¥${price.toLocaleString()}`;
}

/** 用户头像 URL（`rfx.hpoi.net/gk/head/s/<path>`） */
export function hpoiAvatarUrl(header?: string): string | undefined {
  if (!header) return undefined;
  if (/^https?:\/\//.test(header)) return header;
  return `https://rfx.hpoi.net/gk/head/s/${header}`;
}

/** hpoi App 接口 POST（form-urlencoded，带 cookie）→ `data` */
async function hpoiAppPost(
  path: string,
  form: Record<string, string>,
): Promise<any> {
  const cookie = getHpoiCookie();
  const res = await request({
    method: 'POST',
    responseType: 'json',
    url: `${HPOI_SITE}/api${path}`,
    body: new URLSearchParams(form).toString(),
    headers: {
      'User-Agent': 'hpoi/android',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    bypassProxy: true,
    maxRetry: 2,
  });
  if (res.status >= 400) throw new Error(`hpoi 请求失败 status=${res.status}`);
  const data = res.body as any;
  if (data && data.success === false) {
    throw new Error(data.msg || 'hpoi 接口返回错误');
  }
  return data?.data ?? {};
}

/** 评论列表（`nodeId` = `HpoiDetail.nodeId`） */
export async function fetchHpoiComments(
  nodeId: number,
  page = 1,
  pageSize = 20,
): Promise<HpoiComment[]> {
  const data = await hpoiAppPost('/comment/get', {
    id: String(nodeId),
    page: String(page),
    pageSize: String(pageSize),
  });
  return (data.list || []) as HpoiComment[];
}

/** 发表评论（需登录） */
export async function addHpoiComment(
  nodeId: number,
  content: string,
): Promise<void> {
  await hpoiAppPost('/comment/add', { id: String(nodeId), content });
}

/** 情报相对时间文案 → ISO（「刚刚 / N分钟前 / N小时前 / N天前 / N月前 / N年前」；识别不了就用当前时间） */
export function parseIntelTime(timeText: string): string {
  const now = Date.now();
  const t = clean(timeText);
  if (/刚刚/.test(t)) return new Date(now).toISOString();
  const m = t.match(/(\d+)\s*个?\s*(秒|分钟|分|小时|天|月|年)/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    if (unit === '秒') return new Date(now).toISOString();
    if (unit === '分钟' || unit === '分')
      return new Date(now - n * 60 * 1000).toISOString();
    if (unit === '小时') return new Date(now - n * 3600 * 1000).toISOString();
    if (unit === '天') return new Date(now - n * 86400 * 1000).toISOString();
    if (unit === '月')
      return new Date(now - n * 30 * 86400 * 1000).toISOString();
    if (unit === '年')
      return new Date(now - n * 365 * 86400 * 1000).toISOString();
  }
  return new Date(now).toISOString();
}

// ---------------- 实体页（厂商 / 作品 / 角色 / 原型 …） ----------------

export type HpoiEntityType =
  | 'company'
  | 'series'
  | 'works'
  | 'charactar'
  | 'person';

/** 实体页里服务端渲染的手办卡片 */
export interface HpoiCard {
  itemId: number;
  name: string;
  cover?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

/** 从任意含 `href="hobby/<id>"` 的页面解析手办卡片（封面 + 名称） */
function parseHobbyCards(html: string): HpoiCard[] {
  // 先收集「带 title 的名称锚点」（person/company 页名称锚点才有 title，封面锚点没有）
  const nameById = new Map<number, string>();
  for (const m of html.matchAll(
    /href="hobby\/(\d+)"[^>]*?\btitle="([^"]{1,120})"/g,
  )) {
    const id = Number(m[1]);
    if (!nameById.has(id)) nameById.set(id, decodeEntities(m[2].trim()));
  }

  const out: HpoiCard[] = [];
  const seen = new Set<number>();
  const re = /href="hobby\/(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const itemId = Number(m[1]);
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    const win = html.slice(m.index, m.index + 800);
    const cover = win.match(
      /src="(https?:\/\/rfx\.hpoi\.net\/gk\/cover\/[^"]+)"/,
    )?.[1];
    const alt = win.match(/alt="([^"]{2,90})"/)?.[1];
    const text = win.match(/<a[^>]*>\s*([^\s<][^<]{1,89})\s*<\/a>/)?.[1];
    const name =
      nameById.get(itemId) ||
      (alt ? decodeEntities(alt) : '') ||
      (text ? decodeEntities(text) : '') ||
      `hpoi ${itemId}`;
    out.push({ itemId, name, cover });
  }
  return out;
}

/**
 * 拉某实体的手办列表。
 * ⚠️ 直接抓实体页（`/{type}/{urlId}`）服务端渲染的卡片，无需筛选 id 映射。
 */
export async function fetchEntityHobbies(
  type: HpoiEntityType,
  id: number,
): Promise<HpoiCard[]> {
  const cookie = getHpoiCookie();
  const res = await request({
    method: 'GET',
    responseType: 'text',
    url: `${HPOI_SITE}/${type}/${id}`,
    headers: {
      'User-Agent': UA_BROWSER,
      'Accept-Language': 'zh-CN',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    bypassProxy: true,
    maxRetry: 2,
  });
  const html: string = (res.body as any) || '';
  if (res.status >= 400 || !html) {
    throw new Error(`打开 hpoi 实体页失败 status=${res.status}`);
  }
  return parseHobbyCards(html);
}

/** 抓 hpoi 网页（浏览器 UA + 登录 cookie）→ HTML */
async function hpoiPage(path: string): Promise<string> {
  const cookie = getHpoiCookie();
  const res = await request({
    method: 'GET',
    responseType: 'text',
    url: `${HPOI_SITE}/${path}`,
    headers: {
      'User-Agent': UA_BROWSER,
      'Accept-Language': 'zh-CN',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    bypassProxy: true,
    maxRetry: 2,
  });
  const html: string = (res.body as any) || '';
  if (res.status >= 400 || !html) {
    throw new Error(`打开 hpoi 页面失败 status=${res.status}`);
  }
  return html;
}

/** hpoi App 接口 POST（form-urlencoded，带 cookie）→ `data.list` */
async function hpoiQueryV2(
  form: Record<string, string | number>,
): Promise<any[]> {
  const cookie = getHpoiCookie();
  const body = new URLSearchParams(
    Object.entries(form).map(([k, v]) => [k, String(v)]),
  ).toString();
  const res = await request({
    method: 'POST',
    responseType: 'json',
    url: `${HPOI_SITE}/api/hobby/query-v2`,
    body,
    headers: {
      'User-Agent': 'hpoi/android',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    bypassProxy: true,
    maxRetry: 2,
  });
  if (res.status >= 400) throw new Error(`hpoi 请求失败 status=${res.status}`);
  const data = res.body as any;
  if (data && data.success === false) {
    throw new Error(data.msg || 'hpoi 接口返回错误');
  }
  return (data?.data?.list || []) as any[];
}

/** 统一封面 URL：query-v2 给相对路径，抓页给完整 URL */
export function hpoiAnyCoverUrl(cover?: string): string | undefined {
  if (!cover) return undefined;
  return /^https?:/i.test(cover) ? cover : hpoiCoverUrl(cover, 's');
}

export type HpoiOrder =
  | 'add'
  | 'release'
  | 'rating'
  | 'hits'
  | 'hits7Day'
  | 'hitsDay';

/** 排序选项（含热度）→ 标签 */
export const HPOI_ORDER_LABEL: Record<HpoiOrder, string> = {
  add: '入库',
  release: '发售',
  rating: '评价',
  hits: '总热',
  hits7Day: '周热',
  hitsDay: '日热',
};

/** 厂商产品卡片（query-v2） */
export interface HpoiProductCard {
  itemId: number;
  name: string;
  cover?: string;
  releaseDate?: string;
}

/** 厂商筛选 id：来自厂商页 `hobby/all?company=<id>`（与 URL id 不同），失败回退 URL id */
export async function resolveCompanyFilterId(urlId: number): Promise<number> {
  try {
    const html = await hpoiPage(`company/${urlId}`);
    const m = html.match(/hobby\/all\?[^"']*?company=(\d+)/);
    if (m) return Number(m[1]);
  } catch {
    // 回退
  }
  return urlId;
}

/** 厂商产品（query-v2：分类 / 排序 入库·发售·评价 / 分页） */
export async function fetchCompanyProducts(
  filterId: number,
  opts: {
    category?: number;
    order?: HpoiOrder;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<HpoiProductCard[]> {
  const list = await hpoiQueryV2({
    company: filterId,
    category: opts.category ?? 100,
    order: opts.order ?? 'add',
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 24,
  });
  return list.map((it) => ({
    itemId: it.itemId,
    name: it.nameCN || it.name || `hpoi ${it.itemId}`,
    cover: it.cover,
    releaseDate: it.releaseDate,
  }));
}

// ---------------- ExHobby（第三方补充实物图，来自油猴脚本 Exhobby For Hpoi） ----------------

const EXHOBBY_IMG = 'https://res.e39x.com/pic/s/';

/**
 * ExHobby 实物图：POST `exhobby.net/get/pic?itemId=<页面id>&itemType=<hobby|album>`。
 * 返回 `{ list: 图片URL[], url?: ExHobby 页面 }`。
 */
export async function fetchExhobbyPics(
  itemId: number,
  itemType: 'hobby' | 'album' = 'hobby',
): Promise<{ list: string[]; url?: string }> {
  const res = await request({
    method: 'POST',
    responseType: 'json',
    url: `http://www.exhobby.net/get/pic?itemId=${itemId}&itemType=${itemType}`,
    headers: { 'User-Agent': UA_BROWSER },
    bypassProxy: true,
    maxRetry: 2,
  });
  const map = (res.body as any)?.map;
  if (!map || !Array.isArray(map.list)) return { list: [] };
  const list = map.list
    .map((x: any) => (x?.path ? `${EXHOBBY_IMG}${x.path}` : ''))
    .filter(Boolean) as string[];
  return { list, url: map.url };
}

/** 在线关键词搜索（query-v2；本地索引空时兜底） */
export async function searchHpoiKeyword(
  keyword: string,
  category?: number,
  pageSize = 30,
): Promise<HpoiProductCard[]> {
  const list = await hpoiQueryV2({
    keyword,
    category: category ?? 100,
    order: 'add',
    page: 1,
    pageSize,
  });
  return list.map((it) => ({
    itemId: it.itemId,
    name: it.nameCN || it.name || `hpoi ${it.itemId}`,
    cover: it.cover,
    releaseDate: it.releaseDate,
  }));
}

export interface HpoiSeriesCard {
  id: number;
  name: string;
  cover?: string;
}

/** 厂商关联系列（`series/list/<urlId>` 页面） */
export async function fetchCompanySeries(
  urlId: number,
): Promise<HpoiSeriesCard[]> {
  const html = await hpoiPage(`series/list/${urlId}`);
  const out: HpoiSeriesCard[] = [];
  const seen = new Set<number>();
  const re = /href="series\/(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const id = Number(m[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    const win = html.slice(m.index, m.index + 600);
    const cover = win.match(
      /src="(https?:\/\/rfx\.hpoi\.net\/gk\/cover\/[^"]+)"/,
    )?.[1];
    const name =
      win.match(/alt="([^"]{1,90})"/)?.[1] ||
      win.match(/<a[^>]*>([^<]{1,90})<\/a>/)?.[1] ||
      `系列 ${id}`;
    out.push({ id, name: decodeEntities(name.trim()), cover });
  }
  return out;
}

/** 系列产品（`series/<id>` 页面） */
export async function fetchSeriesProducts(
  seriesId: number,
): Promise<HpoiCard[]> {
  const html = await hpoiPage(`series/${seriesId}`);
  return parseHobbyCards(html);
}

/** 时间流用的情报条目（noteGroup 形状） */
export interface HpoiIntelNote {
  postId: string;
  date: string;
  title: string;
  link: string;
  coverUrl?: string;
  categories: string[];
}

/** 情报整体超时：hpoi 连不上时不要让刷新一直卡着重试（翻页会多发请求，放宽一些） */
const INTEL_TIMEOUT_MS = 25000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * 情报缓存（持久化到 appDataDir/hpoi-intel-cache.json）。
 * 与 fig-memo / moeyo 一致：时间流**只读缓存**，只有「刷新」才联网抓；
 * 因此不刷新就不会打 hpoi，hpoi 挂掉也不影响时间流。
 */
let intelCache: {
  /** 缓存结构版本；升级解析逻辑时 +1，旧缓存作废并强制重跑全量 */
  v?: number;
  at: number;
  ids: number[];
  notes: HpoiIntelNote[];
  /** 是否已做过一次「全量回溯」（此后只增量，避免每次全量） */
  full?: boolean;
} | null = null;
/** 当前情报缓存版本（改过 feed 解析/时间解析就 +1） */
const INTEL_CACHE_V = 3;
let intelCacheLoaded = false;
/** 回溯/刷新进行中的单例（并发调用共享同一次，避免重复从头跑、消息叠加） */
let intelRefreshInflight: Promise<HpoiIntelNote[]> | null = null;

async function intelCacheFile(): Promise<string> {
  return await path.join(await path.appDataDir(), 'hpoi-intel-cache.json');
}

async function loadIntelCache(): Promise<void> {
  if (intelCacheLoaded) return;
  intelCacheLoaded = true;
  try {
    const p = await intelCacheFile();
    if (await fs.exists(p)) {
      intelCache = JSON.parse(await fs.readTextFile(p));
    }
  } catch {
    intelCache = null;
  }
}

async function saveIntelCache(): Promise<void> {
  try {
    await fs.writeTextFile(await intelCacheFile(), JSON.stringify(intelCache));
  } catch {
    // 忽略写失败
  }
}

/**
 * 时间流用：**只读缓存**（不联网）。空数组 = 不进时间流。
 * 每日 `days` 过滤在读取时做；若当前勾选分类与缓存不一致，返回空（等刷新）。
 */
export async function getHpoiIntelNotes(
  days = 7,
  categoryIds?: number[],
): Promise<HpoiIntelNote[]> {
  const ids = (categoryIds || []).filter((id) => Number.isFinite(id));
  if (ids.length === 0) return [];
  await loadIntelCache();
  if (!intelCache) return [];
  if (JSON.stringify(intelCache.ids) !== JSON.stringify(ids)) return [];
  const cutoff = Date.now() - Math.max(1, days) * 86400 * 1000;
  return intelCache.notes.filter((n) => new Date(n.date).getTime() >= cutoff);
}

/**
 * 刷新情报。
 * - **首次/未覆盖**：回溯到 `days` 天（或 feed 到头），分页抓全（后台跑一次，超时放宽到 3 分钟）。
 * - **其后**：只做增量——从最新页往回翻，碰到「整页都已在缓存」就停（正常 1 页）。
 * 缓存与旧数据**合并累积**，不清空。由「刷新」/ 时间流自动刷新 / 启用 hpoi 时调用。
 */
export function refreshHpoiIntel(
  days = 7,
  categoryIds?: number[],
  onProgress?: (p: {
    mode: 'full' | 'incr';
    page: number;
    total: number;
  }) => void,
): Promise<HpoiIntelNote[]> {
  // 单例：已有在跑的直接复用，避免并发重复回溯 / 进度消息互相覆盖
  if (intelRefreshInflight) return intelRefreshInflight;
  intelRefreshInflight = refreshHpoiIntelInternal(
    days,
    categoryIds,
    onProgress,
  ).finally(() => {
    intelRefreshInflight = null;
  });
  return intelRefreshInflight;
}

async function refreshHpoiIntelInternal(
  days = 7,
  categoryIds?: number[],
  onProgress?: (p: {
    mode: 'full' | 'incr';
    page: number;
    total: number;
  }) => void,
): Promise<HpoiIntelNote[]> {
  const ids = (categoryIds || []).filter((id) => Number.isFinite(id));
  await loadIntelCache();
  if (ids.length === 0) {
    intelCache = { at: Date.now(), ids: [], notes: [] };
    await saveIntelCache();
    return [];
  }
  const cutoff = Date.now() - Math.max(1, days) * 86400 * 1000;
  const byId = new Map<number, HpoiIntelNote>();
  const sameIds =
    !!intelCache &&
    intelCache.v === INTEL_CACHE_V &&
    JSON.stringify(intelCache.ids) === JSON.stringify(ids);
  // 先并入旧缓存（分类集合一致时），让更早的事件累积而非每次刷新被覆盖
  if (sameIds) {
    for (const n of intelCache!.notes) {
      if (new Date(n.date).getTime() >= cutoff) byId.set(Number(n.postId), n);
    }
  }
  // 覆盖判定：缓存最早一条是否已到日期范围（留 2 天余量）。
  // 不够 30 天 → 回溯全量；够了 → 只增量。
  // （另存 full 标记：hpoi feed 本身可能到不了 30 天，避免每次都重复全量）
  let covers = false;
  if (sameIds && intelCache!.notes.length > 0) {
    const oldest = Math.min(
      ...intelCache!.notes.map((n) => new Date(n.date).getTime()),
    );
    covers = oldest <= cutoff + 2 * 86400 * 1000;
  }
  const full = !(covers || (sameIds && !!intelCache!.full));
  const PAGE_CAP = full ? 200 : 8;
  const timeoutMs = full ? 180000 : INTEL_TIMEOUT_MS;
  let fullOk = true; // 全量过程中任何一次请求失败 → 不标 full，下次重试
  let aborted = false; // 超时/返回后停止内部翻页，别再弹进度
  await withTimeout(
    (async () => {
      for (const cid of ids) {
        let lastTime: string | undefined;
        for (let page = 0; page < PAGE_CAP; page++) {
          if (aborted) return;
          let items: HpoiIntel[] = [];
          let next: string | undefined;
          try {
            const r = await fetchIntelFeed({
              categoryId: cid,
              subType: 'all',
              lastTime,
            });
            items = r.items;
            next = r.lastTime;
          } catch {
            if (full) fullOk = false;
            break;
          }
          if (items.length === 0) break;
          onProgress?.({
            mode: full ? 'full' : 'incr',
            page: page + 1,
            total: byId.size,
          });
          // 情报流每页会混有很旧的条目，不能用「有一条超范围就停」，
          // 要整页都在日期范围外才停，否则会漏掉后面页里的近期事件。
          let allOld = true;
          let newCount = 0;
          for (const it of items) {
            const iso = parseIntelTime(it.timeText);
            const t = new Date(iso).getTime();
            if (!(t < cutoff)) allOld = false;
            if (t < cutoff) continue;
            if (byId.has(it.itemId)) continue;
            byId.set(it.itemId, {
              postId: String(it.itemId),
              date: iso,
              title: it.title || it.shortName,
              link: it.url,
              coverUrl: hpoiCoverUrl(it.cover, 's'),
              categories: [it.categoryName, it.eventLabel].filter(
                Boolean,
              ) as string[],
            });
            newCount++;
          }
          if (allOld) break; // 已翻到日期范围外
          // 增量模式：整页都在缓存里 → 后面的更旧，停
          if (!full && newCount === 0) break;
          if (!next) break;
          lastTime = next;
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    })(),
    timeoutMs,
    undefined,
  );
  aborted = true;
  const notes = Array.from(byId.values()).sort((a, b) =>
    a.date < b.date ? 1 : -1,
  );
  // 抓到内容才覆盖缓存（全失败时保留旧数据，避免时间流清空）
  if (notes.length > 0) {
    intelCache = {
      v: INTEL_CACHE_V,
      at: Date.now(),
      ids,
      notes,
      full: full ? fullOk : !!intelCache?.full,
    };
    await saveIntelCache();
  }
  return notes.length > 0 ? notes : intelCache?.notes ?? [];
}
