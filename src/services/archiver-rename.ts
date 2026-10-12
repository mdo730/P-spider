import { fs, invoke } from '@tauri-apps/api';
import { fetchPawchivePost } from '../platforms/pawchive';
import { PlatformMedia, PlatformPost } from '../platforms';
import { useSettingsStore } from '../stores/settings';
import { resolveVariables } from '../utils/file-name-template';
import { renameLibraryVisualKeys } from './library-visual';

/**
 * 归档站（pawchive）文件名回溯：
 * 依赖下载历史里的 `postUrl` + `mediaUrl`，联网拉回原帖 → 还原「封面 → 附件」正确顺序
 * → 按「归档站文件名模板」把本地文件改名（序号 + 标题/原名）。
 * 只处理 pawchive；与 X 的溯源完全独立。
 */

interface HistRecord {
  platform?: string;
  postUrl?: string;
  filePath?: string;
  fileName?: string;
  mediaUrl?: string;
}

export interface RenameProgress {
  phase: 'fetching' | 'renaming';
  posts: number;
  totalPosts: number;
  current: string;
  renamed: number;
  skipped: number;
  failed: number;
}

export interface RenameResult {
  renamed: number;
  skipped: number;
  failed: number;
  posts: number;
  aborted: boolean;
}

function baseOf(u?: string): string {
  if (!u) return '';
  const p = u.split('?')[0].split('#')[0];
  const parts = p.split(/[\\/]/);
  return (parts[parts.length - 1] || '').toLowerCase();
}

function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i >= 0 ? p.slice(0, i) : p;
}

function parsePostUrl(url: string): {
  service: string;
  userId: string;
  postId: string;
} | null {
  const m = url.match(/\/([^/]+)\/user\/([^/]+)\/post\/([^/?#]+)/);
  if (!m) return null;
  return { service: m[1], userId: m[2], postId: m[3] };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runArchiverRename(
  onProgress: (p: RenameProgress) => void,
  signal: AbortSignal,
): Promise<RenameResult> {
  const template =
    useSettingsStore.getState().download.pawchiveFileNameTemplate || '';

  // 全部历史记录（limit=0 取全部），只保留 pawchive 且有 postUrl/mediaUrl 的
  const all = await invoke<HistRecord[]>('hist_recent', {
    sinceIso: '1970-01-01T00:00:00.000Z',
    limit: 0,
  });
  const recs = all.filter(
    (r) => r.platform === 'pawchive' && r.postUrl && r.filePath,
  );

  // 按 postUrl 分组（一个帖子一次网络请求）
  const groups = new Map<string, HistRecord[]>();
  for (const r of recs) {
    const arr = groups.get(r.postUrl!);
    if (arr) arr.push(r);
    else groups.set(r.postUrl!, [r]);
  }

  const result: RenameResult = {
    renamed: 0,
    skipped: 0,
    failed: 0,
    posts: 0,
    aborted: false,
  };
  const emit = (patch: Partial<RenameProgress>) =>
    onProgress({
      phase: 'renaming',
      posts: result.posts,
      totalPosts: groups.size,
      current: '',
      renamed: result.renamed,
      skipped: result.skipped,
      failed: result.failed,
      ...patch,
    });

  emit({ phase: 'fetching' });

  const pathPairs: [string, string][] = [];
  let i = 0;
  for (const [postUrl, list] of groups) {
    if (signal.aborted) {
      result.aborted = true;
      break;
    }
    i++;
    const parsed = parsePostUrl(postUrl);
    if (!parsed) {
      result.skipped += list.length;
      continue;
    }
    if (!template) {
      result.skipped += list.length;
      continue;
    }

    emit({
      phase: 'fetching',
      posts: i,
      current: parsed.postId,
    });

    let post: PlatformPost;
    try {
      post = await fetchPawchivePost(
        parsed.service,
        parsed.userId,
        parsed.postId,
      );
    } catch {
      result.failed += list.length;
      emit({ posts: i, current: `${parsed.postId}（拉取失败）` });
      await delay(150);
      continue;
    }

    // url basename / fileName basename → media
    const byKey = new Map<string, PlatformMedia>();
    for (const m of post.medias ?? []) {
      const k1 = baseOf(m.url);
      const k2 = baseOf(m.fileName);
      if (k1) byKey.set(k1, m);
      if (k2) byKey.set(k2, m);
    }

    emit({ phase: 'renaming', posts: i, current: post.text || parsed.postId });

    for (const r of list) {
      if (signal.aborted) {
        result.aborted = true;
        break;
      }
      const oldPath = r.filePath!;
      const exists = await fs.exists(oldPath).catch(() => false);
      if (!exists) {
        result.skipped++;
        continue;
      }
      const media =
        byKey.get(baseOf(r.mediaUrl)) || byKey.get(baseOf(r.fileName));
      if (!media) {
        result.skipped++;
        continue;
      }
      const newName = resolveVariables(template, { media, post });
      const curName = (oldPath.split(/[\\/]/).pop() || '').trim();
      if (!newName || newName.toLowerCase() === curName.toLowerCase()) {
        result.skipped++;
        continue;
      }
      const dir = dirOf(oldPath);
      const newPath = `${dir}\\${newName}`;
      try {
        if (
          newPath.toLowerCase() !== oldPath.toLowerCase() &&
          (await fs.exists(newPath).catch(() => false))
        ) {
          // 目标已存在 → 跳过，避免覆盖
          result.failed++;
          continue;
        }
        await fs.renameFile(oldPath, newPath);
        result.renamed++;
        pathPairs.push([oldPath, newPath]);
        // 同步下载历史（本地库信息条等按路径查询用）
        await invoke('hist_rename_path', { oldPath, newPath }).catch(
          () => undefined,
        );
      } catch {
        result.failed++;
      }
      emit({
        phase: 'renaming',
        posts: i,
        current: post.text || parsed.postId,
      });
    }

    await delay(120); // 轻微节流，避免打太快
  }

  // 同步 WD14 视觉标签索引的键（按路径索引）
  await renameLibraryVisualKeys(pathPairs).catch(() => undefined);

  emit({ phase: 'renaming', posts: groups.size });
  return result;
}
