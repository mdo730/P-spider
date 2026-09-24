import { fs, path } from '@tauri-apps/api';
import dayjs from 'dayjs';
import MediaType from '../enums/MediaType';
import { request } from '../ipc/network';
import { PlatformMedia, PlatformPost } from '../platforms';
import { useDownloadStore } from '../stores/download';
import { useLibraryStore } from '../stores/library';
import { useSettingsStore } from '../stores/settings';
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
/** 旧版分类根标签名（迁移用） */
const LEGACY_CATEGORY_ROOT = '分类';

export interface FigmemoPost {
  id: string;
  date: string;
  link: string;
  title: string;
  categoryIds: number[];
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
      _fields: 'id,date,link,title,categories',
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

/** 取/建根标签，返回其 id */
function ensureRootTag(name: string): string {
  const find = () =>
    useLibraryStore
      .getState()
      .tags.find((t) => (t.parentId ?? null) === null && t.name === name);
  let root = find();
  if (!root) {
    try {
      useLibraryStore.getState().addTag(name, null);
    } catch {
      // ignore
    }
    root = find();
  }
  return root?.id || '';
}

/** 取/建某根标签下的子标签，返回其 id */
function ensureChildTag(rootId: string, name: string): string {
  if (!rootId) return '';
  const find = () =>
    useLibraryStore
      .getState()
      .tags.find((t) => (t.parentId ?? null) === rootId && t.name === name);
  let child = find();
  if (!child) {
    try {
      useLibraryStore.getState().addTag(name, rootId);
    } catch {
      // ignore
    }
    child = find();
  }
  return child?.id || '';
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
 * 按**本地文件夹**同步标签（分类 + 厂商）：
 * 只给「本地确实存在文件夹」的帖子打标（基于 figmemo.jsonl 元数据 + 磁盘存在性判断），
 * 未下载到的帖子不打标。建库/追新结束后或手动都可调用，返回打标的文件夹数。
 */
export async function syncLocalTags(): Promise<number> {
  const base = useSettingsStore.getState().download.saveDirBase;
  if (!base) return 0;

  // 兼容旧数据：根「分类」→「fig-memo」
  const tagsNow = useLibraryStore.getState().tags;
  const legacy = tagsNow.find(
    (t) => (t.parentId ?? null) === null && t.name === LEGACY_CATEGORY_ROOT,
  );
  const hasNewRoot = tagsNow.some(
    (t) => (t.parentId ?? null) === null && t.name === FIGMEMO_TAG_ROOT,
  );
  if (legacy && !hasNewRoot) {
    try {
      useLibraryStore.getState().renameTag(legacy.id, FIGMEMO_TAG_ROOT);
    } catch {
      // ignore
    }
  }

  const records = await readMetaRecords();
  const rootId = ensureRootTag(FIGMEMO_TAG_ROOT);
  const mfrRootId = ensureRootTag(MANUFACTURER_ROOT);

  const catTagMap = new Map<number, string>();
  const seenCat = new Set<number>();
  for (const r of records) {
    for (const c of r.categories || []) {
      if (seenCat.has(c.id)) continue;
      seenCat.add(c.id);
      const tagId = ensureChildTag(rootId, c.name);
      if (tagId) catTagMap.set(c.id, tagId);
    }
  }

  const baseDir = base.replace(/[\\/]+$/, '');
  let tagged = 0;
  for (const r of records) {
    const relPath = figmemoRelDir(r.title, r.date);
    const abs = `${baseDir}\\${relPath.replace(/\//g, '\\')}`;
    // 本地没有该文件夹 → 不建标签
    if (!(await fs.exists(abs))) continue;
    const tagIds = (r.categories || [])
      .map((c) => catTagMap.get(c.id))
      .filter((x): x is string => !!x);
    const mfr = guessManufacturer(r.title);
    if (mfr) {
      const mfrTagId = ensureChildTag(mfrRootId, mfr);
      if (mfrTagId) tagIds.push(mfrTagId);
    }
    if (tagIds.length) {
      useLibraryStore.getState().addFolderTags([relPath], tagIds);
      tagged += 1;
    }
  }
  log().info('syncLocalTags', { records: records.length, tagged });
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

/** 建库：下载现存文章（categoryIds 非空时只下这些分类；yearRange 限定年份） */
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
