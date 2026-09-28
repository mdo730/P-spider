import { dialog, invoke, path } from '@tauri-apps/api';

/**
 * 用户数据备份包含的文件（均在 %APPDATA%\p-spider 下）。
 * 不含下载历史（downloads.jsonl 可能几十 MB）与站点缓存（*-site.json，可再生）。
 */
export const BACKUP_FILES = [
  'settings.json',
  'app-state.json',
  'subscriptions.json',
  'library.json',
  'figmemo-tags.json',
  'figmemo-tags-user.json',
  'figmemo-state.json',
  'figmemo-favorites.json',
  'moeyo-tags.json',
  'moeyo-tags-user.json',
  'moeyo-state.json',
  'moeyo-favorites.json',
  'figmemo.jsonl',
  'moeyo.jsonl',
  'retweets.jsonl',
];

async function appVersion(): Promise<string> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return '';
  }
}

/** 弹出保存框并导出用户数据 zip；返回保存路径（取消则 undefined） */
export async function exportUserBackup(): Promise<string | undefined> {
  const dir = await path.appDataDir();
  const dest = await dialog.save({
    title: '导出用户数据',
    defaultPath: `p-spider-backup-${new Date()
      .toISOString()
      .slice(0, 16)
      .replace(/[-:T]/g, '')}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (!dest) return undefined;
  const meta = JSON.stringify(
    {
      app: 'P-Spider',
      version: await appVersion(),
      exportedAt: new Date().toISOString(),
    },
    undefined,
    2,
  );
  await invoke<string[]>('export_user_backup', {
    dir,
    dest,
    names: BACKUP_FILES,
    meta,
  });
  return dest;
}

export interface RestoreResult {
  restored: string[];
}

/** 弹出选择框并从 zip 恢复用户数据；返回恢复结果（取消则 undefined） */
export async function importUserBackup(): Promise<RestoreResult | undefined> {
  const dir = await path.appDataDir();
  const src = await dialog.open({
    title: '导入用户数据',
    multiple: false,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (!src) return undefined;
  const restored = await invoke<string[]>('import_user_backup', {
    dir,
    src: String(src),
    names: BACKUP_FILES,
  });
  return { restored };
}
