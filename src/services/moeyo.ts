import { fs, path } from '@tauri-apps/api';
import dayjs from 'dayjs';
import MediaType from '../enums/MediaType';
import { request } from '../ipc/network';
import { PlatformMedia, PlatformPost } from '../platforms';
import { useDownloadStore } from '../stores/download';
import { useMoeyoTagsStore } from '../stores/moeyo-tags';
import { useSettingsStore } from '../stores/settings';
import { getMediaKind, isMediaFile, mapLimit } from '../utils/library';
import { unicodeFilenamify } from '../utils/unicode';
import { HpoiMatch } from './hpoi';
import moeyoSiteSeedData from '../data/moeyo-site-seed.json';
import moeyoHpoiSeedData from '../data/moeyo-hpoi.json';

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('FIG');
  return _log;
}

const SITE = 'https://moeyo.com';
// XSERVER WAF 会 403 掉 /wp-json/ 路径；用 WordPress 的 ?rest_route= 查询形式可绕过
const API = `${SITE}/?rest_route=/wp/v2`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const PER_PAGE = 100;
/** 首次快照/建库最多拉取的页数（moeyo 全站很大，按时间倒序取最近这些页） */
const MAX_SNAPSHOT_PAGES = 60;
const MAX_TITLE = 60;

export const MOEYO_SOURCE = 'moeyo' as const;
export const MOEYO_AUTHOR = 'moeyo';
/** 追新任务标记（用于统计只计新文章、不计建库） */
export const MOEYO_FEED_ID = 'moeyo-feed';
/** 站点分类自动落成标签时的根标签名（moeyo 下挂分类） */
const MOEYO_TAG_ROOT = 'moeyo';
/** 厂商标签的根标签名 */
const MANUFACTURER_ROOT = '厂商';
/** 年份标签的根标签名 */
const YEAR_ROOT = '年份';
/** 旧版分类根标签名（迁移用） */
const LEGACY_CATEGORY_ROOT = '分类';

export interface MoeyoPost {
  id: string;
  date: string;
  link: string;
  title: string;
  categoryIds: number[];
  /** 特色图媒体 id（封面用） */
  featuredMedia?: number;
}

export interface MoeyoCategory {
  id: number;
  name: string;
  slug: string;
  count: number;
  /** 父分类 id（0=顶层） */
  parent: number;
}

export interface MoeyoMeta {
  postId: string;
  title: string;
  date: string;
  link: string;
  categories: { id: number; name: string; slug: string }[];
  imageCount: number;
  /** 已确认的 hpoi 词条关联快照 */
  hpoi?: HpoiMatch;
}

export interface MoeyoProgress {
  phase: 'checking' | 'building';
  total: number;
  done: number;
}

/** 内置站点清单种子：首启/无本地缓存时初始化，避免首次进入 moeyo 卡几分钟 */
const MOEYO_SITE_SEED = moeyoSiteSeedData as unknown as MoeyoSiteCache;
/** 内置 hpoi 绑定种子（离线批量匹配结果）：postId → 紧凑快照 */
const MOEYO_HPOI_SEED = moeyoHpoiSeedData as Record<
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
  const s = MOEYO_HPOI_SEED[String(postId)];
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

/** 已确认关联优先，其次回退内置种子 */
function resolveHpoi(
  meta: { hpoi?: HpoiMatch } | undefined,
  postId: string,
): HpoiMatch | undefined {
  if (meta?.hpoi) return meta.hpoi;
  return seedHpoi(postId);
}

function truncateTitle(title: string): string {
  const arr = [...title];
  return arr.length > MAX_TITLE ? arr.slice(0, MAX_TITLE).join('') : title;
}

/** 帖子相对 saveDirBase 的目录（与下载管线一致：moeyo/<日期 标题>） */
export function moeyoRelDir(title: string, date?: string): string {
  const prefix = date ? dayjs(date).format('YYYY-MM-DD') : '';
  const name = unicodeFilenamify(truncateTitle(title));
  return `${MOEYO_AUTHOR}/${`${prefix} ${name}`.trim()}`;
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

/** 分类精简：只保留 6 个主分类 + サンプルレビュー/製品版レビュー；
 *  其余分类（展会年份、アキバ新発売、ドール…）通过 alias 归到**最近的保留祖先**。 */
const ALLOWED_TOP_CATEGORIES = [
  'ニュース',
  'フィギュア',
  'イベント',
  'ホビー・模型・プラモ',
  'その他',
];
/** 额外保留的（子）分类：サンプルレビュー / 製品版レビュー / プレスリリース */
const KEEP_CATEGORY_IDS = [1611, 1588, 2548];
const REVIEW_CATEGORY_NAMES = [
  'サンプルレビュー',
  '製品版レビュー',
  'プレスリリース',
];

export async function fetchCategories(): Promise<{
  cats: Map<number, MoeyoCategory>;
  alias: Map<number, number>;
}> {
  // 0) 优先用本地站点缓存 / 内置种子里的分类与 alias（精简结果是固定的，不必每次联网）
  try {
    const cache = await readSiteCache();
    const catsSrc = cache?.categories?.length
      ? cache.categories
      : MOEYO_SITE_SEED?.categories;
    if (catsSrc?.length) {
      const cats = new Map<number, MoeyoCategory>(
        catsSrc.map((c) => [c.id, { ...c }]),
      );
      const aliasSrc =
        (cache?.categoryAlias as Record<string, number> | undefined) ||
        (MOEYO_SITE_SEED?.categoryAlias as
          | Record<string, number>
          | undefined) ||
        {};
      const alias = new Map<number, number>(
        Object.entries(aliasSrc).map(([k, v]) => [Number(k), Number(v)]),
      );
      return { cats, alias };
    }
  } catch {
    // 忽略，走联网兜底
  }
  // 1) 翻页取全所有分类
  const all = new Map<number, MoeyoCategory>();
  for (let page = 1; page <= 20; page += 1) {
    const body = await getJson(`${API}/categories`, {
      per_page: '100',
      page: String(page),
      _fields: 'id,name,slug,count,parent',
    });
    const arr = (body || []) as any[];
    for (const c of arr) {
      all.set(c.id, {
        id: c.id,
        name: c.name || '',
        slug: c.slug,
        count: c.count || 0,
        parent: c.parent || 0,
      });
    }
    if (arr.length < 100) break;
  }
  // 2) 保留集：6 主分类 + 指定子分类
  const keptIds = new Set<number>();
  for (const c of all.values()) {
    if (c.parent === 0 && ALLOWED_TOP_CATEGORIES.includes(c.name)) {
      keptIds.add(c.id);
    }
    if (KEEP_CATEGORY_IDS.includes(c.id)) keptIds.add(c.id);
  }
  const cats = new Map<number, MoeyoCategory>();
  for (const c of all.values()) if (keptIds.has(c.id)) cats.set(c.id, c);
  // 3) 别名：任意分类 → 自身或最近保留祖先
  const alias = new Map<number, number>();
  for (const c of all.values()) {
    let cur = c.id;
    for (let g = 0; g < 12 && cur; g += 1) {
      const cc = all.get(cur);
      if (!cc) break;
      if (keptIds.has(cc.id)) {
        alias.set(c.id, cc.id);
        break;
      }
      cur = cc.parent;
    }
  }
  return { cats, alias };
}

/** 只有这两个（子）分类的文章正文稳定带「商品名 / 発売元 / サイズ」等字段 */
export const MOEYO_HPOI_CATEGORY_IDS = [1611, 1588, 2548]; // サンプルレビュー / 製品版レビュー / プレスリリース

/** 解析 moeyo 文章的「商品名 / 発売元 / サイズ」（供 hpoi 匹配用） */
export function parseMoeyoProduct(
  title: string,
  html?: string,
): { maker: string; product: string; scale?: number } {
  let maker = '';
  let product = '';
  let scale: number | undefined;
  if (html) {
    const text = html.replace(/<[^>]+>/g, '\n');
    const pm = text.match(/(?:商品名|タイトル)\s*[:：]\s*([^\n■]+)/);
    if (pm) product = pm[1].replace(/\s+/g, ' ').trim();
    const mm = text.match(/(?:発売元|メーカー)\s*[:：]\s*([^\n■]+)/);
    if (mm) maker = mm[1].replace(/\s+/g, ' ').trim();
    const sm = text.match(/(?:サイズ|スケール)\s*[:：]\s*([^\n■]+)/);
    if (sm) {
      const sc = sm[1]
        .replace(/\s/g, '')
        .match(/(?:1\/)?([0-9]+(?:\.[0-9]+)?)\s*スケール/);
      if (sc) scale = Number(sc[1]);
    }
  }
  if (!product) {
    const t = title.match(/「(.+?)」/);
    if (t) product = t[1].trim();
  }
  return { maker, product: product || title.trim(), scale };
}

async function fetchPostsPage(
  page: number,
  categoryIds?: number[],
): Promise<MoeyoPost[]> {
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
): Promise<MoeyoPost[]> {
  const out: MoeyoPost[] = [];
  // moeyo 全站 5w+ 篇，按时间倒序只取最近 MAX_SNAPSHOT_PAGES 页（默认 60 页 ≈ 6000 篇），避免首次启用拉爆
  for (let page = 1; page <= MAX_SNAPSHOT_PAGES; page += 1) {
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
): Promise<MoeyoPost[]> {
  const out: MoeyoPost[] = [];
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
/** moeyo 文章图片是**正文内联 `<img>`**（文章无媒体附件 parent=0），解析正文取图 */
async function fetchContentImages(postId: string): Promise<PlatformMedia[]> {
  let body: any;
  try {
    body = await getJson(`${API}/posts/${postId}`, { _fields: 'content' });
  } catch {
    return [];
  }
  const html: string = body?.content?.rendered || '';
  const re =
    /https?:\/\/(?:www\.)?moeyo\.com\/(?:image|wp-content\/uploads)\/[^"'\s)>]+?\.(?:jpg|jpeg|png|webp|gif)/gi;
  // moeyo 每张图在正文里同时有 `001.jpg` 与 `001s.jpg`（s=小图）两个 URL，
  // 按「去掉小图 s 后缀」归一化去重，避免同一张图出现两次（含下载重复）；优先保留不带 s 的原图。
  const toMedia = (url: string): PlatformMedia => {
    const base = url.split('/').pop() || '';
    return {
      id: url,
      type: MediaType.Photo,
      url,
      thumbUrl: url,
      downloadUrl: url,
      fileName: decodeURIComponent(base) || 'moeyo',
    };
  };
  const isSmall = (url: string) => /s\.\w+$/i.test(url.split('/').pop() || '');
  const normKey = (url: string) => {
    const parent = url.slice(0, url.lastIndexOf('/'));
    const base = (url.split('/').pop() || '').replace(/s(\.\w+)$/i, '$1');
    return `${parent}/${base.toLowerCase()}`;
  };
  const byKey = new Map<string, PlatformMedia>();
  const order: string[] = [];
  for (const m of html.matchAll(re)) {
    const url = m[0].replace(/&amp;/g, '&');
    const base = url.split('/').pop() || '';
    if (/^thumbnail\./i.test(base)) continue; // 列表缩略图跳过
    const key = normKey(url);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, toMedia(url));
      order.push(key);
    } else if (isSmall(prev.url || '') && !isSmall(url)) {
      byKey.set(key, toMedia(url)); // 优先保留原图
    }
  }
  return order.map((k) => byKey.get(k)!).filter(Boolean);
}

/** 某帖的图片：moeyo 图片都在正文内联，直接解析正文 */
export async function fetchPostImages(
  postId: string,
): Promise<PlatformMedia[]> {
  return await fetchContentImages(postId);
}

async function metaFilePath(): Promise<string> {
  return await path.join(await path.appDataDir(), 'moeyo.jsonl');
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
    log().warn('读取 moeyo.jsonl 失败', err);
  }
  return ids;
}

export async function appendMeta(record: MoeyoMeta): Promise<void> {
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
    } else {
      const next = { ...records[idx] };
      delete next.hpoi;
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

/** 读取 moeyo.jsonl 全部元数据记录 */
export async function readMetaRecords(): Promise<MoeyoMeta[]> {
  const out: MoeyoMeta[] = [];
  try {
    const file = await metaFilePath();
    if (await fs.exists(file)) {
      const text = await fs.readTextFile(file);
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as MoeyoMeta;
          if (r?.postId) out.push(r);
        } catch {
          // ignore bad line
        }
      }
    }
  } catch (err) {
    log().warn('读取 moeyo.jsonl 失败', err);
  }
  return out;
}

const tagKeyOf = (pid: string | null, name: string) =>
  `${pid ?? ''}\u0000${name}`;

/**
 * 由**站点文章数据**生成标签树（分类 / 厂商 / 年份 / 文章级标签），
 * 覆盖全部文章（含未下载）。一次写盘生成关系。
 */
async function syncSiteTags(
  posts: MoeyoPost[],
  cats: Map<number, MoeyoCategory>,
  metaRecords: MoeyoMeta[],
  alias: Map<number, number>,
): Promise<number> {
  interface Entry {
    postId: string;
    title: string;
    date: string;
    categoryIds: number[];
  }
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const p of posts) {
    seen.add(String(p.id));
    entries.push({
      postId: String(p.id),
      title: p.title,
      date: p.date,
      categoryIds: p.categoryIds,
    });
  }
  for (const r of metaRecords) {
    const id = String(r.postId);
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({
      postId: id,
      title: r.title,
      date: r.date,
      categoryIds: (r.categories || []).map((c) => c.id),
    });
  }

  // 建根标签（站点分类 / 年份）。厂商标签已移除（数量过多会拖慢标签树）
  const rootMap = useMoeyoTagsStore.getState().addTagsBatch([
    { name: MOEYO_TAG_ROOT, parentId: null },
    { name: YEAR_ROOT, parentId: null },
  ]);
  const rootId = rootMap[tagKeyOf(null, MOEYO_TAG_ROOT)] || '';
  const yearRootId = rootMap[tagKeyOf(null, YEAR_ROOT)] || '';

  // 分类标签：按 moeyo 分类树做层级（任意深度；已在 fetchCategories 精简）
  const catsAll = [...cats.values()];
  const depthOf = (id: number): number => {
    let d = 0;
    let cur = cats.get(id);
    for (
      let g = 0;
      g < 10 && cur && cur.parent && cats.has(cur.parent);
      g += 1
    ) {
      d += 1;
      cur = cats.get(cur.parent);
    }
    return d;
  };
  const catTagId = new Map<number, string>();
  const maxDepth = catsAll.reduce((m, c) => Math.max(m, depthOf(c.id)), 0);
  for (let d = 0; d <= maxDepth; d += 1) {
    const level = catsAll.filter((c) => depthOf(c.id) === d);
    if (!level.length) continue;
    const specs = level.map((c) => ({
      name: c.name,
      parentId:
        c.parent && catTagId.has(c.parent) ? catTagId.get(c.parent)! : rootId,
    }));
    const res = useMoeyoTagsStore.getState().addTagsBatch(specs);
    level.forEach((c, i) => {
      catTagId.set(c.id, res[tagKeyOf(specs[i].parentId, c.name)] || '');
    });
  }

  // 年份标签
  const yearNames = new Set<string>();
  for (const e of entries) {
    const y = e.date ? dayjs(e.date).format('YYYY') : '';
    if (y) yearNames.add(y);
  }
  const yearRes = useMoeyoTagsStore
    .getState()
    .addTagsBatch(
      [...yearNames].map((name) => ({ name, parentId: yearRootId })),
    );

  // 逐条算标签，一次性写入文件夹关系
  const relEntries: { relPath: string; tagIds: string[] }[] = [];
  let tagged = 0;
  for (const e of entries) {
    const relPath = moeyoRelDir(e.title, e.date);
    const tagIds: string[] = [];
    const resolved = new Set<number>();
    for (const cid of e.categoryIds) resolved.add(alias.get(cid) ?? cid);
    const resolvedArr = [...resolved];
    const nameOf = (id: number) => cats.get(id)?.name || '';
    const eventIds = resolvedArr.filter((id) => nameOf(id) === 'イベント');
    const reviewIds = resolvedArr.filter((id) =>
      REVIEW_CATEGORY_NAMES.includes(nameOf(id)),
    );
    // 优先级：イベント > レビュー > 其它（只挂命中的最高优先分类，避免一篇文章到处出现）
    const picked = eventIds.length
      ? eventIds
      : reviewIds.length
        ? reviewIds
        : resolvedArr;
    for (const rid of picked) {
      const id = catTagId.get(rid);
      if (id) tagIds.push(id);
    }
    const y = e.date ? dayjs(e.date).format('YYYY') : '';
    if (y && yearRootId) {
      const id = yearRes[tagKeyOf(yearRootId, y)];
      if (id) tagIds.push(id);
    }
    if (tagIds.length) {
      relEntries.push({ relPath, tagIds });
      tagged += 1;
    }
  }
  // 标签关系「只增不减」会让旧规则残留 → 先清空所有标签的 paths 再重建
  {
    const store = useMoeyoTagsStore.getState();
    const cleared = store.tags.map((t) =>
      t.paths.length ? { ...t, paths: [] } : t,
    );
    useMoeyoTagsStore.setState({ tags: cleared });
  }
  useMoeyoTagsStore.getState().applyFolderTags(relEntries);

  // 清理「分类」子树与「厂商」根下已过期的旧标签
  {
    const store = useMoeyoTagsStore.getState();
    const removeDescendantsNotIn = (
      parentId: string,
      validIds: Set<string>,
    ) => {
      const byParent = new Map<string, string[]>();
      for (const t of store.tags) {
        const pid = t.parentId ?? null;
        if (!pid) continue;
        const arr = byParent.get(pid);
        if (arr) arr.push(t.id);
        else byParent.set(pid, [t.id]);
      }
      const stack = [...(byParent.get(parentId) || [])];
      const desc = new Set<string>();
      while (stack.length) {
        const id = stack.pop()!;
        if (desc.has(id)) continue;
        desc.add(id);
        for (const child of byParent.get(id) || []) stack.push(child);
      }
      for (const id of desc) if (!validIds.has(id)) store.removeTag(id);
    };
    if (rootId) removeDescendantsNotIn(rootId, new Set(catTagId.values()));
    // 清掉历史遗留的「厂商」根及其全部子标签
    const mfrRoot = store.tags.find(
      (t) => (t.parentId ?? null) === null && t.name === MANUFACTURER_ROOT,
    );
    if (mfrRoot) {
      removeDescendantsNotIn(mfrRoot.id, new Set());
      useMoeyoTagsStore.getState().removeTag(mfrRoot.id);
    }
  }
  return tagged;
}

/** 已同步过标签的站点缓存时间戳（避免每次进入 moeyo 都遍历 3 万篇重建标签） */
let lastTagSyncFetchedAt = 0;

/** 仅在站点缓存变化时才重建标签树 */
async function ensureTagsSynced(
  posts: MoeyoPost[],
  cats: Map<number, MoeyoCategory>,
  metaRecords: MoeyoMeta[],
  alias: Map<number, number>,
  fetchedAt: number | undefined,
): Promise<void> {
  if (fetchedAt && fetchedAt === lastTagSyncFetchedAt) return;
  await syncSiteTags(posts, cats, metaRecords, alias);
  if (fetchedAt) lastTagSyncFetchedAt = fetchedAt;
}

/**
 * 拉取站点数据并重建标签树（分类 + 厂商 + 年份 + 文章级标签）：
 * 覆盖**站点全部文章**（含未下载）。建库/追新结束后或手动都可调用。
 */
export async function syncLocalTags(): Promise<number> {
  const base = useSettingsStore.getState().download.saveDirBase;
  if (!base) return 0;

  // 兼容旧数据：根「分类」→「moeyo」
  const tagsNow = useMoeyoTagsStore.getState().tags;
  const legacy = tagsNow.find(
    (t) => (t.parentId ?? null) === null && t.name === LEGACY_CATEGORY_ROOT,
  );
  const hasNewRoot = tagsNow.some(
    (t) => (t.parentId ?? null) === null && t.name === MOEYO_TAG_ROOT,
  );
  if (legacy && !hasNewRoot) {
    try {
      useMoeyoTagsStore.getState().renameTag(legacy.id, MOEYO_TAG_ROOT);
    } catch {
      // ignore
    }
  }

  const [sitePosts, metaRecords, catRes] = await Promise.all([
    fetchAllPosts().catch(() => [] as MoeyoPost[]),
    readMetaRecords(),
    fetchCategories().catch(() => ({
      cats: new Map<number, MoeyoCategory>(),
      alias: new Map<number, number>(),
    })),
  ]);
  const { cats, alias } = catRes;
  const tagged = await syncSiteTags(sitePosts, cats, metaRecords, alias);
  log().info('syncLocalTags', { entries: sitePosts.length, tagged });
  return tagged;
}

async function processPost(
  post: MoeyoPost,
  categories: Map<number, MoeyoCategory>,
  existingIds: Set<string>,
  /** 是否为订阅后追新的新文章（true：计统计；false：建库补档不计） */
  isFeed: boolean,
): Promise<number> {
  const images = await fetchPostImages(post.id);

  if (!existingIds.has(post.id)) {
    const cats = post.categoryIds
      .map((id) => categories.get(id))
      .filter((c): c is MoeyoCategory => !!c);
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

  if (images.length === 0) return 0;

  const platformPost: PlatformPost = {
    id: post.id,
    creator: {
      id: MOEYO_SOURCE,
      name: MOEYO_AUTHOR,
      username: MOEYO_AUTHOR,
    },
    publishedAt: dayjs(post.date),
    text: truncateTitle(post.title),
    medias: images,
    links: [],
    postUrl: post.link,
    source: MOEYO_SOURCE,
  };

  await useDownloadStore.getState().batchCreateDownloadTask(
    images.map((media) => ({
      source: MOEYO_SOURCE,
      post: platformPost,
      media,
      subscriptionId: isFeed ? MOEYO_FEED_ID : undefined,
    })),
  );
  return images.length;
}

/** 建库范围：年份（含起止）；不填=不限 */
export interface MoeyoYearRange {
  fromYear?: number;
  toYear?: number;
}
export async function runMoeyoBuild(
  categoryIds: number[],
  yearRange: MoeyoYearRange,
  onProgress: (p: MoeyoProgress) => void,
  signal: AbortSignal,
): Promise<{ posts: number; images: number }> {
  const { cats: categories } = await fetchCategories();
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
export async function runMoeyoCheck(
  baselineISO: string | null,
  categoryIds: number[],
  onProgress: (p: MoeyoProgress) => void,
  signal: AbortSignal,
): Promise<{ newestDate?: string; posts: number; images: number }> {
  const { cats: categories } = await fetchCategories();
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

export interface MoeyoListItem {
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
  /** 已确认的 hpoi 词条关联快照 */
  hpoi?: HpoiMatch;
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
 * 本地文章列表：读 moeyo.jsonl 元数据（不扫整盘），按需取本地文件夹封面；按发布时间倒序。
 */
export async function listLocalPosts(
  onEach?: (item: MoeyoListItem) => void,
): Promise<MoeyoListItem[]> {
  const base = useSettingsStore.getState().download.saveDirBase || '';
  const baseDir = base.replace(/[\\/]+$/, '');
  const records = await readMetaRecords();
  records.sort((a, b) => (a.date < b.date ? 1 : -1));
  return await mapLimit(records, 8, async (r) => {
    const folderName = `${r.date.slice(0, 10)} ${unicodeFilenamify(
      truncateTitle(r.title),
    )}`;
    const folderPath = `${baseDir}\\moeyo\\${folderName}`;
    const exists = await fs.exists(folderPath);
    const localInfo = exists
      ? await folderImageInfoCached(folderPath)
      : undefined;
    const item: MoeyoListItem = {
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
      hpoi: resolveHpoi(r, r.postId),
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
  // moeyo：保留原格式（含正文内联图与超链接），只清掉脚本/样式/注释
  const contentHtml = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  return {
    title: body?.title?.rendered || '',
    contentHtml,
    link: body?.link || '',
  };
}

interface MoeyoSiteCache {
  version: 1;
  fetchedAt: number;
  posts: MoeyoPost[];
  categories: MoeyoCategory[];
  /** 任意分类 id → 最近保留分类 id（精简后归并） */
  categoryAlias: Record<string, number>;
  /** 特色图媒体 id → 原图 URL */
  featured: Record<string, string>;
  /** 文章 id → 封面 URL（缺特色图时取正文首图；空串表示已查过但无图） */
  postCovers: Record<string, string>;
  /** 文章 id → 厂商（从正文「発売元」提；仅目标分类文章） */
  makers: Record<string, string>;
}

async function siteCachePath(): Promise<string> {
  return await path.join(await path.appDataDir(), 'moeyo-site.json');
}

/**
 * 把内置种子并进本地缓存：**以种子为准**（保证 id 为字符串等格式正确），
 * 本地只补种子没有的（如新近新增的文章）。合并后 fetchedAt 取较大值，保证只做一次。
 */
function mergeSeed(obj: MoeyoSiteCache): MoeyoSiteCache {
  const seed = MOEYO_SITE_SEED;
  const byId = new Map<string, MoeyoPost>(
    (seed.posts || []).map((p) => [String(p.id), p]),
  );
  for (const p of obj.posts || []) {
    const k = String(p.id);
    if (!byId.has(k)) byId.set(k, p);
  }
  return {
    version: 1,
    fetchedAt: Math.max(obj.fetchedAt || 0, seed.fetchedAt || 0),
    posts: [...byId.values()],
    categories: obj.categories?.length ? obj.categories : seed.categories || [],
    categoryAlias: Object.keys(obj.categoryAlias || {}).length
      ? obj.categoryAlias
      : seed.categoryAlias || {},
    featured: { ...(seed.featured || {}), ...(obj.featured || {}) },
    postCovers: { ...(seed.postCovers || {}), ...(obj.postCovers || {}) },
    makers: { ...(seed.makers || {}), ...(obj.makers || {}) },
  };
}

async function readSiteCache(): Promise<MoeyoSiteCache | null> {
  try {
    const file = await siteCachePath();
    if (await fs.exists(file)) {
      const obj = JSON.parse(await fs.readTextFile(file)) as MoeyoSiteCache;
      if (obj?.posts) {
        // 本地比种子少、或比种子旧（含之前数字 id 的坏格式）→ 合并一次
        if (
          MOEYO_SITE_SEED?.posts?.length &&
          (obj.posts.length < MOEYO_SITE_SEED.posts.length ||
            (obj.fetchedAt || 0) < (MOEYO_SITE_SEED.fetchedAt || 0))
        ) {
          const merged = mergeSeed(obj);
          await writeSiteCache(merged);
          return merged;
        }
        return obj;
      }
    }
    // 本地无缓存 → 用内置站点种子初始化（新装秒开、离线可用；随后照常增量刷新）
    if (MOEYO_SITE_SEED?.posts?.length) {
      await writeSiteCache(MOEYO_SITE_SEED);
      return MOEYO_SITE_SEED;
    }
    return null;
  } catch (err) {
    log().warn('读取站点缓存失败', err);
    return null;
  }
}

async function writeSiteCache(cache: MoeyoSiteCache): Promise<void> {
  try {
    await fs.writeTextFile(await siteCachePath(), JSON.stringify(cache));
  } catch (err) {
    log().warn('写入站点缓存失败', err);
  }
}

export interface MoeyoNote {
  postId: string;
  date: string;
  title: string;
  link: string;
  coverUrl?: string;
  /** 归并到保留分类后的分类名（去重） */
  categories: string[];
}

/**
 * 近 N 天的站点文章（时间流「新记事」用；含未下载）。
 * allowedCategoryIds：进时间流的分类白名单（空/不传 = 全部）；
 * 每篇按其分类经 alias 归并到保留分类后判断是否命中。
 */
export async function getRecentSiteNotes(
  days = 7,
  allowedCategoryIds?: number[],
): Promise<MoeyoNote[]> {
  const cache = await readSiteCache();
  if (!cache) return [];
  // 未设置（undefined）= 全部进时间流；设置为数组时严格按白名单（空数组=都不进）
  const allowed = Array.isArray(allowedCategoryIds)
    ? new Set(allowedCategoryIds)
    : null;
  const alias = new Map<number, number>(
    Object.entries(cache.categoryAlias || {}).map(([k, v]) => [
      Number(k),
      Number(v),
    ]),
  );
  const catName = new Map<number, string>(
    cache.categories.map((c) => [c.id, c.name]),
  );
  const start = Date.now() - days * 24 * 60 * 60 * 1000;
  const out: MoeyoNote[] = [];
  for (const p of cache.posts) {
    const t = new Date(p.date).getTime();
    if (Number.isNaN(t) || t < start) continue;
    const resolved = new Set<number>();
    for (const cid of p.categoryIds) resolved.add(alias.get(cid) ?? cid);
    if (allowed) {
      let hit = false;
      for (const id of resolved) {
        if (allowed.has(id)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
    }
    const categories: string[] = [];
    for (const id of resolved) {
      const name = catName.get(id);
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

/** 站点缓存里 文章 id → 归并后的分类名（时间流给已下载条目补分类用） */
export async function getSiteCategoryMap(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const cache = await readSiteCache();
  if (!cache) return map;
  const catName = new Map<number, string>(
    cache.categories.map((c) => [c.id, c.name]),
  );
  const alias = new Map<number, number>(
    Object.entries(cache.categoryAlias || {}).map(([k, v]) => [
      Number(k),
      Number(v),
    ]),
  );
  for (const p of cache.posts) {
    const resolved = new Set<number>();
    for (const cid of p.categoryIds) resolved.add(alias.get(cid) ?? cid);
    const names: string[] = [];
    for (const id of resolved) {
      const name = catName.get(id);
      if (name && !names.includes(name)) names.push(name);
    }
    if (names.length) map.set(p.id, names);
  }
  return map;
}

/** 一次性枚举已下载的 moeyo 文件夹名（避免逐篇 fs.exists） */
async function listDownloadedFolderNames(
  baseDir: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const entries = await fs.readDir(`${baseDir}\\${MOEYO_AUTHOR}`, {
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
  posts: MoeyoPost[],
  cats: Map<number, MoeyoCategory>,
  metaById: Map<string, MoeyoMeta>,
  dirSet: Set<string>,
  featured: Map<number, string>,
  postCovers: Map<string, string>,
  baseDir: string,
): Promise<MoeyoListItem[]> {
  const sorted = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));
  return await mapLimit(sorted, 16, async (p) => {
    const folderName = `${p.date.slice(0, 10)} ${unicodeFilenamify(
      truncateTitle(p.title),
    )}`;
    const folderPath = `${baseDir}\\moeyo\\${folderName}`;
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
        .filter((c): c is MoeyoCategory => !!c)
        .map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      imageCount: exists ? localInfo?.count || 0 : meta?.imageCount || 0,
      folderName,
      folderPath,
      exists,
      coverPath,
      coverUrl,
      hpoi: resolveHpoi(meta, p.id),
    };
  });
}

function filterByCategories(
  posts: MoeyoPost[],
  categoryIds?: number[],
): MoeyoPost[] {
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
): Promise<MoeyoListItem[] | null> {
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
  const alias = new Map<number, number>(
    Object.entries(cache.categoryAlias || {}).map(([k, v]) => [
      Number(k),
      Number(v),
    ]),
  );
  await ensureTagsSynced(
    cache.posts,
    cats,
    metaRecords,
    alias,
    cache.fetchedAt,
  );
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
async function fetchNewPosts(existingIds: Set<string>): Promise<MoeyoPost[]> {
  const out: MoeyoPost[] = [];
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
): Promise<MoeyoListItem[]> {
  const base = useSettingsStore.getState().download.saveDirBase || '';
  const baseDir = base.replace(/[\\/]+$/, '');
  const cache = await readSiteCache();
  const metaRecords = await readMetaRecords();
  const { cats, alias } = await fetchCategories();

  let allPosts: MoeyoPost[];
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

  // 正文解析：无封面的文章取正文首图（厂商标签已移除，不再为提厂商而批量抓正文）
  const missingCoverIds = allPosts
    .filter((p) => {
      const fm = p.featuredMedia || 0;
      if (fm && featured.has(fm)) return false;
      return postCovers.get(String(p.id)) === undefined;
    })
    .map((p) => String(p.id));
  if (missingCoverIds.length) {
    const resolved = await resolvePostContents(missingCoverIds);
    for (const [k, v] of resolved.covers) postCovers.set(k, v);
  }

  const featuredObj: Record<string, string> = {};
  for (const [k, v] of featured) featuredObj[String(k)] = v;
  const postCoversObj: Record<string, string> = {};
  for (const [k, v] of postCovers) postCoversObj[k] = v;
  const fetchedAt = Date.now();
  await writeSiteCache({
    version: 1,
    fetchedAt,
    posts: allPosts,
    categories: [...cats.values()],
    categoryAlias: Object.fromEntries(alias),
    featured: featuredObj,
    postCovers: postCoversObj,
    makers: {},
  });

  await ensureTagsSynced(allPosts, cats, metaRecords, alias, fetchedAt);
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

/** 从正文 HTML 取第一张图 URL（作列表封面；用列表轻量缩略图即可） */
function firstImageUrlFromHtml(html: string): string {
  const m = /<img\b[^>]*?(?:data-src|src)=["']([^"']+)["']/i.exec(html);
  let url = m?.[1] || '';
  if (url.startsWith('//')) url = `https:${url}`;
  if (!/^https?:/i.test(url)) return '';
  return url;
}

/** 批量拉正文解析「封面首图」（每 100 篇一批） */
async function resolvePostContents(
  postIds: string[],
): Promise<{ covers: Map<string, string> }> {
  const covers = new Map<string, string>();
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
        covers.set(String(p.id), firstImageUrlFromHtml(html));
      }
    } catch (err) {
      log().warn('正文解析失败', err);
    }
  }
  return { covers };
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
export async function saveMoeyoMedia(
  item: MoeyoListItem,
  media: PlatformMedia,
): Promise<void> {
  const platformPost: PlatformPost = {
    id: item.postId,
    creator: {
      id: MOEYO_SOURCE,
      name: MOEYO_AUTHOR,
      username: MOEYO_AUTHOR,
    },
    publishedAt: dayjs(item.date),
    text: truncateTitle(item.title),
    medias: [media],
    links: [],
    postUrl: item.link,
    source: MOEYO_SOURCE,
  };
  await useDownloadStore
    .getState()
    .batchCreateDownloadTask([
      { source: MOEYO_SOURCE, post: platformPost, media },
    ]);
}

/** 保存单篇文章到本地（手动保存：不计统计、不打标；调用方随后可 syncLocalTags） */
export async function saveMoeyoPost(item: MoeyoListItem): Promise<number> {
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
      id: MOEYO_SOURCE,
      name: MOEYO_AUTHOR,
      username: MOEYO_AUTHOR,
    },
    publishedAt: dayjs(item.date),
    text: truncateTitle(item.title),
    medias: images,
    links: [],
    postUrl: item.link,
    source: MOEYO_SOURCE,
  };
  await useDownloadStore.getState().batchCreateDownloadTask(
    images.map((media) => ({
      source: MOEYO_SOURCE,
      post: platformPost,
      media,
    })),
  );
  return images.length;
}
