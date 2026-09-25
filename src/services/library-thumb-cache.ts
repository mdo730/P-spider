import { useSettingsStore } from '../stores/settings';
import { listRootFolders, scanDirectory } from '../utils/library';
import { generateImageThumbUrl, getCachedThumbUrl } from '../utils/thumbnail';

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('LIB');
  return _log;
}

export interface ThumbCacheProgress {
  phase: 'scanning' | 'generating';
  totalFiles: number;
  processedFiles: number;
  generated: number;
  skipped: number;
  failed: number;
}

export interface ThumbCacheResult {
  total: number;
  generated: number;
  skipped: number;
  failed: number;
  aborted: boolean;
}

/**
 * 一键为保存目录下所有图片生成缩略图缓存（已存在的跳过），
 * 生成后本地库浏览不再有初次解码卡顿。后台运行、可中断。
 */
export async function runThumbCache(
  onProgress: (progress: ThumbCacheProgress) => void,
  signal: AbortSignal,
): Promise<ThumbCacheResult> {
  const settings = useSettingsStore.getState();
  const saveDirBase = settings.download.saveDirBase;
  if (!saveDirBase) throw new Error('未设置保存目录');

  const progress: ThumbCacheProgress = {
    phase: 'scanning',
    totalFiles: 0,
    processedFiles: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
  };
  onProgress({ ...progress });

  // 阶段一：扫描所有图片文件
  const rootFolders = await listRootFolders(saveDirBase);
  const images: string[] = [];
  for (const folder of rootFolders) {
    if (signal.aborted) break;
    try {
      const content = await scanDirectory(folder.path);
      for (const file of content.files) {
        if (file.kind === 'image') images.push(file.path);
      }
    } catch (err) {
      log().warn('扫描失败', folder.path, err);
    }
    onProgress({ ...progress });
  }

  // 阶段二：逐个生成（已缓存的跳过）
  progress.phase = 'generating';
  progress.totalFiles = images.length;
  progress.processedFiles = 0;
  onProgress({ ...progress });

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  for (const path of images) {
    if (signal.aborted) break;
    const cached = await getCachedThumbUrl(path);
    if (cached) {
      skipped += 1;
    } else if (await generateImageThumbUrl(path)) {
      generated += 1;
    } else {
      failed += 1;
    }
    progress.processedFiles += 1;
    // 每 5 个才推一次进度，避免上千次无谓的 store 更新/React 重渲染
    if (progress.processedFiles % 5 === 0) {
      progress.generated = generated;
      progress.skipped = skipped;
      progress.failed = failed;
      onProgress({ ...progress });
    }
  }
  progress.generated = generated;
  progress.skipped = skipped;
  progress.failed = failed;
  onProgress({ ...progress });

  return {
    total: images.length,
    generated,
    skipped,
    failed,
    aborted: signal.aborted,
  };
}
