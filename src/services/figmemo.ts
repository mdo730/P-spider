import { fs, path } from '@tauri-apps/api';
import dayjs from 'dayjs';
import MediaType from '../enums/MediaType';
import { request } from '../ipc/network';
import { PlatformMedia, PlatformPost } from '../platforms';
import { useDownloadStore } from '../stores/download';
import { useLibraryStore } from '../stores/library';
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
/** 站点分类自动落成标签时的根标签名 */
const CATEGORY_ROOT = '分类';

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

/** 帖子相对 saveDirBase 的目录（与下载管线 prepareArchiverPostDir 一致） */
export function figmemoRelDir(title: string): string {
  return `${FIGMEMO_AUTHOR}/${unicodeFilenamify(truncateTitle(title))}`;
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
    _fields: 'id,name,slug',
  });
  const map = new Map<number, FigmemoCategory>();
  for (const c of (body || []) as any[]) {
    map.set(c.id, { id: c.id, name: c.name, slug: c.slug });
  }
  return map;
}

async function fetchPostsPage(page: number): Promise<FigmemoPost[]> {
  let body: any;
  try {
    body = await getJson(`${API}/posts`, {
      per_page: String(PER_PAGE),
      page: String(page),
      orderby: 'date',
      order: 'desc',
      _fields: 'id,date,link,title,categories',
    });
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

/** 全部帖子（建库用） */
export async function fetchAllPosts(): Promise<FigmemoPost[]> {
  const out: FigmemoPost[] = [];
  for (let page = 1; page <= 1000; page += 1) {
    const posts = await fetchPostsPage(page);
    out.push(...posts);
    if (posts.length < PER_PAGE) break;
  }
  return out;
}

/** 基线之后的新帖（追新用，最新在前） */
export async function fetchPostsNewerThan(
  baselineISO: string | null,
): Promise<FigmemoPost[]> {
  const out: FigmemoPost[] = [];
  const base = baselineISO ? dayjs(baselineISO) : null;
  for (let page = 1; page <= 50; page += 1) {
    const posts = await fetchPostsPage(page);
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

/** 某帖的图片原图（WP 媒体附件，天然不含正文里的重复引用） */
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

/** 确保根标签「分类」及分类子标签存在，返回 分类id → 标签id */
async function ensureCategoryTagMap(
  categories: Map<number, FigmemoCategory>,
): Promise<Map<number, string>> {
  const store = useLibraryStore.getState();
  const root = store.tags.find(
    (t) => (t.parentId ?? null) === null && t.name === CATEGORY_ROOT,
  );
  const rootId = root ? root.id : store.addTag(CATEGORY_ROOT, null);

  const map = new Map<number, string>();
  for (const [id, cat] of categories) {
    const find = () =>
      useLibraryStore
        .getState()
        .tags.find(
          (t) => (t.parentId ?? null) === rootId && t.name === cat.name,
        );
    let child = find();
    if (!child) {
      try {
        useLibraryStore.getState().addTag(cat.name, rootId);
      } catch {
        // 同名已存在，忽略
      }
      child = find();
    }
    if (child) map.set(id, child.id);
  }
  return map;
}

async function processPost(
  post: FigmemoPost,
  categories: Map<number, FigmemoCategory>,
  catTagMap: Map<number, string>,
  existingIds: Set<string>,
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

    // 站点分类自动落成标签，挂到帖子文件夹
    const relPath = figmemoRelDir(post.title);
    const tagIds = post.categoryIds
      .map((id) => catTagMap.get(id))
      .filter((x): x is string => !!x);
    if (tagIds.length) {
      useLibraryStore.getState().addFolderTags([relPath], tagIds);
    }
  }

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
    })),
  );
  return images.length;
}

/** 建库：下载现存全部文章 */
export async function runFigmemoBuild(
  onProgress: (p: FigmemoProgress) => void,
  signal: AbortSignal,
): Promise<{ posts: number; images: number }> {
  const categories = await fetchCategories();
  const catTagMap = await ensureCategoryTagMap(categories);
  const existing = await readExistingMetaIds();
  const all = await fetchAllPosts();

  let images = 0;
  let done = 0;
  onProgress({ phase: 'building', total: all.length, done: 0 });
  for (const post of all) {
    if (signal.aborted) break;
    try {
      images += await processPost(post, categories, catTagMap, existing);
    } catch (err) {
      log().warn('处理帖子失败', post.id, err);
    }
    done += 1;
    onProgress({ phase: 'building', total: all.length, done });
  }
  return { posts: all.length, images };
}

/** 追新：下载基线之后的新文章 */
export async function runFigmemoCheck(
  baselineISO: string | null,
  onProgress: (p: FigmemoProgress) => void,
  signal: AbortSignal,
): Promise<{ newestDate?: string; posts: number; images: number }> {
  const categories = await fetchCategories();
  const catTagMap = await ensureCategoryTagMap(categories);
  const existing = await readExistingMetaIds();
  const posts = await fetchPostsNewerThan(baselineISO);

  let images = 0;
  let done = 0;
  onProgress({ phase: 'checking', total: posts.length, done: 0 });
  for (const post of posts) {
    if (signal.aborted) break;
    try {
      images += await processPost(post, categories, catTagMap, existing);
    } catch (err) {
      log().warn('处理帖子失败', post.id, err);
    }
    done += 1;
    onProgress({ phase: 'checking', total: posts.length, done });
  }
  return { newestDate: posts[0]?.date, posts: posts.length, images };
}
