import { fs, invoke, path } from '@tauri-apps/api';
import { toAssetUrl } from './asset';
import { LibraryFolderStats, fetchFolderStats } from './library';

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('LIB');
  return _log;
}

/** 缩略图边长（px）。正方形居中裁剪，匹配卡片 object-cover 展示；改此值会随缓存 key 失效重生成 */
const MAX_THUMB_SIZE = 200;
/** 同时进行的解码/生成数量（避免大图批量解码卡顿） */
const MAX_CONCURRENCY = 2;

/** path → 已生成的缩略图 asset URL（会话级） */
const memoryCache = new Map<string, string>();
/** path → 进行中的生成 Promise（去重并发生成） */
const pending = new Map<string, Promise<string | null>>();

let active = 0;
const waitQueue: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  active += 1;
}

function release(): void {
  active -= 1;
  const next = waitQueue.shift();
  if (next) next();
}

async function getCacheDir(): Promise<string> {
  return await path.join(await path.appDataDir(), 'thumb-cache');
}

function hashPath(p: string): string {
  // 把缩略图尺寸并入 key，改尺寸后旧缓存自动失效、重新生成
  const key = `${MAX_THUMB_SIZE}:${p}`;
  let h = 5381;
  for (let i = 0; i < key.length; i += 1) {
    h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  }
  return `${(h >>> 0).toString(16)}${key.length.toString(16)}`;
}

async function thumbFilePath(filePath: string): Promise<string> {
  return await path.join(await getCacheDir(), `${hashPath(filePath)}.jpg`);
}

/** 读取已缓存的缩略图 URL（不存在返回 null，不触发生成） */
export async function getCachedThumbUrl(
  filePath: string,
): Promise<string | null> {
  const cached = memoryCache.get(filePath);
  if (cached) return cached;
  try {
    const thumbPath = await thumbFilePath(filePath);
    if (await fs.exists(thumbPath)) {
      const url = toAssetUrl(thumbPath);
      memoryCache.set(filePath, url);
      return url;
    }
  } catch (err) {
    log().warn('getCachedThumbUrl failed', filePath, err);
  }
  return null;
}

/** 是否在 Tauri 桌面环境（v1 注入 __TAURI__，v2 注入 __TAURI_INTERNALS__） */
function isTauriEnv(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
  );
}

/** 浏览器回退（无 Tauri 时）：canvas 生成 200×200 居中裁剪缩略图 */
async function generateViaCanvas(filePath: string, out: string): Promise<void> {
  const bytes = await fs.readBinaryFile(filePath);
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const size = Math.min(MAX_THUMB_SIZE, Math.min(bitmap.width, bitmap.height));
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const sw = size / scale;
  const sh = size / scale;
  const sx = (bitmap.width - sw) / 2;
  const sy = (bitmap.height - sh) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 上下文');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, size, size);
  bitmap.close?.();
  const outBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))),
      'image/jpeg',
      0.82,
    );
  });
  await fs.writeBinaryFile(out, new Uint8Array(await outBlob.arrayBuffer()));
}

/** 生成并缓存图片缩略图，返回 asset URL；失败返回 null */
export async function generateImageThumbUrl(
  filePath: string,
): Promise<string | null> {
  const cached = await getCachedThumbUrl(filePath);
  if (cached) return cached;

  const existing = pending.get(filePath);
  if (existing) return existing;

  const task = (async (): Promise<string | null> => {
    await acquire();
    try {
      const dir = await getCacheDir();
      if (!(await fs.exists(dir))) {
        await fs.createDir(dir, { recursive: true });
      }
      const out = await thumbFilePath(filePath);
      if (isTauriEnv()) {
        // 优先在 Rust 端生成（不占用 WebView 主线程/内存；超大图会直接被拒）
        await invoke('generate_thumbnail', {
          src: filePath,
          dst: out,
          size: MAX_THUMB_SIZE,
        });
      } else {
        await generateViaCanvas(filePath, out);
      }
      const url = toAssetUrl(out);
      memoryCache.set(filePath, url);
      return url;
    } catch (err) {
      // 失败（格式不支持/过大/损坏）→ 返回 null，调用方回退显示原图
      log().warn('generateImageThumbUrl failed', filePath, err);
      return null;
    } finally {
      release();
    }
  })();

  pending.set(filePath, task);
  try {
    return await task;
  } finally {
    pending.delete(filePath);
  }
}

/** 删除单个文件的缩略图缓存（如文件被删除后调用） */
export async function deleteCachedThumb(filePath: string): Promise<void> {
  memoryCache.delete(filePath);
  try {
    const thumbPath = await thumbFilePath(filePath);
    if (await fs.exists(thumbPath)) {
      await fs.removeFile(thumbPath);
    }
  } catch (err) {
    log().warn('deleteCachedThumb failed', filePath, err);
  }
}

/** 清空全部缩略图缓存（内存 + 磁盘） */
export async function clearThumbCache(): Promise<void> {
  memoryCache.clear();
  const dir = await getCacheDir();
  if (await fs.exists(dir)) {
    await fs.removeDir(dir, { recursive: true });
  }
}

/** 统计缩略图缓存占用（文件数 + 字节数） */
export async function getThumbCacheStats(): Promise<LibraryFolderStats> {
  try {
    const dir = await getCacheDir();
    if (!(await fs.exists(dir))) return { fileCount: 0, totalBytes: 0 };
    return await fetchFolderStats(dir);
  } catch (err) {
    log().warn('getThumbCacheStats failed', err);
    return { fileCount: 0, totalBytes: 0 };
  }
}
