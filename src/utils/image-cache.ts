import { fs, path } from '@tauri-apps/api';

/** 把图片复制到应用数据目录下的子目录，返回缓存文件路径 */
export async function cacheImageFile(
  source: string,
  subdir: string,
  prefix = 'img',
): Promise<string> {
  const dir = await path.join(await path.appDataDir(), subdir);
  if (!(await fs.exists(dir))) {
    await fs.createDir(dir, { recursive: true });
  }
  const ext = source.split('.').pop()?.toLowerCase() || 'png';
  const name = `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;
  const dest = await path.join(dir, name);
  await fs.copyFile(source, dest);
  return dest;
}
