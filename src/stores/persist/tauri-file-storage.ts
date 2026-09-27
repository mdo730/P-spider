import { fs, path } from '@tauri-apps/api';
import { PersistStorage } from 'zustand/middleware';

async function writeJsonFile<T = any>(filePath: string, value: T) {
  const dir = await path.dirname(filePath);
  if (!(await fs.exists(dir))) {
    await fs.createDir(dir, {
      recursive: true,
    });
  }
  const json = JSON.stringify(value, undefined, 2);
  // 原子写：先写临时文件再替换，避免写入过程中被并发读/写到半截
  const tmp = `${filePath}.tmp`;
  await fs.writeTextFile(tmp, json);
  try {
    await fs.removeFile(filePath);
  } catch {
    // 目标不存在
  }
  try {
    await fs.renameFile(tmp, filePath);
  } catch {
    // rename 失败则回退直接覆盖
    await fs.writeTextFile(filePath, json);
    try {
      await fs.removeFile(tmp);
    } catch {
      // ignore
    }
  }
}

async function getJsonFile(filePath: string): Promise<any | null> {
  if (!(await fs.exists(filePath))) {
    return null;
  }

  const text = await fs.readTextFile(filePath);
  return JSON.parse(text);
}

async function resolveFilePath(name: string): Promise<string> {
  return await path
    .appDataDir()
    .then(async (configDir) => await path.join(configDir, `${name}.json`));
}

// 每个 store 的写入串行化：zustand persist 的多次 set 会并发调用 setItem，
// 若并发写同一文件会互相交错导致 JSON 损坏（曾出现两份 JSON 拼接）。
const writeQueues = new Map<string, Promise<void>>();

export function createTauriFileStorage<T>(): PersistStorage<T> | undefined {
  return {
    async getItem(name) {
      const filePath = await resolveFilePath(name);
      if (!(await fs.exists(filePath))) {
        return null;
      }

      return await getJsonFile(filePath);
    },
    async removeItem(name) {
      const filePath = await resolveFilePath(name);
      if (!(await fs.exists(filePath))) {
        return;
      }

      await fs.removeFile(filePath);
    },
    setItem(name, value) {
      const prev = writeQueues.get(name) ?? Promise.resolve();
      const next = prev
        .catch(() => undefined)
        .then(async () => {
          const filePath = await resolveFilePath(name);
          await writeJsonFile(filePath, value);
        });
      writeQueues.set(name, next);
      return next;
    },
  };
}
