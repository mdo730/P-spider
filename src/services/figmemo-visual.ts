import { getErrorMessage } from '../utils/error';
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
import {
  DEFAULT_MODEL,
  IMAGE_EXT,
  isDone,
  makeRecord,
  VISUAL_MAP_VERSION,
  VisualRecord,
  VisionProgress,
} from './vision-core';

export type { VisualRecord, VisionProgress };
export { effectiveItems, VISUAL_MAP_VERSION } from './vision-core';

/**
 * fig-memo 视觉标签：给文章取图 → WD14 打标 → 受控词表归类 → 存索引。
 * （自用功能；索引文件 figmemo-visual-tags.jsonl）
 */

let log: ICategoriedLogger;
function logger() {
  if (!log) log = window.log.category('VIS');
  return log;
}

async function visualTagsPath(): Promise<string> {
  return await path.join(await path.appDataDir(), 'figmemo-visual-tags.jsonl');
}

/** 读取索引（postId → 记录，后写覆盖前写；内置基礎种子兜底，本地记录优先） */
export async function readVisualTags(): Promise<Map<string, VisualRecord>> {
  const map = new Map(await visualSeed());
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

/** 内置基础种子（懒加载）：5 张 + swinv2 v3 的基线，用户可用更好模型/更多张数重跑升级 */
let _seedMap: Map<string, VisualRecord> | null = null;
async function visualSeed(): Promise<Map<string, VisualRecord>> {
  if (_seedMap) return _seedMap;
  const map = new Map<string, VisualRecord>();
  try {
    const j = (await import('../data/figmemo-visual-seed.json'))
      .default as unknown as Record<
      string,
      { items: [string, string][]; k: number; engine: string }
    >;
    for (const [postId, s] of Object.entries(j)) {
      map.set(postId, {
        postId,
        items: s.items.map(([cat, zh]) => ({ cat, zh, raws: [] })),
        unknown: [],
        images: 1,
        k: s.k || 5,
        engine: s.engine || DEFAULT_MODEL,
        mapVersion: VISUAL_MAP_VERSION,
        updatedAt: 0,
      });
    }
  } catch (err) {
    logger().warn('加载视觉标签种子失败', err);
  }
  _seedMap = map;
  return map;
}

async function appendVisualRecord(rec: VisualRecord): Promise<void> {
  const file = await visualTagsPath();
  await fs.writeTextFile(file, JSON.stringify(rec) + '\n', { append: true });
}

// ---------- 取图 ----------

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

/** WD14 临时图缓存根目录（appCacheDir/wd14） */
async function imageCacheRoot(): Promise<string> {
  return await path.join(await path.appCacheDir(), 'wd14');
}

/** 清空整个临时图缓存（每轮识别前调用） */
async function clearImageCache(): Promise<void> {
  try {
    await fs.removeDir(await imageCacheRoot(), { recursive: true });
  } catch {
    // 不存在/占用忽略
  }
}

/** 删掉某篇的临时图缓存（识别完即释放，避免占 C 盘） */
async function removePostImageCache(postId: string): Promise<void> {
  try {
    await fs.removeDir(await path.join(await imageCacheRoot(), postId), {
      recursive: true,
    });
  } catch {
    // ignore
  }
}

// ---------- 跑批 ----------

let stopRequested = false;
export function requestVisionStop(): void {
  stopRequested = true;
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
  const vision = useSettingsStore.getState().vision || {};
  const modelId = vision.model || DEFAULT_MODEL;
  const todo = items.filter((it) => !isDone(seen.get(it.postId), k, modelId));
  const total = todo.length;
  if (total === 0) return 0;

  const useBuiltin = (vision.engine || 'builtin') === 'builtin';
  if (useBuiltin) {
    if (!(await modelReady(modelId))) {
      throw new Error(
        'WD14 模型未下载，请到「设置 → 工具与数据 → 视觉识别」下载',
      );
    }
  } else {
    await visionStart();
  }

  await clearImageCache(); // 清掉上轮遗留的临时图
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
              modelId,
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
            modelId,
          ),
        );
        done++;
      } catch (err: unknown) {
        logger().error('视觉识别失败', { postId: item.postId, err });
        // 单篇失败：记一条带 errors 的记录（可重试），**不中断整批**
        await appendVisualRecord(
          makeRecord(
            item.postId,
            [],
            [],
            0,
            k,
            [String(getErrorMessage(err) || err)],
            prev?.added,
            prev?.removed,
            modelId,
          ),
        );
        done++;
      } finally {
        // 识别完即删该篇临时图（本地已下载的没有临时图，忽略）
        await removePostImageCache(item.postId);
      }
    }
  } finally {
    if (!useBuiltin) await visionStop();
  }
  return done;
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
    prev?.engine,
  );
  await appendVisualRecord(rec);
  return rec;
}
