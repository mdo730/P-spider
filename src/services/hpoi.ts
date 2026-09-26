import { request } from '../ipc/network';

const BASE = 'https://www.hpoi.net/api';
const IMG_ROOT = 'https://rfx.hpoi.net/gk';
const UA = 'hpoi/android';
const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const SITE = 'https://www.hpoi.net';

/**
 * 允许做 hpoi 匹配的 fig-memo 站点分类 id：
 * 16=フィギュアレビュー、140=レビュー（R18）、364=予約開始情報。
 * 其余分类（イベント/セール 等）不做匹配。
 */
export const HPOI_MATCH_CATEGORY_IDS = [16, 140, 364];

/** hpoi 词条（/api/search 或 /api/hobby/query-v2 返回的单条，字段按需取） */
export interface HpoiItem {
  itemId: number;
  name?: string;
  nameCN?: string;
  name_ja?: string[] | string;
  name_en?: string;
  aliases?: string[] | string;
  companyName?: string;
  companyId?: number;
  scale?: number;
  rating?: number;
  ratingScore?: number;
  commentCount?: number;
  cover?: string;
  releaseDate?: string;
  textTags?: { tagValue: string; id: number }[] | null;
  workerName?: string;
  detail?: string;
}

/** 已确认关联的 hpoi 快照（存 figmemo.jsonl 的 hpoi 字段） */
export interface HpoiMatch {
  itemId: number;
  nameCN: string;
  name: string;
  companyName: string;
  scale?: number;
  rating?: number;
  commentCount?: number;
  cover?: string;
  releaseDate?: string;
  tags: string[];
  matchedAt: string;
}

/** 候选（带匹配分，给 UI 展示 top-N） */
export interface HpoiCandidate extends HpoiMatch {
  score: number;
}

export interface FigmemoProductInfo {
  maker: string;
  product: string;
  scale?: number;
}

/** 从 fig-memo 标题/正文解析厂商、商品名、比例（标题 `厂商「商品名」…` 优先） */
export function parseFigmemoFields(
  title: string,
  html?: string,
): FigmemoProductInfo {
  let maker = '';
  let product = '';
  let scale: number | undefined;
  const t = title.match(/^([^「]+?)「(.+?)」/);
  if (t) {
    maker = t[1].trim();
    product = t[2].trim();
  }
  if (html) {
    const text = html.replace(/<[^>]*>/g, '\n');
    if (!maker) {
      const m = text.match(/メーカー\s*[:：]\s*([^\n]+)/);
      if (m) maker = m[1].trim();
    }
    if (!product) {
      const m = text.match(/商品名\s*[:：]\s*([^\n]+)/);
      if (m) product = m[1].trim();
    }
    const sm = text.match(/スケール\s*[:：]\s*([^\n]+)/);
    if (sm) scale = parseScale(sm[1]);
  }
  return { maker, product: product || title.trim(), scale };
}

function parseScale(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s
    .replace(/\s/g, '')
    .match(/(?:[0-9]+\s*[/／]\s*)?([0-9]+(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : undefined;
}

export function hpoiDetailUrl(itemId: number | string): string {
  return `${SITE}/hobby/${itemId}`;
}

export function hpoiCoverUrl(cover?: string): string | undefined {
  if (!cover) return undefined;
  // 手动校正时存的是完整大图 URL，转成缩略图省流量
  if (/^https?:\/\//.test(cover))
    return cover.replace('/cover/n/', '/cover/s/');
  return `${IMG_ROOT}/cover/s/${cover}`;
}

/** 从贴进来的 hpoi 链接/文本里解析词条 id（支持 hobby/111926、纯数字、含其它参数） */
export function parseHpoiId(input: string): number | null {
  const s = (input || '').trim();
  if (!s) return null;
  const m = s.match(/hobby\/(\d+)/i) || s.match(/(\d{2,})/);
  return m ? Number(m[1]) : null;
}

// ---------------- 按 id 拉词条（解析详情页 JSON-LD，含日文别名与准确评分） ----------------

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

/**
 * 按 hpoi 词条 id 取快照：抓详情页 HTML 的 JSON-LD Product。
 * alternatename 常含日文原名、aggregateRating 是准确评分——比列表接口更全。
 */
export async function fetchHpoiItemById(itemId: number): Promise<HpoiMatch> {
  const res = await request({
    method: 'GET',
    responseType: 'text',
    url: `${SITE}/hobby/${itemId}`,
    headers: { 'User-Agent': UA_BROWSER, 'Accept-Language': 'zh-CN' },
    bypassProxy: true,
    maxRetry: 2,
  });
  const html: string = (res.body as any) || '';
  if (res.status >= 400 || !html) {
    throw new Error(`打开 hpoi 词条失败 status=${res.status}`);
  }
  const prod = extractProduct(html);
  if (!prod) throw new Error('未能从 hpoi 页面解析出词条信息');
  const desc: string = prod.description || '';
  const scaleM = desc.match(
    /比例\s*[:：]\s*(?:[0-9]+\s*[/／]\s*)?([0-9]+(?:\.[0-9]+)?)/,
  );
  const alt: string[] = Array.isArray(prod.alternateName)
    ? prod.alternateName
    : prod.alternateName
      ? [prod.alternateName]
      : [];
  const jp = alt.find((s: string) => /[\u3040-\u30ff]/.test(s));
  const ar = prod.aggregateRating || {};
  return {
    itemId,
    nameCN: prod.name || `hpoi ${itemId}`,
    name: jp || alt[0] || '',
    companyName: prod.manufacturer?.name || '',
    scale: scaleM ? Number(scaleM[1]) : undefined,
    rating: ar.ratingValue ? Number(ar.ratingValue) : undefined,
    commentCount: ar.ratingCount ? Number(ar.ratingCount) : undefined,
    cover: prod.image || undefined,
    releaseDate: prod.releaseDate,
    tags: [],
    matchedAt: new Date().toISOString(),
  };
}

// ---------------- HTTP ----------------

async function hpoiGet(
  path: string,
  query: Record<string, string>,
): Promise<any> {
  const res = await request({
    method: 'GET',
    responseType: 'json',
    url: `${BASE}${path}`,
    query,
    headers: { 'User-Agent': UA },
    bypassProxy: true,
    maxRetry: 2,
  });
  if (res.status >= 400) throw new Error(`hpoi 请求失败 status=${res.status}`);
  const body = res.body as any;
  if (body && body.success === false) {
    throw new Error(body.msg || 'hpoi 接口返回错误');
  }
  return body?.data ?? {};
}

async function hpoiPostForm(
  path: string,
  form: Record<string, string | number>,
): Promise<any> {
  const body = new URLSearchParams(
    Object.entries(form).map(([k, v]) => [k, String(v)]),
  ).toString();
  const res = await request({
    method: 'POST',
    responseType: 'json',
    url: `${BASE}${path}`,
    body,
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
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

// ---------------- 厂商 id 解析（带内存缓存） ----------------

const MAKER_ALIAS: Record<string, string[]> = {
  apex: ['apex-toys', 'apextoys'],
  'reverse studio': ['逆转工作室'],
  'violet studio': ['violetstudio'],
  'hobby sakura': ['hobby·sakura', 'hobbysakura'],
  インサイト: ['insight'],
  ダイキ工業: ['daiki工业', 'daiki'],
  フリーイング: ['freeing'],
  ヴェルテクス: ['vertex'],
  マジックバレット: ['魔弹'],
  グッドスマイルアーツ上海: ['良笑塑美'],
  'pink・cat': ['pink cat', 'pinkcat'],
  'kuro games': ['库洛'],
};

function normText(s?: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[\s\-_·・:：,，。.()（）[\]「」『』/]/g, '');
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bg = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const A = bg(a);
  const B = bg(b);
  let inter = 0;
  let total = 0;
  A.forEach((c, g) => {
    total += c;
    const c2 = B.get(g);
    if (c2) inter += Math.min(c, c2);
  });
  B.forEach((c) => {
    total += c;
  });
  return total ? (2 * inter) / total : 0;
}

function companyScore(maker: string, company?: string): number {
  const m = normText(maker);
  const c = normText(company);
  if (!m || !c) return 0;
  if (m === c) return 1;
  if (m.includes(c) || c.includes(m)) return 0.9;
  for (const alt of MAKER_ALIAS[maker.trim().toLowerCase()] || []) {
    const a = normText(alt);
    if (a && (a === c || a.includes(c) || c.includes(a))) return 0.9;
  }
  const d = dice(m, c);
  return d > 0.6 ? d : 0;
}

const companyIdCache = new Map<string, number | null>();

/** 厂商名 → hpoi companyId（/api/search 关键词搜厂商，取公司名最像的） */
export async function resolveCompanyId(maker: string): Promise<number | null> {
  const key = maker.trim();
  if (!key) return null;
  if (companyIdCache.has(key)) return companyIdCache.get(key) ?? null;
  let cid: number | null = null;
  try {
    const data = await hpoiGet('/search', {
      keyword: key,
      page: '1',
      pageSize: '20',
    });
    const list: HpoiItem[] = data.result || [];
    let best = 0;
    for (const it of list) {
      if (!it.companyId || !it.companyName) continue;
      const s = companyScore(key, it.companyName);
      if (s > best) {
        best = s;
        cid = it.companyId;
      }
    }
    if (best <= 0) cid = null;
  } catch {
    cid = null;
  }
  companyIdCache.set(key, cid);
  return cid;
}

// ---------------- 候选检索 ----------------

function stripMods(s: string): string {
  return s
    .replace(/\bVer\.?\b/gi, '')
    .replace(/illustration by .+/i, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim();
}

async function queryByMaker(
  companyId: number,
  keyword: string,
  pageSize = 30,
): Promise<HpoiItem[]> {
  const data = await hpoiPostForm('/hobby/query-v2', {
    workers: companyId,
    keyword,
    category: 100,
    order: 'add',
    page: 1,
    pageSize,
  });
  return (data.list as HpoiItem[]) || [];
}

async function searchByKeyword(
  keyword: string,
  pageSize = 30,
): Promise<HpoiItem[]> {
  const data = await hpoiGet('/search', {
    keyword,
    page: '1',
    pageSize: String(pageSize),
  });
  return (data.result as HpoiItem[]) || [];
}

function collectNames(it: HpoiItem): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) out.push(...v.map(String));
    else if (typeof v === 'string' && v) out.push(v);
  };
  push(it.name);
  push(it.nameCN);
  push(it.name_ja);
  push(it.name_en);
  push(it.aliases);
  return out;
}

function scoreCandidate(info: FigmemoProductInfo, it: HpoiItem): number {
  const p = normText(info.product);
  let nameScore = 0;
  for (const n of collectNames(it)) {
    const nn = normText(n);
    if (!nn) continue;
    let s = dice(p, nn);
    if (p && (p.includes(nn) || nn.includes(p))) s = Math.max(s, 0.92);
    if (s > nameScore) nameScore = s;
  }
  const cScore = companyScore(info.maker, it.companyName);
  const sScore =
    info.scale !== undefined &&
    it.scale !== undefined &&
    Math.abs(info.scale - it.scale) < 0.01
      ? 1
      : 0;
  return nameScore * 60 + cScore * 30 + sScore * 10;
}

function toCandidate(it: HpoiItem, score: number): HpoiCandidate {
  return {
    itemId: it.itemId,
    nameCN: it.nameCN || it.name || String(it.itemId),
    name: it.name || '',
    companyName: it.companyName || '',
    scale: it.scale,
    // 列表接口的 rating/commentCount 语义和详情页 JSON-LD 不一致（前者是总分/评论数），
    // 候选阶段一律不带评分，确认时用 fetchHpoiItemById 的 JSON-LD 真实评分。
    rating: undefined,
    commentCount: undefined,
    cover: it.cover,
    releaseDate: it.releaseDate,
    tags: (it.textTags || []).map((t) => t.tagValue).filter(Boolean),
    matchedAt: '',
    score,
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * 抓 hpoi **网站搜索页**（服务端渲染，排序=用户在浏览器看到的那套，和 /api/search 不同）。
 * 解析结果前 max 条：id / 名称 / 封面 / 厂商（第一个标签）。
 */
export async function searchHpoiWeb(
  keyword: string,
  max = 20,
): Promise<HpoiItem[]> {
  const res = await request({
    method: 'GET',
    responseType: 'text',
    url: `${SITE}/search`,
    query: { keyword, category: '100' },
    headers: { 'User-Agent': UA_BROWSER, 'Accept-Language': 'zh-CN' },
    bypassProxy: true,
    maxRetry: 2,
  });
  const html: string = (res.body as any) || '';
  const out: HpoiItem[] = [];
  const re = /<li class="media[^"]*">([\s\S]*?)<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const block = m[1];
    const idM = block.match(/href="hobby\/(\d+)"/);
    if (!idM) continue;
    const itemId = Number(idM[1]);
    if (out.some((x) => x.itemId === itemId)) continue;
    const nameM = block.match(
      /<h4[^>]*class="media-heading"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/,
    );
    const name = nameM
      ? decodeHtml(nameM[1].replace(/<[^>]+>/g, ''))
      : `hpoi ${itemId}`;
    const coverM = block.match(/<img class="list-item-img" src="([^"]+)"/);
    const labels: string[] = [];
    const lre = /<a[^>]*>\s*<span class="label label-tag">([^<]+)<\/span>/g;
    let lm: RegExpExecArray | null;
    while ((lm = lre.exec(block))) labels.push(decodeHtml(lm[1]));
    out.push({
      itemId,
      nameCN: name,
      name: '',
      companyName: labels[0] || '',
      cover: coverM ? coverM[1] : undefined,
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 找 hpoi 候选（用户定案「2+1」，多次「重新查询」自动翻页）：
 * - 前 `webCount`(默认2) 条：hpoi **网站搜索页**顺序（`/search?keyword=商品名 厂商`，与浏览器一致）
 * - 后 `selfCount`(默认1) 条：厂商目录 + `/api/search` 汇总打分（比例硬过滤）
 * exclude：已展示过的 id；再次调用时两批各自前进（网页 +webCount、自研 +selfCount）。
 */
export async function findHpoiCandidates(
  info: FigmemoProductInfo,
  webCount = 2,
  selfCount = 1,
  exclude: number[] = [],
): Promise<HpoiCandidate[]> {
  const kw = info.product.trim();
  if (!kw) return [];
  const excluded = new Set(exclude);
  // 比例硬过滤：fig-memo 与 hpoi 都有比例且不一致 → 肯定不是同一条（0/缺失视为未知，保留）
  const scalePass = (it: HpoiItem) => {
    if (info.scale === undefined) return true;
    if (it.scale === undefined || !it.scale) return true;
    return Math.abs(it.scale - info.scale) < 0.01;
  };
  const bag = new Map<number, HpoiItem>();
  const add = (list: HpoiItem[]) => {
    for (const it of list) {
      if (it && it.itemId && !bag.has(it.itemId)) bag.set(it.itemId, it);
    }
  };
  const cid = await resolveCompanyId(info.maker);
  const stripped = stripMods(kw);
  if (cid) add(await queryByMaker(cid, kw));
  // /api/search 索引了 alternateName，能捞到列表接口(query-v2)捞不到的本地化条目——始终并入
  add(await searchByKeyword(kw, 50));
  if (stripped && stripped !== kw) {
    await delay(200);
    if (cid) add(await queryByMaker(cid, stripped));
    await delay(200);
    add(await searchByKeyword(stripped, 50));
  }

  const keywordFull = [kw, info.maker].filter(Boolean).join(' ');
  let web: HpoiItem[] = [];
  try {
    web = await searchHpoiWeb(keywordFull, 40);
  } catch {
    web = [];
  }
  if (web.length === 0) {
    try {
      web = await searchByKeyword(keywordFull, 40);
    } catch {
      web = [];
    }
  }
  const promoted = web
    .filter((it) => !excluded.has(it.itemId))
    .slice(0, webCount);

  const selfRanked = [...bag.values()]
    .filter((it) => scalePass(it) && !excluded.has(it.itemId))
    .map((it) => ({ it, score: scoreCandidate(info, it) }));
  selfRanked.sort((a, b) => b.score - a.score);
  const selfPicked = selfRanked.slice(0, selfCount);

  const out: HpoiCandidate[] = [];
  const seen = new Set<number>();
  for (const it of promoted) {
    if (it?.itemId && !seen.has(it.itemId)) {
      seen.add(it.itemId);
      out.push(toCandidate(it, scoreCandidate(info, it)));
    }
  }
  for (const { it, score } of selfPicked) {
    if (it?.itemId && !seen.has(it.itemId)) {
      seen.add(it.itemId);
      out.push(toCandidate(it, score));
    }
  }
  return out;
}

/** 候选 → 落库快照 */
export function candidateToMatch(c: HpoiCandidate): HpoiMatch {
  return {
    itemId: c.itemId,
    nameCN: c.nameCN,
    name: c.name,
    companyName: c.companyName,
    scale: c.scale,
    rating: c.rating,
    commentCount: c.commentCount,
    cover: c.cover,
    releaseDate: c.releaseDate,
    tags: c.tags,
    matchedAt: new Date().toISOString(),
  };
}
