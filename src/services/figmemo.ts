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

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('FIG');
  return _log;
}

const SITE = 'https://fig-memo-r18.site';
const API = `${SITE}/wp-json/wp/v2`;
const UA = 'Mozilla/5.0';
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
        _fields: 'id,source_url,mime_type',
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
        thumbUrl: url,
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

/**
 * 写入/更新某篇文章的文章级标签（姿势/发型/体型…）。
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
}

/** 读取 figmemo.jsonl 全部元数据记录 */
export async function readMetaRecords(): Promise<FigmemoMeta[]> {
  const out: FigmemoMeta[] = [];
  try {
    const file = await metaFilePath();
    if (!(await fs.exists(file))) return out;
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
  } catch (err) {
    log().warn('读取 figmemo.jsonl 失败', err);
  }
  return out;
}

/** 从标题猜厂商：取第一个「之前的文本（如 `BINDing「…」` → `BINDing`） */
function guessManufacturer(title: string): string {
  const idx = title.indexOf('「');
  const prefix = (idx > 0 ? title.slice(0, idx) : title).trim();
  if (!prefix || prefix.length > 30) return '';
  return prefix;
}

/**
 * 同步 fig-memo 标签（分类 + 厂商 + 年份）：
 * 覆盖**站点全部文章**（含未下载），未下载的也一并进入对应标签。
 * 建库/追新结束后或手动都可调用，返回已打标的文章数。
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

  const namesById = new Map<number, string>();
  for (const c of cats.values()) namesById.set(c.id, c.name);
  for (const r of metaRecords) {
    for (const c of r.categories || []) {
      if (!namesById.has(c.id)) namesById.set(c.id, c.name);
    }
  }

  // 汇总条目：站点全部文章 + 仅本地存在的补漏记录
  interface Entry {
    title: string;
    date: string;
    categoryIds: number[];
  }
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const p of sitePosts) {
    seen.add(String(p.id));
    entries.push({ title: p.title, date: p.date, categoryIds: p.categoryIds });
  }
  for (const r of metaRecords) {
    const id = String(r.postId);
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({
      title: r.title,
      date: r.date,
      categoryIds: (r.categories || []).map((c) => c.id),
    });
  }

  const tagKey = (pid: string | null, name: string) =>
    `${pid ?? ''}\u0000${name}`;

  // 先建三个根标签
  const rootMap = useFigmemoTagsStore.getState().addTagsBatch([
    { name: FIGMEMO_TAG_ROOT, parentId: null },
    { name: MANUFACTURER_ROOT, parentId: null },
    { name: YEAR_ROOT, parentId: null },
  ]);
  const rootId = rootMap[tagKey(null, FIGMEMO_TAG_ROOT)] || '';
  const mfrRootId = rootMap[tagKey(null, MANUFACTURER_ROOT)] || '';
  const yearRootId = rootMap[tagKey(null, YEAR_ROOT)] || '';

  // 收集所有需要的一级子标签
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
        const id = childMap[tagKey(rootId, n)];
        if (id) tagIds.push(id);
      }
    }
    const mfr = guessManufacturer(e.title);
    if (mfr && mfrRootId) {
      const id = childMap[tagKey(mfrRootId, mfr)];
      if (id) tagIds.push(id);
    }
    const y = e.date ? dayjs(e.date).format('YYYY') : '';
    if (y && yearRootId) {
      const id = childMap[tagKey(yearRootId, y)];
      if (id) tagIds.push(id);
    }
    if (tagIds.length) {
      relEntries.push({ relPath, tagIds });
      tagged += 1;
    }
  }
  useFigmemoTagsStore.getState().applyFolderTags(relEntries);
  log().info('syncLocalTags', { entries: entries.length, tagged });
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
}

async function firstImageIn(dir: string): Promise<string | undefined> {
  try {
    const entries = await fs.readDir(dir, { recursive: false });
    for (const entry of entries) {
      const name = entry.name || entry.path.split(/[\\/]/).pop() || '';
      if (isMediaFile(name) && getMediaKind(name) === 'image') {
        return entry.path;
      }
    }
  } catch {
    // 文件夹不存在
  }
  return undefined;
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
    const item: FigmemoListItem = {
      postId: r.postId,
      title: r.title,
      date: r.date,
      link: r.link,
      categories: r.categories || [],
      imageCount: r.imageCount || 0,
      folderName,
      folderPath,
      exists,
      coverPath: exists ? await firstImageIn(folderPath) : undefined,
      articleTags: r.articleTags,
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

/**
 * 站点文章列表（云端，含未下载）+ 本地下载状态/封面合并；按发布时间倒序。
 */
export async function listSitePosts(
  categoryIds?: number[],
): Promise<FigmemoListItem[]> {
  const base = useSettingsStore.getState().download.saveDirBase || '';
  const baseDir = base.replace(/[\\/]+$/, '');
  const [posts, cats, metaRecords] = await Promise.all([
    fetchAllPosts(categoryIds && categoryIds.length ? categoryIds : undefined),
    fetchCategories(),
    readMetaRecords(),
  ]);
  const metaById = new Map(metaRecords.map((r) => [r.postId, r]));
  const featured = await resolveFeaturedUrls(
    posts.map((p) => p.featuredMedia || 0),
  );
  posts.sort((a, b) => (a.date < b.date ? 1 : -1));
  return await mapLimit(posts, 8, async (p) => {
    const folderName = `${p.date.slice(0, 10)} ${unicodeFilenamify(
      truncateTitle(p.title),
    )}`;
    const folderPath = `${baseDir}\\fig-memo\\${folderName}`;
    const exists = await fs.exists(folderPath);
    const meta = metaById.get(p.id);
    const coverUrl = p.featuredMedia
      ? featured.get(p.featuredMedia)
      : undefined;
    return {
      postId: p.id,
      title: p.title,
      date: p.date,
      link: p.link,
      categories: p.categoryIds
        .map((id) => cats.get(id))
        .filter((c): c is FigmemoCategory => !!c)
        .map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      imageCount: meta?.imageCount || 0,
      folderName,
      folderPath,
      exists,
      coverPath: exists ? await firstImageIn(folderPath) : undefined,
      coverUrl,
      articleTags: meta?.articleTags,
    };
  });
}

/** 批量把特色图媒体 id 解析为原图 URL（每 100 个一批） */
async function resolveFeaturedUrls(
  ids: number[],
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const uniq = [...new Set(ids.filter((id) => id > 0))];
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    try {
      const body = await getJson(`${API}/media`, {
        include: chunk.join(','),
        per_page: '100',
        _fields: 'id,source_url',
      });
      for (const m of (body || []) as any[]) {
        if (m?.id && m.source_url) map.set(m.id, m.source_url);
      }
    } catch (err) {
      log().warn('解析特色图失败', err);
    }
  }
  return map;
}

/** 保存单篇文章到本地（手动保存：不计统计、不打标；调用方随后可 syncLocalTags） */
export async function saveFigmemoPost(item: FigmemoListItem): Promise<number> {
  const images = await fetchPostImages(item.postId);
  if (images.length === 0) return 0;
  const existing = await readExistingMetaIds();
  if (!existing.has(item.postId)) {
    await appendMeta({
      postId: item.postId,
      title: item.title,
      date: item.date,
      link: item.link,
      categories: item.categories,
      imageCount: images.length,
    });
  }
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
