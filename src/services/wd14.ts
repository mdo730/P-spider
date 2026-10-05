import { fs, invoke, path } from '@tauri-apps/api';
import { listen } from '@tauri-apps/api/event';
import tagMapJson from '../data/wd14-tag-map.json';
// danbooru-zh.json：WD14 标签中英对照（来源 sw1313/danbooru-tags-translation，
// 整合自 EhTagTranslation 等，CC BY-NC-SA / GNU FDL；仅本地展示用）
import danbooruZhJson from '../data/danbooru-zh.json';
import { useAppStateStore } from '../stores/app-state';
import { useSettingsStore } from '../stores/settings';

/**
 * WD14 视觉标签：内置 Rust ort（CPU）/ 外挂 Python（GPU）+ 受控词表匹配。
 * 本模块负责路径、调用、模型下载与词表归类。
 */

let _log: ICategoriedLogger;
function log() {
  if (!_log) _log = window.log.category('VIS');
  return _log;
}

function resolveProxyUrl(): string {
  const settings = useSettingsStore.getState();
  if (!settings.proxy.enable) return '';
  return settings.proxy.useSystem
    ? useAppStateStore.getState().systemProxyUrl
    : settings.proxy.url;
}

interface TagMap {
  colorPrefixes: string[];
  ignoreSuffixWords?: string[];
  map: Record<string, [string, string]>;
  ignore: string[];
}

const BUILTIN = tagMapJson as unknown as TagMap;

export interface VisionTagItem {
  /** 类别（体型/服装/姿势/元素/道具/发型/配饰） */
  cat: string;
  /** 中文 */
  zh: string;
  /** 命中的原始标签 */
  raws: string[];
}

export interface VisionClassify {
  items: VisionTagItem[];
  /** 出现但未归类的原始标签 */
  unknown: string[];
}

/** 用户覆盖层（管理面板写入；先留空，后续接） */
let userOverride: Partial<TagMap> = {};

export function setUserOverride(o: Partial<TagMap>): void {
  userOverride = o;
}

function merged(): TagMap {
  return {
    colorPrefixes: BUILTIN.colorPrefixes,
    ignoreSuffixWords: [
      ...(BUILTIN.ignoreSuffixWords || []),
      ...(userOverride.ignoreSuffixWords || []),
    ],
    map: { ...BUILTIN.map, ...(userOverride.map || {}) },
    ignore: [...BUILTIN.ignore, ...(userOverride.ignore || [])],
  };
}

let cache: TagMap | null = null;
function table(): TagMap {
  if (!cache) cache = merged();
  return cache;
}

function lookup(m: TagMap, raw: string): [string, string] | null {
  if (m.map[raw]) return m.map[raw];
  for (const p of m.colorPrefixes) {
    if (raw.startsWith(p + ' ')) {
      const b = raw.slice(p.length + 1);
      if (m.map[b]) return m.map[b];
    }
  }
  return null;
}

function isIgnored(m: TagMap, raw: string): boolean {
  const ig = new Set(m.ignore);
  if (ig.has(raw)) return true;
  for (const p of m.colorPrefixes) {
    if (raw.startsWith(p + ' ')) {
      if (ig.has(raw.slice(p.length + 1))) return true;
    }
  }
  const last = raw.split(' ').pop() || '';
  return (m.ignoreSuffixWords || []).includes(last);
}

/** 把 WD14 原始标签归类到受控词表 */
export function classifyVisionTags(rawTags: string[]): VisionClassify {
  const m = table();
  const byKey = new Map<string, VisionTagItem>();
  const unknown: string[] = [];
  for (const raw of rawTags) {
    const hit = lookup(m, raw);
    if (hit) {
      const [cat, zh] = hit;
      const key = `${cat}|${zh}`;
      const item = byKey.get(key) || { cat, zh, raws: [] };
      if (!item.raws.includes(raw)) item.raws.push(raw);
      byKey.set(key, item);
    } else if (!isIgnored(m, raw)) {
      unknown.push(raw);
    }
  }
  const items = [...byKey.values()].sort((a, b) => a.cat.localeCompare(b.cat));
  return { items, unknown };
}

// ---------- 进程调用 ----------

function visionPaths() {
  const v = useSettingsStore.getState().vision || {};
  return {
    python: v.pythonPath || '',
    script: v.scriptPath || '',
    cudaLib: v.cudaLibPath || '',
  };
}

let started = false;

/** 启动常驻 WD14 进程（幂等） */
export async function visionStart(): Promise<void> {
  if (started) return;
  const { python, script, cudaLib } = visionPaths();
  if (!python || !script) {
    throw new Error('未配置 WD14 的 Python / 脚本路径（设置 → 视觉识别）');
  }
  const modelId = useSettingsStore.getState().vision?.model;
  let onnx = '';
  let csv = '';
  if (modelId && (await modelReady(modelId))) {
    const f = await modelFiles(modelId);
    onnx = f.modelPath;
    csv = f.csvPath;
  }
  await invoke('wd14_start', { python, script, cudaLib, onnx, csv });
  started = true;
}

export interface VisionTagResult {
  path: string;
  tags: string[];
  error?: string;
}

/** 对一批图片路径打标 */
export async function visionTag(paths: string[]): Promise<VisionTagResult[]> {
  if (paths.length === 0) return [];
  await visionStart();
  return invoke<VisionTagResult[]>('wd14_tag', { paths });
}

/** 停止进程 */
export async function visionStop(): Promise<void> {
  if (!started) return;
  try {
    await invoke('wd14_stop');
  } finally {
    started = false;
  }
}

// ---------- 内置引擎（Rust ort，跨平台/免 Python） ----------

/** 可选的 WD14 模型（来自 SmilingWolf；默认 MoAT v2） */
export const WD14_MODELS: { id: string; label: string; size: string }[] = [
  { id: 'wd-v1-4-moat-tagger-v2', label: 'MoAT v2（推荐）', size: '~311MB' },
  { id: 'wd-swinv2-tagger-v3', label: 'SwinV2 v3', size: '~350MB' },
  { id: 'wd-convnext-tagger-v3', label: 'ConvNeXt v3', size: '~400MB' },
  { id: 'wd-vit-tagger-v3', label: 'ViT v3', size: '~350MB' },
  {
    id: 'wd-eva02-large-tagger-v3',
    label: 'EVA02-Large v3（最准/最大）',
    size: '~1.1GB',
  },
  {
    id: 'wd-v1-4-convnextv2-tagger-v2',
    label: 'ConvNeXtV2 v2',
    size: '~420MB',
  },
  { id: 'wd-v1-4-swinv2-tagger-v2', label: 'SwinV2 v2', size: '~350MB' },
  { id: 'wd-v1-4-vit-tagger-v2', label: 'ViT v2', size: '~350MB' },
];

const HF_ENDPOINT = 'https://hf-mirror.com';

/** 模型目录：设置项，默认 <saveDirBase>\p-spider-wd14 */
export async function resolveModelDir(): Promise<string> {
  const st = useSettingsStore.getState();
  const v = st.vision || {};
  if (v.modelDir) return v.modelDir;
  const base = (st.download.saveDirBase || '').replace(/[\\/]+$/, '');
  return await path.join(base, 'p-spider-wd14');
}

async function modelFiles(
  modelId: string,
): Promise<{ dir: string; modelPath: string; csvPath: string }> {
  const root = await resolveModelDir();
  const dir = await path.join(root, modelId);
  return {
    dir,
    modelPath: await path.join(dir, 'model.onnx'),
    csvPath: await path.join(dir, 'selected_tags.csv'),
  };
}

/** 模型是否已下载就绪 */
export async function modelReady(modelId: string): Promise<boolean> {
  const { modelPath, csvPath } = await modelFiles(modelId);
  return (await fs.exists(modelPath)) && (await fs.exists(csvPath));
}

// 下载进度事件派发
const progressCbs = new Map<
  string,
  (p: { downloaded: number; total: number }) => void
>();
let progressListenerReady = false;
async function ensureProgressListener(): Promise<void> {
  if (progressListenerReady) return;
  progressListenerReady = true;
  try {
    await listen<{ id: string; downloaded: number; total: number }>(
      'wd14-progress',
      (e) => {
        const cb = progressCbs.get(e.payload.id);
        if (cb)
          cb({ downloaded: e.payload.downloaded, total: e.payload.total });
      },
    );
  } catch (err) {
    log().warn('wd14-progress 监听失败', err);
  }
}

async function downloadOne(
  url: string,
  dest: string,
  id: string,
  onProgress: (p: { downloaded: number; total: number }) => void,
): Promise<void> {
  await ensureProgressListener();
  progressCbs.set(id, onProgress);
  try {
    await invoke('wd14_model_download', {
      url,
      dest,
      id,
      proxyUrl: resolveProxyUrl(),
    });
  } finally {
    progressCbs.delete(id);
  }
}

/** 下载指定模型的 model.onnx + selected_tags.csv 到模型目录 */
export async function downloadModel(
  modelId: string,
  onProgress: (p: {
    file: 'csv' | 'model';
    downloaded: number;
    total: number;
  }) => void,
): Promise<void> {
  const { dir, modelPath, csvPath } = await modelFiles(modelId);
  await fs.createDir(dir, { recursive: true });
  const base = `${HF_ENDPOINT}/SmilingWolf/${modelId}/resolve/main`;
  await downloadOne(
    `${base}/selected_tags.csv`,
    csvPath,
    `csv:${modelId}`,
    (p) => onProgress({ file: 'csv', ...p }),
  );
  await downloadOne(`${base}/model.onnx`, modelPath, `model:${modelId}`, (p) =>
    onProgress({ file: 'model', ...p }),
  );
}

// 外挂依赖安装（一键）步进进度
let setupCb:
  | ((p: { step: number; total: number; message: string }) => void)
  | null = null;
let setupListenerReady = false;
async function ensureSetupListener(): Promise<void> {
  if (setupListenerReady) return;
  setupListenerReady = true;
  try {
    await listen<{ step: number; total: number; message: string }>(
      'wd14-setup',
      (e) => setupCb?.(e.payload),
    );
  } catch (err) {
    log().warn('wd14-setup 监听失败', err);
  }
}

/** 一键安装外挂依赖（建 venv + pip 装 onnxruntime-gpu + 落地脚本） */
export async function setupExternal(
  python: string,
  onProgress: (p: { step: number; total: number; message: string }) => void,
): Promise<{ python: string; script: string }> {
  await ensureSetupListener();
  setupCb = onProgress;
  try {
    return await invoke<{ python: string; script: string }>(
      'wd14_setup_external',
      {
        python,
        modelDir: await resolveModelDir(),
        proxyUrl: resolveProxyUrl(),
      },
    );
  } finally {
    setupCb = null;
  }
}

/** 内置引擎打标 */
export async function builtinTag(
  modelId: string,
  paths: string[],
): Promise<VisionTagResult[]> {
  if (paths.length === 0) return [];
  const { modelPath, csvPath } = await modelFiles(modelId);
  return invoke<VisionTagResult[]>('wd14_builtin_tag', {
    modelPath,
    csvPath,
    paths,
  });
}

// ---------- 提示词反推（右键单图，展示原始标签，不做词表过滤） ----------

export interface PromptTag {
  en: string;
  zh?: string;
}

/** 角色标签启发式：形如 "xxx (series)" */
function looksLikeCharacter(raw: string): boolean {
  return /\(.+\)/.test(raw);
}

/** 把原始标签按类别分组（命中词表→类别+中文；否则 角色/通用） */
export function groupPromptTags(
  rawTags: string[],
): { cat: string; tags: PromptTag[] }[] {
  const base = table();
  const extra = ((tagMapJson as any).promptExtra?.map || {}) as Record<
    string,
    [string, string]
  >;
  const merged: TagMap = { ...base, map: { ...base.map, ...extra } };
  const zhDict = danbooruZhJson as Record<string, string>;
  const order = [
    '体型',
    '服装',
    '姿势',
    '元素',
    '道具',
    '发型',
    '头发',
    '眼睛',
    '表情',
    '构图',
    '配饰',
    '背景',
    '画质',
  ];
  const byCat = new Map<string, PromptTag[]>();
  for (const raw of rawTags) {
    const hit = lookup(merged, raw);
    const cat = hit ? hit[0] : looksLikeCharacter(raw) ? '角色' : '通用';
    // 中文：通用字典优先（更精确，如 black hair→黑发），其次词表
    const zh = zhDict[raw] || (hit ? hit[1] : undefined);
    const arr = byCat.get(cat) || [];
    if (!arr.some((t) => t.en === raw)) arr.push({ en: raw, zh });
    byCat.set(cat, arr);
  }
  const rank = (c: string) => {
    if (c === '通用') return -1; // 通用放最上面
    const i = order.indexOf(c);
    if (i >= 0) return i;
    return c === '角色' ? 90 : 99; // 角色靠后
  };
  return [...byCat.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([cat, tags]) => ({ cat, tags }));
}

/** 对单张图跑 WD14，返回原始标签（本地优先，远程先下载） */
export async function tagImageSource(src: {
  localPath?: string;
  remoteUrl?: string;
  headers?: Record<string, string>;
}): Promise<string[]> {
  let imgPath = src.localPath;
  if (!imgPath) {
    if (!src.remoteUrl) throw new Error('没有可识别的图片');
    // 时间流的 X 图用的是本地媒体代理 URL，抽出真实地址（?u=）与代理（?p=）
    let url = src.remoteUrl;
    let proxyOverride = '';
    try {
      const u = new URL(src.remoteUrl);
      if (u.pathname === '/media' && u.searchParams.get('u')) {
        url = u.searchParams.get('u') || url;
        proxyOverride = u.searchParams.get('p') || '';
      }
    } catch {
      // 非 URL，按原样
    }
    const dir = await path.join(await path.appCacheDir(), 'wd14-single');
    await fs.createDir(dir, { recursive: true });
    const out = await invoke<string[]>('wd14_download', {
      urls: [url],
      outDir: dir,
      proxyUrl: proxyOverride || resolveProxyUrl(),
      referer: src.headers?.Referer || '',
    });
    imgPath = out[0];
  }
  const v = useSettingsStore.getState().vision || {};
  if ((v.engine || 'builtin') === 'builtin') {
    const modelId = v.model || 'wd-v1-4-moat-tagger-v2';
    if (!(await modelReady(modelId))) {
      throw new Error('模型未下载（设置 → 工具与数据 → 视觉识别）');
    }
    const res = await builtinTag(modelId, [imgPath]);
    return res[0]?.tags || [];
  }
  try {
    const res = await visionTag([imgPath]);
    return res[0]?.tags || [];
  } finally {
    // 单图识别后停掉外挂进程，避免常驻占内存
    await visionStop();
  }
}

/** 手动释放：卸载内置模型 + 停掉外挂进程 */
export async function releaseVision(): Promise<void> {
  try {
    await invoke('wd14_release');
  } catch (err) {
    log().warn('释放内置模型失败', err);
  }
  await visionStop();
}
