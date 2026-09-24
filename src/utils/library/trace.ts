import { fs, path } from '@tauri-apps/api';
import dayjs from 'dayjs';
import {
  DownloadHistoryRecord,
  FileTweetInfo,
  normalizePath,
  recordToTweetInfo,
} from '../../stores/download-history';
import { buildPostUrl } from '../../twitter/url';

let _log: ICategoriedLogger;

function log() {
  if (_log) return _log;
  _log = window.log.category('LIB');
  return _log;
}

/** 联网溯源（方向 B）产出的记录 */
export interface TracedRecord {
  postId: string;
  username?: string;
  displayName?: string;
  avatar?: string;
  tweetTime?: string;
  fullText?: string;
  postUrl?: string;
}

/** 文件名反解（方向 A）产出的信息 */
export interface ParsedFileInfo {
  postId?: string;
  username?: string;
  time?: string;
}

async function getTraceFilePath(): Promise<string> {
  const dir = await path.appDataDir();
  if (!(await fs.exists(dir))) {
    await fs.createDir(dir, { recursive: true });
  }
  return await path.join(dir, 'library-trace.json');
}

/** 读取联网溯源的本地缓存（文件路径 → 记录） */
export async function readTraceMap(): Promise<Map<string, TracedRecord>> {
  try {
    const file = await getTraceFilePath();
    if (!(await fs.exists(file))) return new Map();
    const text = await fs.readTextFile(file);
    const obj = JSON.parse(text) as Record<string, TracedRecord>;
    return new Map(Object.entries(obj));
  } catch (err) {
    log().warn('readTraceMap failed', err);
    return new Map();
  }
}

export async function writeTraceMap(
  map: Map<string, TracedRecord>,
): Promise<void> {
  const file = await getTraceFilePath();
  const obj: Record<string, TracedRecord> = {};
  for (const [key, value] of map) obj[key] = value;
  await fs.writeTextFile(file, JSON.stringify(obj, undefined, 2));
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let cachedTemplate = '';
let cachedTemplateRegex: {
  regex: RegExp;
  names: (string | undefined)[];
} | null = null;

/** 模板 → 正则可解析（按模板字符串缓存，避免逐文件重复编译） */
function getTemplateRegex(template: string): {
  regex: RegExp;
  names: (string | undefined)[];
} {
  if (cachedTemplateRegex && cachedTemplate === template) {
    return cachedTemplateRegex;
  }
  const compiled = templateToRegex(template);
  cachedTemplate = template;
  cachedTemplateRegex = compiled;
  return compiled;
}

/** 把文件名模板转成可解析的正则（仅捕获 POST_ID / USER_SCREEN_NAME / POST_TIME，其余占位符当通配） */
function templateToRegex(template: string): {
  regex: RegExp;
  names: (string | undefined)[];
} {
  const names: (string | undefined)[] = [];
  let pattern = '';
  const re = /%([A-Z_]+)((?:,[a-z]=.+?)+)?%/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    pattern += escapeRegex(template.slice(lastIndex, match.index));
    const varName = match[1].toUpperCase();
    const params = match[2] || '';
    let group: string | undefined;
    if (varName === 'POST_ID') {
      group = '(\\d+)';
    } else if (varName === 'USER_SCREEN_NAME') {
      group = '([A-Za-z0-9_]+)';
    } else if (varName === 'POST_TIME') {
      group = params.includes('d=1')
        ? '(\\d{4}-\\d{2}-\\d{2})'
        : '(\\d{4}-\\d{2}-\\d{2} \\d{2}-\\d{2}-\\d{2})';
    }
    if (group) {
      pattern += group;
      names.push(varName);
    } else {
      pattern += '.*?';
      names.push(undefined);
    }
    lastIndex = re.lastIndex;
  }
  pattern += escapeRegex(template.slice(lastIndex));
  return { regex: new RegExp(`^${pattern}$`), names };
}

function parsePostTime(value: string): string | undefined {
  const full = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})$/.exec(value);
  if (full) {
    const d = dayjs(
      `${full[1]}-${full[2]}-${full[3]}T${full[4]}:${full[5]}:${full[6]}`,
    );
    return d.isValid() ? d.toISOString() : undefined;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = dayjs(value);
    return d.isValid() ? d.toISOString() : undefined;
  }
  return undefined;
}

/**
 * 方向 A：按文件名模板反解出 推文 ID / 用户名 / 时间。
 * 失败（不匹配/无推断 ID）返回 null。
 */
export function parseFileName(
  fileName: string,
  template: string,
): ParsedFileInfo | null {
  if (!fileName || !template) return null;
  const { regex, names } = getTemplateRegex(template);
  const match = regex.exec(fileName);
  if (!match) return null;
  const info: ParsedFileInfo = {};
  names.forEach((name, index) => {
    if (!name) return;
    const value = match[index + 1];
    if (!value) return;
    if (name === 'POST_ID') info.postId = value;
    else if (name === 'USER_SCREEN_NAME') info.username = value;
    else if (name === 'POST_TIME') info.time = parsePostTime(value);
  });
  if (!info.postId) return null;
  return info;
}

function tracedToInfo(record: TracedRecord): FileTweetInfo {
  const url =
    record.postUrl ||
    (record.username && record.postId
      ? buildPostUrl(record.username, record.postId)
      : undefined);
  return {
    displayName: record.displayName,
    username: record.username,
    avatar: record.avatar,
    time: record.tweetTime,
    url,
    text: record.fullText,
  };
}

function parsedToInfo(
  parsed: ParsedFileInfo,
  authorFallback?: string,
): FileTweetInfo {
  const url =
    parsed.postId && parsed.username
      ? buildPostUrl(parsed.username, parsed.postId)
      : undefined;
  return {
    displayName: authorFallback,
    username: parsed.username,
    time: parsed.time,
    url,
  };
}

/**
 * 解析本地文件的推文信息，来源优先级：
 * 下载历史（downloads.jsonl）→ 联网溯源缓存（library-trace.json）→ 文件名反解。
 */
export function resolveFileTweetInfo(
  filePath: string,
  fileName: string,
  historyMap: Map<string, DownloadHistoryRecord>,
  traceMap: Map<string, TracedRecord>,
  fileNameTemplate: string,
  authorFallback?: string,
): FileTweetInfo | undefined {
  const key = normalizePath(filePath);
  const record = historyMap.get(key);
  if (record) return recordToTweetInfo(record);
  const traced = traceMap.get(key);
  if (traced) return tracedToInfo(traced);
  const parsed = parseFileName(fileName, fileNameTemplate);
  if (parsed && (parsed.postId || parsed.username)) {
    return parsedToInfo(parsed, authorFallback);
  }
  return undefined;
}
