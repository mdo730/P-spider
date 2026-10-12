import { getErrorMessage } from '../utils/error';
import { fs, path } from '@tauri-apps/api';
import { useSettingsStore } from '../stores/settings';
import { scanDirectory } from '../utils/library/scan';
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
  isDone,
  makeRecord,
  VisualRecord,
  VisionProgress,
} from './vision-core';

/**
 * 本地库视觉标签：给**本地图片文件**跑 WD14 → 受控词表归类 → 存索引。
 * 与 fig-memo 版（figmemo-visual）同一套记录结构，键是**文件绝对路径**；
 * 图片就在本地，无需下载，每张图一条记录（k=1）。
 * 索引文件：appDataDir/library-visual-tags.jsonl
 */

let log: ICategoriedLogger;
function logger() {
  if (!log) log = window.log.category('VIS');
  return log;
}

async function visualTagsPath(): Promise<string> {
  return await path.join(await path.appDataDir(), 'library-visual-tags.jsonl');
}

/** 读取索引（文件路径 → 记录，后写覆盖前写） */
export async function readLibraryVisualTags(): Promise<
  Map<string, VisualRecord>
> {
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
    logger().warn('读取本地库视觉标签索引失败', err);
  }
  return map;
}

async function appendVisualRecord(rec: VisualRecord): Promise<void> {
  const file = await visualTagsPath();
  await fs.writeTextFile(file, JSON.stringify(rec) + '\n', { append: true });
}

function normPath(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/** 文件改名后同步视觉标签索引的键（[旧路径, 新路径]，用于归档站回溯改名） */
export async function renameLibraryVisualKeys(
  pairs: [string, string][],
): Promise<void> {
  if (pairs.length === 0) return;
  const file = await visualTagsPath();
  if (!(await fs.exists(file))) return;
  const text = await fs.readTextFile(file);
  const map = new Map(pairs.map(([o, n]) => [normPath(o), n]));
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let rec: VisualRecord | null = null;
    try {
      rec = JSON.parse(s) as VisualRecord;
    } catch {
      // 坏行原样保留
    }
    if (rec?.postId) {
      const nn = map.get(normPath(rec.postId));
      if (nn) rec.postId = nn;
      out.push(JSON.stringify(rec));
    } else {
      out.push(s);
    }
  }
  await fs.writeTextFile(file, out.join('\n') + (out.length ? '\n' : ''));
}

/**
 * 清除（递归）指定文件夹下的所有视觉标签记录 → 之后重新识别会打上最新词表。
 * 索引是 append-only 的 jsonl，这里整体重写去掉匹配行。返回删除的条数。
 */
export async function clearLibraryVisualTags(
  prefixes: string[],
): Promise<number> {
  const file = await visualTagsPath();
  if (!(await fs.exists(file))) return 0;
  const pre = prefixes.map(normPath).filter(Boolean);
  if (pre.length === 0) return 0;
  const text = await fs.readTextFile(file);
  const kept: string[] = [];
  let removed = 0;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let key = '';
    try {
      key = (JSON.parse(s) as VisualRecord).postId || '';
    } catch {
      // 坏行保留
    }
    const nk = normPath(key);
    if (key && pre.some((p) => nk === p || nk.startsWith(p + '\\'))) {
      removed++;
      continue;
    }
    kept.push(s);
  }
  if (removed > 0) {
    await fs.writeTextFile(file, kept.join('\n') + (kept.length ? '\n' : ''));
  }
  return removed;
}

/** 收集一组文件夹下的所有图片路径（递归） */
export async function collectImagesUnderFolders(
  folders: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const dir of folders) {
    try {
      const data = await scanDirectory(dir);
      for (const f of data.files) {
        if (f.kind === 'image') out.push(f.path);
      }
    } catch (err) {
      logger().warn('扫描文件夹图片失败', dir, err);
    }
  }
  return out;
}

// ---------- 跑批 ----------

let stopRequested = false;
export function requestLibraryVisionStop(): void {
  stopRequested = true;
}

/**
 * 对一批本地图片路径跑视觉识别，逐张写索引。
 * 返回处理的张数。
 */
export async function runLibraryVision(
  paths: string[],
  onProgress: (p: VisionProgress) => void,
  existing?: Map<string, VisualRecord>,
): Promise<number> {
  const seen = existing || (await readLibraryVisualTags());
  stopRequested = false;
  const k = 1; // 每个文件就是一张图
  const vision = useSettingsStore.getState().vision || {};
  const modelId = vision.model || DEFAULT_MODEL;
  const todo = paths.filter((p) => !isDone(seen.get(p), k, modelId));
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

  let done = 0;
  try {
    for (let i = 0; i < todo.length; i++) {
      if (stopRequested) break;
      const filePath = todo[i];
      const prev = seen.get(filePath);
      const name = filePath.split(/[\\/]/).pop() || filePath;
      onProgress({ done, total, index: i + 1, currentTitle: name });
      try {
        const results = useBuiltin
          ? await builtinTag(modelId, [filePath])
          : await visionTag([filePath]);
        const raw = new Set<string>();
        const errors: string[] = [];
        for (const r of results) {
          if (r.error) errors.push(`${name}: ${r.error}`);
          for (const t of r.tags || []) raw.add(t);
        }
        const classified = classifyVisionTags([...raw]);
        await appendVisualRecord(
          makeRecord(
            filePath,
            classified.items,
            classified.unknown,
            results.length,
            k,
            errors,
            prev?.added,
            prev?.removed,
            modelId,
          ),
        );
        done++;
      } catch (err: unknown) {
        logger().error('本地库视觉识别失败', { filePath, err });
        // 单张失败：记一条带 errors 的记录（可重试），**不中断整批**
        await appendVisualRecord(
          makeRecord(
            filePath,
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
      }
    }
  } finally {
    if (!useBuiltin) await visionStop();
  }
  return done;
}

/** 更新某个文件的手动覆盖（added/removed），保留 auto；重扫不会再碰这些 */
export async function setLibraryVisualOverride(
  filePath: string,
  added: VisionTagItem[],
  removed: string[],
): Promise<VisualRecord> {
  const map = await readLibraryVisualTags();
  const prev = map.get(filePath);
  const rec = makeRecord(
    filePath,
    prev?.items || [],
    prev?.unknown || [],
    prev?.images || 0,
    prev?.k || 1,
    prev?.errors,
    added,
    removed,
    prev?.engine,
  );
  await appendVisualRecord(rec);
  return rec;
}
