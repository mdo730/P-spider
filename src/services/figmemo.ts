import { fs, path } from '@tauri-apps/api';
import dayjs from 'dayjs';
import MediaType from '../enums/MediaType';
import { request } from '../ipc/network';
import { PlatformMedia, PlatformPost } from '../platforms';
import { useDownloadStore } from '../stores/download';
import { useFigmemoTagsStore } from '../stores/figmemo-tags';
import { useSettingsStore } from '../stores/settings';
import { getMediaKind, isMediaFile, mapLimit } from '../utils/library';
import { unicodeFilenamify } from '../utils/unicode';
import { isSpectatorOn } from '../utils/spectator';
import { HpoiMatch } from './hpoi';
import hpoiSeedData from '../data/hpoi-matches.json';
import { FIGMEMO_MANUFACTURER_ALIAS } from './figmemo-manufacturer-alias';
import figmemoMetaSeedData from '../data/figmemo-meta-seed.json';
import figmemoSiteSeedData from '../data/figmemo-site-seed.json';

/** 内置文章元数据种子：postId → { imageCount }（离线补的图片数；不含用户手标标签） */
const FIGMEMO_META_SEED = figmemoMetaSeedData as Record<
  string,
  { imageCount?: number }
>;

/** 内置站点缓存种子（文章清单/分类/封面），首启本地无缓存时用它初始化 */
const FIGMEMO_SITE_SEED = figmemoSiteSeedData;

/** 内置 hpoi 绑定种子（离线批量匹配结果），postId → 紧凑快照 */
const HPOI_SEED = hpoiSeedData as Record<
  string,
  {
    itemId: number;
    nameCN?: string;
    name?: string;
    companyName?: string;
    scale?: number;
    rating?: number;
    commentCount?: number;
    cover?: string;
  }
>;

/** 从内置种子取某篇的 hpoi 快照（无则为 undefined） */
function seedHpoi(postId: string): HpoiMatch | undefined {
  const s = HPOI_SEED[String(postId)];
  if (!s || !s.itemId) return undefined;
  return {
    itemId: s.itemId,
    nameCN: s.nameCN || '',
    name: s.name || '',
    companyName: s.companyName || '',
    scale: s.scale,
    rating: s.rating,
    commentCount: s.commentCount,
    cover: s.cover,
    releaseDate: undefined,
    tags: [],
    matchedAt: '',
  };
}

/** 记录是否被用户显式解除过 hpoi（解除后不再回落到内置种子） */
function resolveHpoi(
  meta: { hpoi?: HpoiMatch; hpoiRemoved?: boolean } | undefined,
  postId: string,
): HpoiMatch | undefined {
  if (meta?.hpoi) return meta.hpoi;
  if (meta?.hpoiRemoved) return undefined;
  return seedHpoi(postId);
}

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('FIG');
  return _log;
}

const SITE = 'https://fig-memo-r18.site';
// XSERVER WAF 会 403 掉 /wp-json/ 路径；用 WordPress 的 ?rest_route= 查询形式可绕过
const API = `${SITE}/?rest_route=/wp/v2`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const PER_PAGE = 100;
const MAX_TITLE = 60;

export const FIGMEMO_SOURCE = 'figmemo' as const;
export const FIGMEMO_AUTHOR = 'fig-memo';
/** 追新任务标记（用于统计只计新文章、不计建库） */
export const FIGMEMO_FEED_ID = 'figmemo-feed';
/** 站点分类自动落成标签时的根标签名（fig-memo 下挂分类） */
const FIGMEMO_TAG_ROOT = 'fig-memo';
/** 厂商标签的根标签名 */
const MANUFACTURER_ROOT = '厂商';
/** 年份标签的根标签名 */
const YEAR_ROOT = '年份';
/** 旧版分类根标签名（迁移用） */
const LEGACY_CATEGORY_ROOT = '分类';

export interface FigmemoPost {
  id: string;
  date: string;
  link: string;
  title: string;
  categoryIds: number[];
  /** 特色图媒体 id（封面用） */
  featuredMedia?: number;
}

export interface FigmemoCategory {
  id: number;
  name: string;
  slug: string;
  count: number;
}

export interface FigmemoMeta {
  postId: string;
  title: string;
  date: string;
  link: string;
  categories: { id: number; name: string; slug: string }[];
  imageCount: number;
  /** 文章级标签（姿势/发型/体型…）：组名 → 取值列表 */
  articleTags?: Record<string, string[]>;
  /** 已确认的 hpoi 词条关联快照 */
  hpoi?: HpoiMatch;
  /** 用户显式解除过 hpoi（解除后不再回落内置种子） */
  hpoiRemoved?: boolean;
}

export interface FigmemoProgress {
  phase: 'checking' | 'building';
  total: number;
  done: number;
}

function truncateTitle(title: string): string {
  const arr = [...title];
  return arr.length > MAX_TITLE ? arr.slice(0, MAX_TITLE).join('') : title;
}

/** 帖子相对 saveDirBase 的目录（与下载管线一致：fig-memo/<日期 标题>） */
export function figmemoRelDir(title: string, date?: string): string {
  const prefix = date ? dayjs(date).format('YYYY-MM-DD') : '';
  const name = unicodeFilenamify(truncateTitle(title));
  return `${FIGMEMO_AUTHOR}/${`${prefix} ${name}`.trim()}`;
}

async function getJson(
  url: string,
  query: Record<string, string>,
): Promise<any> {
  const res = await request({
    method: 'GET',
    responseType: 'json',
    url,
    query,
    headers: { 'User-Agent': UA },
    maxRetry: 3,
  });
  if (res.status >= 400) throw new Error(`请求失败 status=${res.status}`);
  return res.body;
}

export async function fetchCategories(): Promise<Map<number, FigmemoCategory>> {
  const body = await getJson(`${API}/categories`, {
    per_page: '100',
    _fields: 'id,name,slug,count',
  });
  const map = new Map<number, FigmemoCategory>();
  for (const c of (body || []) as any[]) {
    map.set(c.id, {
      id: c.id,
      name: c.name,
      slug: c.slug,
      count: c.count || 0,
    });
  }
  return map;
}

async function fetchPostsPage(
  page: number,
  categoryIds?: number[],
): Promise<FigmemoPost[]> {
  let body: any;
  try {
    const query: Record<string, string> = {
      per_page: String(PER_PAGE),
      page: String(page),
      orderby: 'date',
      order: 'desc',
      _fields: 'id,date,link,title,categories,featured_media',
    };
    if (categoryIds && categoryIds.length) {
      query.categories = categoryIds.join(',');
    }
    body = await getJson(`${API}/posts`, query);
  } catch {
    // 页码越界（WP 返回 400）视为结束
    return [];
  }
  return ((body || []) as any[]).map((p) => ({
    id: String(p.id),
    date: p.date,
    link: p.link,
    title: p.title?.rendered || '',
    categoryIds: p.categories || [],
    featuredMedia: p.featured_media || undefined,
  }));
}

/** 最新一帖的发布日期（用于开启时的基线） */
export async function fetchNewestPostDate(): Promise<string | null> {
  const posts = await fetchPostsPage(1);
  return posts[0]?.date || null;
}

/** 全部帖子（建库用；categoryIds 非空时只取这些分类） */
export async function fetchAllPosts(
  categoryIds?: number[],
): Promise<FigmemoPost[]> {
  const out: FigmemoPost[] = [];
  for (let page = 1; page <= 1000; page += 1) {
    const posts = await fetchPostsPage(page, categoryIds);
    out.push(...posts);
    if (posts.length < PER_PAGE) break;
  }
  return out;
}

/** 基线之后的新帖（追新用，最新在前；可限定分类） */
export async function fetchPostsNewerThan(
  baselineISO: string | null,
  categoryIds?: number[],
): Promise<FigmemoPost[]> {
  const out: FigmemoPost[] = [];
  const base = baselineISO ? dayjs(baselineISO) : null;
  for (let page = 1; page <= 50; page += 1) {
    const posts = await fetchPostsPage(page, categoryIds);
    if (posts.length === 0) break;
    let reachedOld = false;
    for (const p of posts) {
      if (base && !dayjs(p.date).isAfter(base)) {
        reachedOld = true;
        break;
      }
      out.push(p);
    }
    if (reachedOld || posts.length < PER_PAGE) break;
  }
  return out;
}
/** 老帖的图常不是“媒体附件”，回退解析正文 HTML 取原图 */
async function fetchContentImages(postId: string): Promise<PlatformMedia[]> {
  let body: any;
  try {
    body = await getJson(`${API}/posts/${postId}`, { _fields: 'content' });
  } catch {
    return [];
  }
  const html: string = body?.content?.rendered || '';
  const urls = new Set<string>();
  const re =
    /https:\/\/fig-memo-r18\.site\/wp-content\/uploads\/[^"'\s)]+?\.(?:jpg|jpeg|png|webp|gif)/gi;
  for (const m of html.matchAll(re)) {
    const url = m[0];
    if (url.includes('/cache/')) continue;
    urls.add(url.replace(/-\d+x\d+(\.\w+)$/, '$1'));
  }
  return [...urls].map((url) => ({
    id: url,
    type: MediaType.Photo,
    url,
    thumbUrl: url,
    downloadUrl: url,
    fileName: decodeURIComponent(url.split('/').pop() || '') || 'figmemo',
  }));
}

/** 从 WP 媒体 media_details 里挑一个适中尺寸做大图网格缩略图（省流量、秒开） */
function pickThumbUrl(details: any, fallback: string): string {
  const sizes = details?.sizes;
  if (!sizes) return fallback;
  for (const key of ['medium', 'medium_large', 'large', 'thumbnail']) {
    const s = sizes[key];
    if (s?.source_url) return String(s.source_url);
  }
  return fallback;
}

/** 某帖的图片原图：优先媒体附件，为空则回退正文解析（覆盖老帖） */
export async function fetchPostImages(
  postId: string,
): Promise<PlatformMedia[]> {
  const out: PlatformMedia[] = [];
  for (let page = 1; page <= 50; page += 1) {
    let body: any;
    try {
      body = await getJson(`${API}/media`, {
        parent: String(postId),
        per_page: String(PER_PAGE),
        page: String(page),
        _fields: 'id,source_url,mime_type,media_details',
      });
    } catch {
      break;
    }
    const list = (body || []) as any[];
    for (const m of list) {
      if (!m?.source_url) continue;
      if (m.mime_type && !String(m.mime_type).startsWith('image/')) continue;
      const url: string = m.source_url;
      out.push({
        id: String(m.id),
        type: MediaType.Photo,
        url,
        thumbUrl: pickThumbUrl(m.media_details, url),
        downloadUrl: url,
        fileName:
          decodeURIComponent(url.split('/').pop() || '') || `figmemo-${m.id}`,
      });
    }
    if (list.length < PER_PAGE) break;
  }

  if (out.length === 0) {
    return await fetchContentImages(postId);
  }
  return out;
}

async function metaFilePath(): Promise<string> {
  return await path.join(await path.appDataDir(), 'figmemo.jsonl');
}

export async function readExistingMetaIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const file = await metaFilePath();
    if (!(await fs.exists(file))) return ids;
    const text = await fs.readTextFile(file);
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r?.postId) ids.add(String(r.postId));
      } catch {
        // ignore bad line
      }
    }
  } catch (err) {
    log().warn('读取 figmemo.jsonl 失败', err);
  }
  return ids;
}

export async function appendMeta(record: FigmemoMeta): Promise<void> {
  const file = await metaFilePath();
  await fs.writeTextFile(file, `${JSON.stringify(record)}\n`, { append: true });
}

/** 新建或更新某篇文章元数据的 imageCount（保留已有文章级标签等字段） */
export async function upsertMetaImageCount(
  post: {
    postId: string;
    title: string;
    date: string;
    link: string;
    categories: { id: number; name: string; slug: string }[];
  },
  imageCount: number,
): Promise<void> {
  const records = await readMetaRecords();
  const idx = records.findIndex(
    (r) => String(r.postId) === String(post.postId),
  );
  if (idx >= 0) {
    records[idx] = {
      ...records[idx],
      title: post.title,
      date: post.date,
      link: post.link,
      categories: post.categories,
      imageCount,
    };
  } else {
    records.push({ ...post, imageCount });
  }
  const file = await metaFilePath();
  const text = records.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeTextFile(file, text ? `${text}\n` : '');
}

/**
 * 写入/更新某篇文章的文章级标签（姿势/发型/体型…），并同步进标签树
 * （组名作根标签、取值作子标签，文章路径挂到对应标签）。
 * 没有元数据记录的文章（未下载）也会补建一条记录。
 */
export async function setArticleTags(
  post: {
    postId: string;
    title: string;
    date: string;
    link: string;
    categories: { id: number; name: string; slug: string }[];
    imageCount: number;
  },
  articleTags: Record<string, string[]>,
): Promise<void> {
  const clean: Record<string, string[]> = {};
  for (const [group, values] of Object.entries(articleTags)) {
    const arr = (values || []).map((v) => v.trim()).filter(Boolean);
    if (arr.length) clean[group] = arr;
  }
  const records = await readMetaRecords();
  const idx = records.findIndex(
    (r) => String(r.postId) === String(post.postId),
  );
  const prev = (idx >= 0 ? records[idx].articleTags : undefined) || {};
  if (idx >= 0) {
    records[idx] = { ...records[idx], articleTags: clean };
  } else {
    records.push({
      postId: post.postId,
      title: post.title,
      date: post.date,
      link: post.link,
      categories: post.categories,
      imageCount: post.imageCount,
      articleTags: clean,
    });
  }
  const file = await metaFilePath();
  const text = records.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeTextFile(file, text ? `${text}\n` : '');

  // 同步进标签树：差分出要挂/摘的标签
  const relPath = figmemoRelDir(post.title, post.date);
  const groups = new Set([...Object.keys(prev), ...Object.keys(clean)]);
  const rootMap = useFigmemoTagsStore.getState().addTagsBatch(
    [...groups].map((g) => ({ name: g, parentId: null })),
    'user',
  );
  const childSpecs = [...groups].flatMap((g) => {
    const pid = rootMap[tagKeyOf(null, g)];
    if (!pid) return [];
    return (clean[g] || []).map((v) => ({ name: v, parentId: pid }));
  });
  const childMap = useFigmemoTagsStore
    .getState()
    .addTagsBatch(childSpecs, 'user');

  const nextIds = new Set<string>();
  for (const g of Object.keys(clean)) {
    const pid = rootMap[tagKeyOf(null, g)] || '';
    for (const v of clean[g]) {
      const id = pid ? childMap[tagKeyOf(pid, v)] : undefined;
      if (id) nextIds.add(id);
    }
  }
  const prevIds = new Set<string>();
  for (const g of Object.keys(prev)) {
    for (const v of prev[g] || []) {
      const id = findTagId(g, v);
      if (id) prevIds.add(id);
    }
  }
  const added = [...nextIds].filter((id) => !prevIds.has(id));
  const removed = [...prevIds].filter((id) => !nextIds.has(id));
  if (added.length)
    useFigmemoTagsStore
      .getState()
      .applyFolderTags([{ relPath, tagIds: added }]);
  if (removed.length)
    useFigmemoTagsStore.getState().removeFolderTags([relPath], removed);
}

/** 写入/清除某篇文章的 hpoi 关联快照（没有元数据记录的文章也会补建一条） */
export async function setHpoiMatch(
  post: {
    postId: string;
    title: string;
    date: string;
    link: string;
    categories: { id: number; name: string; slug: string }[];
    imageCount: number;
  },
  hpoi: HpoiMatch | null,
): Promise<void> {
  const records = await readMetaRecords();
  const idx = records.findIndex(
    (r) => String(r.postId) === String(post.postId),
  );
  if (idx >= 0) {
    if (hpoi) {
      records[idx] = { ...records[idx], hpoi };
      delete records[idx].hpoiRemoved;
    } else {
      const next = { ...records[idx] };
      delete next.hpoi;
      next.hpoiRemoved = true;
      records[idx] = next;
    }
  } else if (hpoi) {
    records.push({ ...post, hpoi });
  } else {
    return;
  }
  const file = await metaFilePath();
  const text = records.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeTextFile(file, text ? `${text}\n` : '');
}

/** 读取 figmemo.jsonl 全部元数据记录 */
export async function readMetaRecords(): Promise<FigmemoMeta[]> {
  const out: FigmemoMeta[] = [];
  try {
    const file = await metaFilePath();
    if (await fs.exists(file)) {
      const text = await fs.readTextFile(file);
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as FigmemoMeta;
          if (r?.postId) out.push(r);
        } catch {
          // ignore bad line
        }
      }
    }
  } catch (err) {
    log().warn('读取 figmemo.jsonl 失败', err);
  }
  // 合并内置文章种子：补 imageCount；本地缺失的记录补建（新装/清数据后也有图片数）
  const byId = new Map(out.map((r) => [String(r.postId), r]));
  for (const [pid, s] of Object.entries(FIGMEMO_META_SEED)) {
    const r = byId.get(pid);
    if (r) {
      if (!r.imageCount && s.imageCount) r.imageCount = s.imageCount;
    } else if (s.imageCount) {
      const rec: FigmemoMeta = {
        postId: pid,
        title: '',
        date: '',
        link: '',
        categories: [],
        imageCount: s.imageCount,
      };
      out.push(rec);
      byId.set(pid, rec);
    }
  }
  return out;
}

/** hpoi 词条 id → fig-memo 文章 的反向索引（moeyo 详情「在 fig-memo 查看」跳转用） */
let _hpoiPostIndex: Map<number, { postId: string; title: string }> | null =
  null;
export async function getHpoiPostIndex(): Promise<
  Map<number, { postId: string; title: string }>
> {
  if (_hpoiPostIndex) return _hpoiPostIndex;
  const map = new Map<number, { postId: string; title: string }>();
  const put = (postId: string, itemId?: number, title?: string) => {
    if (itemId && !map.has(itemId))
      map.set(itemId, { postId, title: title || '' });
  };
  const records = await readMetaRecords();
  const titleById = new Map(records.map((r) => [String(r.postId), r.title]));
  for (const r of records) {
    const h = resolveHpoi(r, String(r.postId));
    put(String(r.postId), h?.itemId, r.title);
  }
  for (const [pid, s] of Object.entries(HPOI_SEED)) {
    if (!s?.itemId || map.has(s.itemId)) continue;
    put(pid, s.itemId, titleById.get(pid) || '');
  }
  _hpoiPostIndex = map;
  return map;
}

/** hpoi 词条 id → fig-memo 文章（可能多篇）反向索引（带封面） */
let _figmemoHpoiIndexArr: Map<
  number,
  { postId: string; title: string; coverUrl?: string }[]
> | null = null;
export async function getFigmemoHpoiPostIndex(): Promise<
  Map<number, { postId: string; title: string; coverUrl?: string }[]>
> {
  if (_figmemoHpoiIndexArr) return _figmemoHpoiIndexArr;
  const map = new Map<
    number,
    { postId: string; title: string; coverUrl?: string }[]
  >();
  const coverByPost = new Map<string, string>();
  try {
    const cache = await readSiteCache();
    if (cache) {
      for (const p of cache.posts || []) {
        const u =
          (p.featuredMedia && cache.featured?.[String(p.featuredMedia)]) ||
          cache.postCovers?.[String(p.id)];
        if (u) coverByPost.set(String(p.id), u);
      }
    }
  } catch {
    // 站点缓存缺失不影响索引
  }
  const push = (itemId?: number, postId?: string, title?: string) => {
    if (!itemId || !postId) return;
    const arr = map.get(itemId) || [];
    arr.push({
      postId: String(postId),
      title: title || '',
      coverUrl: coverByPost.get(String(postId)),
    });
    map.set(itemId, arr);
  };
  const records = await readMetaRecords();
  const titleById = new Map(records.map((r) => [String(r.postId), r.title]));
  for (const r of records) {
    const h = resolveHpoi(r, String(r.postId));
    push(h?.itemId, String(r.postId), r.title);
  }
  for (const [pid, s] of Object.entries(HPOI_SEED)) {
    push(s?.itemId, pid, titleById.get(pid) || '');
  }
  _figmemoHpoiIndexArr = map;
  return map;
}

/** 不作厂商的写法（文库/栏目等）：命中则不打厂商标签 */
const MANUFACTURER_DROP = new Set([
  'メディアワークス',
  'アスキー・メディアワークス',
]);

/** 从标题猜厂商：取第一个「之前的文本（如 `BINDing「…」` → `BINDing`），并归一为 hpoi 中文规范名 */
function guessManufacturer(title: string): string {
  const idx = title.indexOf('「');
  // 没有「 就不是「厂商「商品名」」格式 → 不猜（避免把展会/栏目名当厂商）
  if (idx <= 0) return '';
  const prefix = title.slice(0, idx).trim();
  if (!prefix || prefix.length > 30) return '';
  // 以【…】开头的是限定/贩卖说明等噪音，不是厂商
  if (prefix.startsWith('【')) return '';
  if (MANUFACTURER_DROP.has(prefix)) return '';
  const name = FIGMEMO_MANUFACTURER_ALIAS[prefix] ?? prefix;
  if (MANUFACTURER_DROP.has(name)) return '';
  return name;
}

/** 在标签树中按「根名 + 子名」查标签 id */
function findTagId(rootName: string, childName: string): string | undefined {
  const tags = useFigmemoTagsStore.getState().tags;
  const root = tags.find(
    (t) => (t.parentId ?? null) === null && t.name === rootName,
  );
  if (!root) return undefined;
  return tags.find(
    (t) => (t.parentId ?? null) === root.id && t.name === childName,
  )?.id;
}

const tagKeyOf = (pid: string | null, name: string) =>
  `${pid ?? ''}\u0000${name}`;

/**
 * 厂商标签一次性归一（升级兼容）：
 * 1.4.x 的厂商标签是按标题原文直接生成的（还包含无「」的垃圾词条），
 * 1.5 起才归一为 hpoi 规范名。若不处理，老库会堆满重复/垃圾标签。
 * 做法：清空「厂商」子树里自动标签的 paths → 重新同步 → 删掉没被用到的。
 */
const MAKER_NORMALIZE_VERSION = 1;

/** 「厂商」根及其全部子孙的标签 id */
function makerSubtreeIds(): Set<string> {
  const tags = useFigmemoTagsStore.getState().tags;
  const root = tags.find(
    (t) => (t.parentId ?? null) === null && t.name === MANUFACTURER_ROOT,
  );
  const out = new Set<string>();
  if (!root) return out;
  const childrenOf = new Map<string, string[]>();
  for (const t of tags) {
    const pid = t.parentId ?? null;
    if (!pid) continue;
    const arr = childrenOf.get(pid);
    if (arr) arr.push(t.id);
    else childrenOf.set(pid, [t.id]);
  }
  const stack = [root.id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const c of childrenOf.get(cur) || []) stack.push(c);
  }
  return out;
}

/** 清空「厂商」子树里自动标签的 paths（用户手动标签不动） */
function clearMakerPaths(): void {
  const ids = makerSubtreeIds();
  if (ids.size === 0) return;
  const store = useFigmemoTagsStore.getState();
  let changed = false;
  const next = store.tags.map((t) => {
    if (t.origin === 'user' || !t.paths.length || !ids.has(t.id)) return t;
    changed = true;
    return { ...t, paths: [] };
  });
  if (changed) useFigmemoTagsStore.setState({ tags: next });
}

/** 删除「厂商」根下没有文章挂着的自动标签（用户手动标签不动）；返回删除数 */
function pruneEmptyMakerTags(): number {
  const store = useFigmemoTagsStore.getState();
  const root = store.tags.find(
    (t) => (t.parentId ?? null) === null && t.name === MANUFACTURER_ROOT,
  );
  if (!root) return 0;
  const dead = store.tags.filter(
    (t) =>
      (t.parentId ?? null) === root.id &&
      t.origin !== 'user' &&
      !t.paths.length,
  );
  if (!dead.length) return 0;
  const deadIds = new Set(dead.map((t) => t.id));
  useFigmemoTagsStore.setState({
    tags: store.tags.filter((t) => !deadIds.has(t.id)),
  });
  return dead.length;
}

function needMakerNormalize(): boolean {
  return (
    (useFigmemoTagsStore.getState().makerNormalized ?? 0) <
    MAKER_NORMALIZE_VERSION
  );
}

/** 手动「重建标签树」：强制再跑一次厂商归一，返回清理掉的标签数 */
export async function rebuildFigmemoMakerTags(): Promise<number> {
  const before = makerSubtreeIds().size;
  useFigmemoTagsStore.setState({ makerNormalized: 0 });
  await loadCachedSitePosts();
  return before - makerSubtreeIds().size;
}

/**
 * 由**站点文章数据**生成标签树（分类 / 厂商 / 年份 / 文章级标签），
 * 覆盖全部文章（含未下载）。一次写盘生成关系。
 */
async function syncSiteTags(
  posts: FigmemoPost[],
  cats: Map<number, FigmemoCategory>,
  metaRecords: FigmemoMeta[],
): Promise<number> {
  const normalize = needMakerNormalize();
  if (normalize) clearMakerPaths();
  const namesById = new Map<number, string>();
  for (const c of cats.values()) namesById.set(c.id, c.name);
  for (const r of metaRecords) {
    for (const c of r.categories || []) {
      if (!namesById.has(c.id)) namesById.set(c.id, c.name);
    }
  }
  const metaById = new Map(metaRecords.map((r) => [String(r.postId), r]));

  interface Entry {
    title: string;
    date: string;
    categoryIds: number[];
    articleTags?: Record<string, string[]>;
  }
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const p of posts) {
    seen.add(String(p.id));
    entries.push({
      title: p.title,
      date: p.date,
      categoryIds: p.categoryIds,
      articleTags: metaById.get(String(p.id))?.articleTags,
    });
  }
  for (const r of metaRecords) {
    const id = String(r.postId);
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({
      title: r.title,
      date: r.date,
      categoryIds: (r.categories || []).map((c) => c.id),
      articleTags: r.articleTags,
    });
  }

  // 收集文章级标签分组（组名作根标签）
  const articlePairs = new Map<string, Set<string>>();
  for (const e of entries) {
    for (const [g, vs] of Object.entries(e.articleTags || {})) {
      if (!articlePairs.has(g)) articlePairs.set(g, new Set());
      for (const v of vs || []) if (v) articlePairs.get(g)!.add(v);
    }
  }

  // 建根标签（站点分类 / 厂商 / 年份 + 文章级分组）
  const rootMap = useFigmemoTagsStore
    .getState()
    .addTagsBatch([
      { name: FIGMEMO_TAG_ROOT, parentId: null },
      { name: MANUFACTURER_ROOT, parentId: null },
      { name: YEAR_ROOT, parentId: null },
      ...[...articlePairs.keys()].map((g) => ({ name: g, parentId: null })),
    ]);
  const rootId = rootMap[tagKeyOf(null, FIGMEMO_TAG_ROOT)] || '';
  const mfrRootId = rootMap[tagKeyOf(null, MANUFACTURER_ROOT)] || '';
  const yearRootId = rootMap[tagKeyOf(null, YEAR_ROOT)] || '';

  // 收集一级子标签
  const catNames = new Set<string>();
  const mfrNames = new Set<string>();
  const yearNames = new Set<string>();
  for (const e of entries) {
    for (const cid of e.categoryIds) {
      const n = namesById.get(cid);
      if (n) catNames.add(n);
    }
    const mfr = guessManufacturer(e.title);
    if (mfr) mfrNames.add(mfr);
    const y = e.date ? dayjs(e.date).format('YYYY') : '';
    if (y) yearNames.add(y);
  }
  const childSpecs = [
    ...[...catNames].map((name) => ({ name, parentId: rootId })),
    ...[...mfrNames].map((name) => ({ name, parentId: mfrRootId })),
    ...[...yearNames].map((name) => ({ name, parentId: yearRootId })),
    ...[...articlePairs].flatMap(([g, vals]) => {
      const pid = rootMap[tagKeyOf(null, g)] || '';
      return [...vals].map((v) => ({ name: v, parentId: pid }));
    }),
  ].filter((s) => s.parentId);
  const childMap = useFigmemoTagsStore.getState().addTagsBatch(childSpecs);

  // 逐条算标签，一次性写入文件夹关系
  const relEntries: { relPath: string; tagIds: string[] }[] = [];
  let tagged = 0;
  for (const e of entries) {
    const relPath = figmemoRelDir(e.title, e.date);
    const tagIds: string[] = [];
    for (const cid of e.categoryIds) {
      const n = namesById.get(cid);
      if (n && rootId) {
        const id = childMap[tagKeyOf(rootId, n)];
        if (id) tagIds.push(id);
      }
    }
    const mfr = guessManufacturer(e.title);
    if (mfr && mfrRootId) {
      const id = childMap[tagKeyOf(mfrRootId, mfr)];
      if (id) tagIds.push(id);
    }
    const y = e.date ? dayjs(e.date).format('YYYY') : '';
    if (y && yearRootId) {
      const id = childMap[tagKeyOf(yearRootId, y)];
      if (id) tagIds.push(id);
    }
    for (const [g, vals] of Object.entries(e.articleTags || {})) {
      const pid = rootMap[tagKeyOf(null, g)] || '';
      if (!pid) continue;
      for (const v of vals || []) {
        const id = childMap[tagKeyOf(pid, v)];
        if (id) tagIds.push(id);
      }
    }
    if (tagIds.length) {
      relEntries.push({ relPath, tagIds });
      tagged += 1;
    }
  }
  useFigmemoTagsStore.getState().applyFolderTags(relEntries);

  if (normalize) {
    if (entries.length > 0) {
      const removed = pruneEmptyMakerTags();
      useFigmemoTagsStore.setState({
        makerNormalized: MAKER_NORMALIZE_VERSION,
      });
      log().info('厂商标签归一完成', { entries: entries.length, removed });
    } else {
      log().warn('厂商标签归一：无文章数据，跳过清理');
    }
  }
  return tagged;
}

/**
 * 拉取站点数据并重建标签树（分类 + 厂商 + 年份 + 文章级标签）：
 * 覆盖**站点全部文章**（含未下载）。建库/追新结束后或手动都可调用。
 */
export async function syncLocalTags(): Promise<number> {
  const base = useSettingsStore.getState().download.saveDirBase;
  if (!base) return 0;

  // 兼容旧数据：根「分类」→「fig-memo」
  const tagsNow = useFigmemoTagsStore.getState().tags;
  const legacy = tagsNow.find(
    (t) => (t.parentId ?? null) === null && t.name === LEGACY_CATEGORY_ROOT,
  );
  const hasNewRoot = tagsNow.some(
    (t) => (t.parentId ?? null) === null && t.name === FIGMEMO_TAG_ROOT,
  );
  if (legacy && !hasNewRoot) {
    try {
      useFigmemoTagsStore.getState().renameTag(legacy.id, FIGMEMO_TAG_ROOT);
    } catch {
      // ignore
    }
  }

  const [sitePosts, metaRecords, cats] = await Promise.all([
    fetchAllPosts().catch(() => [] as FigmemoPost[]),
    readMetaRecords(),
    fetchCategories().catch(() => new Map<number, FigmemoCategory>()),
  ]);
  const tagged = await syncSiteTags(sitePosts, cats, metaRecords);
  log().info('syncLocalTags', { entries: sitePosts.length, tagged });
  return tagged;
}

async function processPost(
  post: FigmemoPost,
  categories: Map<number, FigmemoCategory>,
  existingIds: Set<string>,
  /** 是否为订阅后追新的新文章（true：计统计；false：建库补档不计） */
  isFeed: boolean,
): Promise<number> {
  const images = await fetchPostImages(post.id);

  if (!existingIds.has(post.id)) {
    const cats = post.categoryIds
      .map((id) => categories.get(id))
      .filter((c): c is FigmemoCategory => !!c);
    await appendMeta({
      postId: post.id,
      title: post.title,
      date: post.date,
      link: post.link,
      categories: cats.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      imageCount: images.length,
    });
    existingIds.add(post.id);
  }

  // 标签不在此处打：统一由 syncLocalTags 基于本地文件夹同步（本地有才建）

  // 超级旁观者：追新（isFeed）时不自动下载文件，仅更新元数据/缓存供时间流使用
  if (isFeed && isSpectatorOn()) return 0;

  if (images.length === 0) return 0;

  const platformPost: PlatformPost = {
    id: post.id,
    creator: {
      id: FIGMEMO_SOURCE,
      name: FIGMEMO_AUTHOR,
      username: FIGMEMO_AUTHOR,
    },
    publishedAt: dayjs(post.date),
    text: truncateTitle(post.title),
    medias: images,
    links: [],
    postUrl: post.link,
    source: FIGMEMO_SOURCE,
  };

  await useDownloadStore.getState().batchCreateDownloadTask(
    images.map((media) => ({
      source: FIGMEMO_SOURCE,
      post: platformPost,
      media,
      subscriptionId: isFeed ? FIGMEMO_FEED_ID : undefined,
    })),
  );
  return images.length;
}

/** 建库范围：年份（含起止）；不填=不限 */
export interface FigmemoYearRange {
  fromYear?: number;
  toYear?: number;
}
export async function runFigmemoBuild(
  categoryIds: number[],
  yearRange: FigmemoYearRange,
  onProgress: (p: FigmemoProgress) => void,
  signal: AbortSignal,
): Promise<{ posts: number; images: number }> {
  const categories = await fetchCategories();
  const existing = await readExistingMetaIds();
  let all = await fetchAllPosts(categoryIds);
  if (yearRange.fromYear || yearRange.toYear) {
    all = all.filter((p) => {
      const y = dayjs(p.date).year();
      if (yearRange.fromYear && y < yearRange.fromYear) return false;
      if (yearRange.toYear && y > yearRange.toYear) return false;
      return true;
    });
  }

  let images = 0;
  let done = 0;
  onProgress({ phase: 'building', total: all.length, done: 0 });
  for (const post of all) {
    if (signal.aborted) break;
    try {
      images += await processPost(post, categories, existing, false);
    } catch (err) {
      log().warn('处理帖子失败', post.id, err);
    }
    done += 1;
    onProgress({ phase: 'building', total: all.length, done });
  }
  // 建库结束后，按本地已存在的文件夹同步标签
  if (!signal.aborted) {
    try {
      await syncLocalTags();
    } catch (err) {
      log().warn('syncLocalTags 失败', err);
    }
  }
  return { posts: all.length, images };
}

/** 追新：下载基线之后的新文章（可限定分类）；计统计 */
export async function runFigmemoCheck(
  baselineISO: string | null,
  categoryIds: number[],
  onProgress: (p: FigmemoProgress) => void,
  signal: AbortSignal,
): Promise<{ newestDate?: string; posts: number; images: number }> {
  const categories = await fetchCategories();
  const existing = await readExistingMetaIds();
  const posts = await fetchPostsNewerThan(baselineISO, categoryIds);

  let images = 0;
  let done = 0;
  onProgress({ phase: 'checking', total: posts.length, done: 0 });
  for (const post of posts) {
    if (signal.aborted) break;
    try {
      images += await processPost(post, categories, existing, true);
    } catch (err) {
      log().warn('处理帖子失败', post.id, err);
    }
    done += 1;
    onProgress({ phase: 'checking', total: posts.length, done });
  }
  // 追新结束后，按本地已存在的文件夹同步标签
  if (!signal.aborted) {
    try {
      await syncLocalTags();
    } catch (err) {
      log().warn('syncLocalTags 失败', err);
    }
  }
  return { newestDate: posts[0]?.date, posts: posts.length, images };
}

export interface FigmemoListItem {
  postId: string;
  title: string;
  date: string;
  link: string;
  categories: { id: number; name: string; slug: string }[];
  imageCount: number;
  folderName: string;
  folderPath: string;
  exists: boolean;
  coverPath?: string;
  /** 站点封面图 URL（未下载文章也能显示缩略图） */
  coverUrl?: string;
  /** 文章级标签（姿势/发型/体型…） */
  articleTags?: Record<string, string[]>;
  /** 已确认的 hpoi 词条关联快照 */
  hpoi?: HpoiMatch;
  /** 用户显式解除过 hpoi 关联（自动匹配不再回填） */
  hpoiRemoved?: boolean;
}

/** 本地文件夹的图片数 + 首图（会话缓存，避免重复 readDir） */
interface FolderImageInfo {
  first?: string;
  count: number;
}
const folderImageCache = new Map<string, FolderImageInfo>();
async function folderImageInfoCached(dir: string): Promise<FolderImageInfo> {
  const cached = folderImageCache.get(dir);
  if (cached) return cached;
  let info: FolderImageInfo = { first: undefined, count: 0 };
  try {
    const entries = await fs.readDir(dir, { recursive: false });
    let first: string | undefined;
    let count = 0;
    for (const entry of entries) {
      const name = entry.name || entry.path.split(/[\\/]/).pop() || '';
      if (isMediaFile(name) && getMediaKind(name) === 'image') {
        count += 1;
        if (!first) first = entry.path;
      }
    }
    info = { first, count };
  } catch {
    // 文件夹不存在
  }
  folderImageCache.set(dir, info);
  return info;
}

/**
 * 本地文章列表：读 figmemo.jsonl 元数据（不扫整盘），按需取本地文件夹封面；按发布时间倒序。
 */
export async function listLocalPosts(
  onEach?: (item: FigmemoListItem) => void,
): Promise<FigmemoListItem[]> {
  const base = useSettingsStore.getState().download.saveDirBase || '';
  const baseDir = base.replace(/[\\/]+$/, '');
  const records = await readMetaRecords();
  records.sort((a, b) => (a.date < b.date ? 1 : -1));
  return await mapLimit(records, 8, async (r) => {
    const folderName = `${r.date.slice(0, 10)} ${unicodeFilenamify(
      truncateTitle(r.title),
    )}`;
    const folderPath = `${baseDir}\\fig-memo\\${folderName}`;
    const exists = await fs.exists(folderPath);
    const localInfo = exists
      ? await folderImageInfoCached(folderPath)
      : undefined;
    const item: FigmemoListItem = {
      postId: r.postId,
      title: r.title,
      date: r.date,
      link: r.link,
      categories: r.categories || [],
      imageCount: exists ? localInfo?.count || 0 : r.imageCount || 0,
      folderName,
      folderPath,
      exists,
      coverPath: localInfo?.first,
      articleTags: r.articleTags,
      hpoi: resolveHpoi(r, r.postId),
      hpoiRemoved: r.hpoiRemoved === true,
    };
    onEach?.(item);
    return item;
  });
}

/** 拉取文章正文（网页式详情用；清洗掉外链/小图/脚本等噪音） */
export async function fetchPostDetail(
  postId: string,
): Promise<{ title: string; contentHtml: string; link: string }> {
  const body = await getJson(`${API}/posts/${postId}`, {
    _fields: 'title,content,link',
  });
  const raw: string = body?.content?.rendered || '';
  const contentHtml = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // 图片块（含带货小图）整块移除，图片改由下方缩略图网格呈现
    .replace(/<figure[\s\S]*?<\/figure>/gi, '')
    // 外部链接（多为带货/购物链接）整段移除
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/<img\b[^>]*>/gi, '');
  return {
    title: body?.title?.rendered || '',
    contentHtml,
    link: body?.link || '',
  };
}

interface FigmemoSiteCache {
  version: 1;
  fetchedAt: number;
  posts: FigmemoPost[];
  categories: FigmemoCategory[];
  /** 特色图媒体 id → 原图 URL */
  featured: Record<string, string>;
  /** 文章 id → 封面 URL（缺特色图时取正文首图；空串表示已查过但无图） */
  postCovers: Record<string, string>;
}

async function siteCachePath(): Promise<string> {
  return await path.join(await path.appDataDir(), 'figmemo-site.json');
}

async function readSiteCache(): Promise<FigmemoSiteCache | null> {
  try {
    const file = await siteCachePath();
    if (await fs.exists(file)) {
      const obj = JSON.parse(await fs.readTextFile(file));
      if (obj?.posts) return obj as FigmemoSiteCache;
    }
    // 本地无缓存 → 用内置站点种子初始化（新用户首启秒开、离线可用；随后照常增量刷新）
    if (FIGMEMO_SITE_SEED?.posts?.length) {
      const seed = FIGMEMO_SITE_SEED as unknown as FigmemoSiteCache;
      await writeSiteCache(seed);
      return seed;
    }
    return null;
  } catch (err) {
    log().warn('读取站点缓存失败', err);
    return null;
  }
}

async function writeSiteCache(cache: FigmemoSiteCache): Promise<void> {
  try {
    await fs.writeTextFile(await siteCachePath(), JSON.stringify(cache));
  } catch (err) {
    log().warn('写入站点缓存失败', err);
  }
}

export interface FigmemoNote {
  postId: string;
  date: string;
  title: string;
  link: string;
  coverUrl?: string;
  /** 文章所属分类名（去重） */
  categories: string[];
}

/** 近 N 天的站点文章（时间流「新记事」用；含未下载） */
export async function getRecentSiteNotes(days = 7): Promise<FigmemoNote[]> {
  const cache = await readSiteCache();
  if (!cache) return [];
  const catName = new Map<number, string>(
    (cache.categories || []).map((c) => [c.id, c.name]),
  );
  const start = Date.now() - days * 24 * 60 * 60 * 1000;
  const out: FigmemoNote[] = [];
  for (const p of cache.posts) {
    const t = new Date(p.date).getTime();
    if (Number.isNaN(t) || t < start) continue;
    const categories: string[] = [];
    for (const cid of p.categoryIds || []) {
      const name = catName.get(cid);
      if (name && !categories.includes(name)) categories.push(name);
    }
    const featured = p.featuredMedia
      ? cache.featured[String(p.featuredMedia)]
      : undefined;
    const coverUrl = featured || cache.postCovers[p.id] || undefined;
    out.push({
      postId: p.id,
      date: p.date,
      title: p.title,
      link: p.link,
      coverUrl,
      categories,
    });
  }
  return out;
}

/** 站点缓存里 文章 id → 分类名（时间流给已下载条目补分类用） */
export async function getSiteCategoryMap(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const cache = await readSiteCache();
  if (!cache) return map;
  const catName = new Map<number, string>(
    (cache.categories || []).map((c) => [c.id, c.name]),
  );
  for (const p of cache.posts) {
    const names: string[] = [];
    for (const cid of p.categoryIds || []) {
      const name = catName.get(cid);
      if (name && !names.includes(name)) names.push(name);
    }
    if (names.length) map.set(p.id, names);
  }
  return map;
}

/** 一次性枚举已下载的 fig-memo 文件夹名（避免逐篇 fs.exists） */
async function listDownloadedFolderNames(
  baseDir: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const entries = await fs.readDir(`${baseDir}\\${FIGMEMO_AUTHOR}`, {
      recursive: false,
    });
    for (const e of entries) {
      if (e.children) set.add(e.name || '');
    }
  } catch {
    // 目录不存在
  }
  return set;
}

async function buildItems(
  posts: FigmemoPost[],
  cats: Map<number, FigmemoCategory>,
  metaById: Map<string, FigmemoMeta>,
  dirSet: Set<string>,
  featured: Map<number, string>,
  postCovers: Map<string, string>,
  baseDir: string,
): Promise<FigmemoListItem[]> {
  const sorted = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));
  return await mapLimit(sorted, 16, async (p) => {
    const folderName = `${p.date.slice(0, 10)} ${unicodeFilenamify(
      truncateTitle(p.title),
    )}`;
    const folderPath = `${baseDir}\\fig-memo\\${folderName}`;
    const exists = dirSet.has(folderName);
    const meta = metaById.get(p.id);
    const networkCover =
      (p.featuredMedia && featured.get(p.featuredMedia)) ||
      postCovers.get(p.id) ||
      undefined;
    // 本地优先：已下载就用本地首图（走缩略图缓存，秒开），没有才回退站点封面 URL
    const localInfo = exists
      ? await folderImageInfoCached(folderPath)
      : undefined;
    const coverPath = localInfo?.first;
    const coverUrl = coverPath ? undefined : networkCover;
    return {
      postId: p.id,
      title: p.title,
      date: p.date,
      link: p.link,
      categories: p.categoryIds
        .map((id) => cats.get(id))
        .filter((c): c is FigmemoCategory => !!c)
        .map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      imageCount: exists ? localInfo?.count || 0 : meta?.imageCount || 0,
      folderName,
      folderPath,
      exists,
      coverPath,
      coverUrl,
      articleTags: meta?.articleTags,
      hpoi: resolveHpoi(meta, p.id),
      hpoiRemoved: meta?.hpoiRemoved === true,
    };
  });
}

function filterByCategories(
  posts: FigmemoPost[],
  categoryIds?: number[],
): FigmemoPost[] {
  if (!categoryIds || categoryIds.length === 0) return posts;
  return posts.filter((p) =>
    p.categoryIds.some((id) => categoryIds.includes(id)),
  );
}

/**
 * 用本地缓存快速构建文章列表（不联网），命中缓存时秒开。
 * 同时用缓存数据重建标签树。无缓存时返回 null。
 */
export async function loadCachedSitePosts(
  categoryIds?: number[],
): Promise<FigmemoListItem[] | null> {
  const base = useSettingsStore.getState().download.saveDirBase || '';
  const baseDir = base.replace(/[\\/]+$/, '');
  const cache = await readSiteCache();
  if (!cache) return null;
  const cats = new Map(cache.categories.map((c) => [c.id, c]));
  const metaRecords = await readMetaRecords();
  const metaById = new Map(metaRecords.map((r) => [r.postId, r]));
  const featured = new Map(
    Object.entries(cache.featured || {}).map(([k, v]) => [Number(k), v]),
  );
  const postCovers = new Map(Object.entries(cache.postCovers || {}));
  await syncSiteTags(cache.posts, cats, metaRecords);
  const dirSet = await listDownloadedFolderNames(baseDir);
  return await buildItems(
    filterByCategories(cache.posts, categoryIds),
    cats,
    metaById,
    dirSet,
    featured,
    postCovers,
    baseDir,
  );
}

/**
 * 增量拉取：从第 1 页往后，直到遇到已缓存文章为止（通常只需 1 页）。
 */
async function fetchNewPosts(existingIds: Set<string>): Promise<FigmemoPost[]> {
  const out: FigmemoPost[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const posts = await fetchPostsPage(page);
    if (posts.length === 0) break;
    let hitCached = false;
    for (const p of posts) {
      if (existingIds.has(String(p.id))) {
        hitCached = true;
        break;
      }
      out.push(p);
    }
    if (hitCached || posts.length < PER_PAGE) break;
  }
  return out;
}

/**
 * 刷新站点文章列表：有缓存则**只拉新增文章**合并（快），无缓存则做一次全量快照。
 * 写入缓存并重建标签树。categoryIds 只影响显示范围。
 */
export async function refreshSitePosts(
  categoryIds?: number[],
): Promise<FigmemoListItem[]> {
  const base = useSettingsStore.getState().download.saveDirBase || '';
  const baseDir = base.replace(/[\\/]+$/, '');
  const cache = await readSiteCache();
  const metaRecords = await readMetaRecords();
  const cats = await fetchCategories();

  let allPosts: FigmemoPost[];
  const featured = new Map<number, string>();
  const postCovers = new Map<string, string>(
    Object.entries(cache?.postCovers || {}),
  );
  if (cache && cache.posts.length) {
    for (const [k, v] of Object.entries(cache.featured || {})) {
      featured.set(Number(k), v);
    }
    const existingIds = new Set(cache.posts.map((p) => String(p.id)));
    const newPosts = await fetchNewPosts(existingIds);
    allPosts = [...newPosts, ...cache.posts];
    const needIds = newPosts
      .map((p) => p.featuredMedia || 0)
      .filter((id) => id > 0 && !featured.has(id));
    for (const [k, v] of await resolveFeaturedUrls(needIds)) featured.set(k, v);
  } else {
    // 首次：全量快照
    allPosts = await fetchAllPosts();
    const needIds = allPosts.map((p) => p.featuredMedia || 0);
    for (const [k, v] of await resolveFeaturedUrls(needIds)) featured.set(k, v);
  }

  // 仍无封面的文章：用正文首图兜底（含老文章；查过无图记空串，避免重复查）
  const missingCoverIds = allPosts
    .filter((p) => {
      const fm = p.featuredMedia || 0;
      if (fm && featured.has(fm)) return false;
      return postCovers.get(String(p.id)) === undefined;
    })
    .map((p) => String(p.id));
  if (missingCoverIds.length) {
    const resolved = await resolveContentCovers(missingCoverIds);
    for (const [k, v] of resolved) postCovers.set(k, v);
  }

  const featuredObj: Record<string, string> = {};
  for (const [k, v] of featured) featuredObj[String(k)] = v;
  const postCoversObj: Record<string, string> = {};
  for (const [k, v] of postCovers) postCoversObj[k] = v;
  await writeSiteCache({
    version: 1,
    fetchedAt: Date.now(),
    posts: allPosts,
    categories: [...cats.values()],
    featured: featuredObj,
    postCovers: postCoversObj,
  });

  await syncSiteTags(allPosts, cats, metaRecords);
  const metaById = new Map(metaRecords.map((r) => [r.postId, r]));
  const dirSet = await listDownloadedFolderNames(baseDir);
  return await buildItems(
    filterByCategories(allPosts, categoryIds),
    cats,
    metaById,
    dirSet,
    featured,
    postCovers,
    baseDir,
  );
}

/** 从正文 HTML 取第一张图 URL */
function firstImageUrlFromHtml(html: string): string {
  const m = /<img\b[^>]*?(?:data-src|src)=["']([^"']+)["']/i.exec(html);
  let url = m?.[1] || '';
  if (url.startsWith('//')) url = `https:${url}`;
  if (!/^https?:/i.test(url)) return '';
  return url;
}

/** 批量用正文首图补文章封面（每 100 篇一批）；无图记空串 */
async function resolveContentCovers(
  postIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(postIds)];
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    try {
      const body = await getJson(`${API}/posts`, {
        include: chunk.join(','),
        per_page: '100',
        _fields: 'id,content',
      });
      for (const p of (body || []) as any[]) {
        const html = p?.content?.rendered || '';
        map.set(String(p.id), firstImageUrlFromHtml(html));
      }
    } catch (err) {
      log().warn('正文封面解析失败', err);
    }
  }
  return map;
}

/** 批量把特色图媒体 id 解析为原图 URL（每 100 个一批） */
async function resolveFeaturedUrls(
  ids: number[],
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const uniq = [...new Set(ids.filter((id) => id > 0))];
  for (let i = 0; i < uniq.length; i += 100) {
    await resolveFeaturedChunk(uniq.slice(i, i + 100), map);
  }
  return map;
}

/** 解析一批特色图；失败则二分重试（个别无效 id 不会拖垮整批） */
async function resolveFeaturedChunk(
  ids: number[],
  map: Map<number, string>,
): Promise<void> {
  if (ids.length === 0) return;
  try {
    const body = await getJson(`${API}/media`, {
      include: ids.join(','),
      per_page: '100',
      _fields: 'id,source_url',
    });
    for (const m of (body || []) as any[]) {
      if (m?.id && m.source_url) map.set(m.id, m.source_url);
    }
  } catch (err) {
    if (ids.length === 1) {
      log().warn('解析特色图失败', ids[0], err);
      return;
    }
    const mid = Math.floor(ids.length / 2);
    await resolveFeaturedChunk(ids.slice(0, mid), map);
    await resolveFeaturedChunk(ids.slice(mid), map);
  }
}

/** 保存单张远程媒体到本地（按图文目录规则，与整篇保存一致） */
export async function saveFigmemoMedia(
  item: FigmemoListItem,
  media: PlatformMedia,
): Promise<void> {
  const platformPost: PlatformPost = {
    id: item.postId,
    creator: {
      id: FIGMEMO_SOURCE,
      name: FIGMEMO_AUTHOR,
      username: FIGMEMO_AUTHOR,
    },
    publishedAt: dayjs(item.date),
    text: truncateTitle(item.title),
    medias: [media],
    links: [],
    postUrl: item.link,
    source: FIGMEMO_SOURCE,
  };
  await useDownloadStore
    .getState()
    .batchCreateDownloadTask([
      { source: FIGMEMO_SOURCE, post: platformPost, media },
    ]);
}

/** 保存单篇文章到本地（手动保存：不计统计、不打标；调用方随后可 syncLocalTags） */
export async function saveFigmemoPost(item: FigmemoListItem): Promise<number> {
  const images = await fetchPostImages(item.postId);
  if (images.length === 0) return 0;
  await upsertMetaImageCount(
    {
      postId: item.postId,
      title: item.title,
      date: item.date,
      link: item.link,
      categories: item.categories,
    },
    images.length,
  );
  const platformPost: PlatformPost = {
    id: item.postId,
    creator: {
      id: FIGMEMO_SOURCE,
      name: FIGMEMO_AUTHOR,
      username: FIGMEMO_AUTHOR,
    },
    publishedAt: dayjs(item.date),
    text: truncateTitle(item.title),
    medias: images,
    links: [],
    postUrl: item.link,
    source: FIGMEMO_SOURCE,
  };
  await useDownloadStore.getState().batchCreateDownloadTask(
    images.map((media) => ({
      source: FIGMEMO_SOURCE,
      post: platformPost,
      media,
    })),
  );
  return images.length;
}
