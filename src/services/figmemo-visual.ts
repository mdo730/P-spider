import { fs, path } from '@tauri-apps/api';
import { useAppStateStore } from '../stores/app-state';
import { useSettingsStore } from '../stores/settings';
import { FigmemoListItem, fetchPostImages } from './figmemo';
import {
  builtinTag,
  classifyVisionTags,
  modelReady,
  VisionTagItem,
  visionStart,
  visionStop,
  visionTag,
} from './wd14';

/**
 * fig-memo 视觉标签：给文章取图 → WD14 打标 → 受控词表归类 → 存索引。
 * （自用功能；索引文件 figmemo-visual-tags.jsonl）
 */

export const VISUAL_MAP_VERSION = 1;
const ENGINE = 'wd14-moat-v2';

export interface VisualRecord {
  postId: string;
  /** 自动识别结果（WD14） */
  items: VisionTagItem[];
  unknown: string[];
  /** 实际使用图片数 */
  images: number;
  /** 当时使用的取图数上限（1/5/60），用于设置调大后自动重跑 */
  k: number;
  engine: string;
  mapVersion: number;
  updatedAt: number;
  /** 打标失败的图片（便于排查） */
  errors?: string[];
  /** 手动补充的标签（重扫不覆盖） */
  added?: VisionTagItem[];
  /** 手动删除的标签 key（cat|zh；重扫不覆盖） */
  removed?: string[];
}

function tagKey(it: { cat: string; zh: string }): string {
  return `${it.cat}|${it.zh}`;
}

/** 有效视觉标签 = (auto − removed) ∪ added */
export function effectiveItems(rec: VisualRecord): VisionTagItem[] {
  const removed = new Set(rec.removed || []);
  const map = new Map<string, VisionTagItem>();
  for (const it of rec.items) {
    const key = tagKey(it);
    if (removed.has(key)) continue;
    map.set(key, it);
  }
  for (const it of rec.added || []) {
    map.set(tagKey(it), it);
  }
  return [...map.values()];
}

/**
 * 是否已成功识别：
 * - 无图（images=0）→ 完成；
 * - 有图但零标签 → 失败，重试；
 * - 已识别的取图数 k 需 ≥ 当前设置（设置调大则重跑）。
 */
function isDone(rec: VisualRecord | undefined, k: number): boolean {
  if (!rec) return false;
  if (rec.images === 0) return true;
  if (rec.items.length + rec.unknown.length === 0) return false;
  return (rec.k || 0) >= k;
}

let log: ICategoriedLogger;
function logger() {
  if (!log) log = window.log.category('VIS');
  return log;
}

async function visualTagsPath(): Promise<string> {
  return await path.join(await path.appDataDir(), 'figmemo-visual-tags.jsonl');
}

/** 读取索引（postId → 记录，后写覆盖前写） */
export async function readVisualTags(): Promise<Map<string, VisualRecord>> {
  const map = new Map<string, VisualRecord>();
  try {
    const file = await visualTagsPath();
    if (!(await fs.exists(file))) return map;
    const text = await fs.readTextFile(file);
    for (const line of text.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const rec = JSON.parse(s) as VisualRecord;
        if (rec?.postId) map.set(rec.postId, rec);
      } catch {
        // 跳过坏行
      }
    }
  } catch (err) {
    logger().warn('读取视觉标签索引失败', err);
  }
  return map;
}

async function appendVisualRecord(rec: VisualRecord): Promise<void> {
  const file = await visualTagsPath();
  await fs.writeTextFile(file, JSON.stringify(rec) + '\n', { append: true });
}

// ---------- 取图 ----------

const IMAGE_EXT = /\.(jpe?g|png|webp|bmp|gif)$/i;

function proxyAndAppState() {
  const settings = useSettingsStore.getState();
  const enable = settings.proxy.enable;
  const proxyUrl = !enable
    ? ''
    : settings.proxy.useSystem
      ? useAppStateStore.getState().systemProxyUrl
      : settings.proxy.url;
  return { enable, proxyUrl };
}

function imagesPerPost(): number {
  const v = useSettingsStore.getState().vision?.imagesPerPost || '5';
  if (v === 'all') return 60;
  return Number(v) || 5;
}

/** 取该文章用于打标的本地图片路径（本地已下载优先，否则下载远程图到缓存） */
async function resolveImagePaths(
  item: FigmemoListItem,
  k: number,
): Promise<string[]> {
  // 1. 本地已下载 → 直接扫目录
  if (item.exists && item.folderPath) {
    try {
      const entries = await fs.readDir(item.folderPath, { recursive: false });
      const paths = entries
        .filter((e) => IMAGE_EXT.test(e.name || e.path))
        .map((e) => e.path)
        .slice(0, k);
      if (paths.length > 0) return paths;
    } catch {
      // 落到远程
    }
  }
  // 2. 远程：拉文章图片 URL → 下载到缓存
  const medias = await fetchPostImages(item.postId);
  const urls = medias
    .map((m) => m.downloadUrl || m.url || '')
    .filter(Boolean)
    .slice(0, k);
  if (urls.length === 0) return [];
  const cacheDir = await path.join(
    await path.appCacheDir(),
    'wd14',
    item.postId,
  );
  const { proxyUrl } = proxyAndAppState();
  const paths = await invokeDownload(urls, cacheDir, proxyUrl);
  return paths;
}

async function invokeDownload(
  urls: string[],
  outDir: string,
  proxyUrl: string,
): Promise<string[]> {
  const { invoke } = await import('@tauri-apps/api');
  return invoke<string[]>('wd14_download', {
    urls,
    outDir,
    proxyUrl,
    referer: 'https://fig-memo-r18.site/',
  });
}

// ---------- 跑批 ----------

let stopRequested = false;
export function requestVisionStop(): void {
  stopRequested = true;
}

export interface VisionProgress {
  done: number;
  total: number;
  currentTitle: string;
  /** 当前是第几篇（1-based） */
  index: number;
}

/**
 * 对一批文章跑视觉识别，逐篇写索引。
 * 返回处理的篇数。
 */
export async function runVisionForItems(
  items: FigmemoListItem[],
  onProgress: (p: VisionProgress) => void,
  existing?: Map<string, VisualRecord>,
): Promise<number> {
  const seen = existing || (await readVisualTags());
  stopRequested = false;
  const k = imagesPerPost();
  const todo = items.filter((it) => !isDone(seen.get(it.postId), k));
  const total = todo.length;
  if (total === 0) return 0;

  const vision = useSettingsStore.getState().vision || {};
  const useBuiltin = (vision.engine || 'builtin') === 'builtin';
  const modelId = vision.model || 'wd-v1-4-moat-tagger-v2';
  if (useBuiltin) {
    if (!(await modelReady(modelId))) {
      throw new Error(
        'WD14 模型未下载，请到「设置 → 工具与数据 → 视觉识别」下载',
      );
    }
  } else {
    await visionStart();
  }

  let done = 0;
  try {
    for (let i = 0; i < todo.length; i++) {
      if (stopRequested) break;
      const item = todo[i];
      const prev = seen.get(item.postId);
      onProgress({
        done,
        total,
        index: i + 1,
        currentTitle: item.title,
      });
      try {
        const paths = await resolveImagePaths(item, k);
        if (paths.length === 0) {
          // 无图也记一条空记录，避免重复尝试
          await appendVisualRecord(
            makeRecord(
              item.postId,
              [],
              [],
              0,
              k,
              undefined,
              prev?.added,
              prev?.removed,
            ),
          );
          done++;
          continue;
        }
        const results = useBuiltin
          ? await builtinTag(modelId, paths)
          : await visionTag(paths);
        const raw = new Set<string>();
        const errors: string[] = [];
        for (const r of results) {
          if (r.error) {
            const name = r.path.split(/[\\/]/).pop() || r.path;
            errors.push(`${name}: ${r.error}`);
            logger().warn('WD14 打标失败', { path: r.path, error: r.error });
          }
          for (const t of r.tags || []) raw.add(t);
        }
        if (raw.size === 0 && errors.length > 0) {
          logger().error('WD14 全部图片打标失败', {
            postId: item.postId,
            first: errors[0],
          });
        }
        const classified = classifyVisionTags([...raw]);
        await appendVisualRecord(
          makeRecord(
            item.postId,
            classified.items,
            classified.unknown,
            paths.length,
            k,
            errors,
            prev?.added,
            prev?.removed,
          ),
        );
        done++;
      } catch (err) {
        logger().error('视觉识别失败', { postId: item.postId, err });
        onProgress({ done, total, index: i + 1, currentTitle: item.title });
        throw err;
      }
    }
  } finally {
    if (!useBuiltin) await visionStop();
  }
  return done;
}

function makeRecord(
  postId: string,
  items: VisionTagItem[],
  unknown: string[],
  images: number,
  k: number,
  errors?: string[],
  added?: VisionTagItem[],
  removed?: string[],
): VisualRecord {
  return {
    postId,
    items,
    unknown: [...new Set(unknown)].slice(0, 200),
    images,
    k,
    engine: ENGINE,
    mapVersion: VISUAL_MAP_VERSION,
    updatedAt: Date.now(),
    ...(errors && errors.length ? { errors: errors.slice(0, 10) } : {}),
    ...(added && added.length ? { added } : {}),
    ...(removed && removed.length ? { removed } : {}),
  };
}

/** 更新某篇的手动覆盖（added/removed），保留 auto；重扫不会再碰这些 */
export async function setVisualOverride(
  postId: string,
  added: VisionTagItem[],
  removed: string[],
): Promise<VisualRecord> {
  const map = await readVisualTags();
  const prev = map.get(postId);
  const rec = makeRecord(
    postId,
    prev?.items || [],
    prev?.unknown || [],
    prev?.images || 0,
    prev?.k || 0,
    prev?.errors,
    added,
    removed,
  );
  await appendVisualRecord(rec);
  return rec;
}
