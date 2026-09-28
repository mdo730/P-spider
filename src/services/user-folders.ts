import { fs, path } from '@tauri-apps/api';
import { PlatformSource } from '../platforms';

/**
 * 「账号 → 文件夹名」绑定：
 * 同一个账号**首次建夹时用的显示名会被记住**，之后用户改显示名
 * （比如加「C106 8/17 西え47ab」这类活动/摊位后缀）不会再新建一个文件夹。
 *
 * 键用「平台 + 稳定 id」优先，同时写一份「平台 + 用户名」的别名，
 * 这样没有 id 的场景（如订阅页的「文件夹」按钮）也能命中同一条绑定。
 */
const FILE = 'user-folders.json';

let cache: Record<string, string> | null = null;
let loading: Promise<Record<string, string>> | null = null;

let _log: ICategoriedLogger;
function log() {
  if (_log) return _log;
  _log = window.log.category('HIST');
  return _log;
}

async function filePath(): Promise<string> {
  return await path.join(await path.appDataDir(), FILE);
}

async function load(): Promise<Record<string, string>> {
  if (cache) return cache;
  if (!loading) {
    loading = (async () => {
      try {
        const p = await filePath();
        if (await fs.exists(p)) {
          const obj = JSON.parse(await fs.readTextFile(p));
          if (obj && typeof obj === 'object') return obj;
        }
      } catch (err) {
        log().warn('读取 user-folders.json 失败', err);
      }
      return {};
    })();
  }
  cache = await loading;
  return cache;
}

/** 原子写回（串行化，避免并发写坏） */
let writeQueue: Promise<void> = Promise.resolve();
function save(): void {
  if (!cache) return;
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        const p = await filePath();
        const json = JSON.stringify(cache, undefined, 2);
        const tmp = `${p}.tmp`;
        await fs.writeTextFile(tmp, json);
        try {
          await fs.removeFile(p);
        } catch {
          // 目标不存在
        }
        try {
          await fs.renameFile(tmp, p);
        } catch {
          await fs.writeTextFile(p, json);
        }
      } catch (err) {
        log().warn('保存 user-folders.json 失败', err);
      }
    });
}

/**
 * 取该账号绑定的文件夹名；首次调用则用 currentName 锁定。
 * currentName 传**未做文件名清洗**的显示名，清洗由调用方负责。
 */
export async function pinUserFolderName(
  source: PlatformSource,
  ids: { id?: string; username?: string },
  currentName: string,
): Promise<string> {
  const name = (currentName || '').trim();
  if (!name) return currentName;
  const map = await load();
  const kId = ids.id ? `${source}:id:${ids.id}` : '';
  const kUn = ids.username ? `${source}:un:${ids.username.toLowerCase()}` : '';

  const found = (kId && map[kId]) || (kUn && map[kUn]) || '';
  if (found) {
    let changed = false;
    if (kId && map[kId] !== found) {
      map[kId] = found;
      changed = true;
    }
    if (kUn && map[kUn] !== found) {
      map[kUn] = found;
      changed = true;
    }
    if (changed) save();
    return found;
  }

  if (kId) map[kId] = name;
  if (kUn) map[kUn] = name;
  save();
  return name;
}
