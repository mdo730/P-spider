import { dialog, fs, invoke, path } from '@tauri-apps/api';

/**
 * hpoi 本地索引搜索。
 *
 * - **hobby（77MB）**：改为 Rust + SQLite（`appData/hpoi-index/hpoi-index.db`，首次
 *   从 JSON 建库）。搜索/按 ref 列/取 refs 都走 Rust，**WebView 不再常驻 77MB**。
 * - **其它实体**（company/series/works/charactar/person，合计 ~3MB）：仍在 JS 内存，
 *   供 `getHpoiEntityNames/Info` 同步取用。
 * - 归一化（normHpoi）在前端完成，token 传给 Rust 做子串匹配打分（与原逻辑一致）。
 */

export type HpoiSearchKind =
  | 'hobby'
  | 'company'
  | 'series'
  | 'works'
  | 'charactar'
  | 'person';

const ENTITY_KINDS: HpoiSearchKind[] = [
  'company',
  'series',
  'works',
  'charactar',
  'person',
];

export interface HpoiSearchHit {
  kind: HpoiSearchKind;
  id: number;
  name: string;
  nameJa?: string;
  cover?: string;
  companyName?: string;
  category?: string;
  releaseDate?: string;
  filterId?: number;
  hits?: number;
  hitsDay?: number;
  hits7Day?: number;
  rating?: number;
  collect?: number;
  refs?: string[];
  score: number;
}

interface KindData {
  kind: HpoiSearchKind;
  items: any[][];
}

export interface HpoiDelta {
  v: number;
  at?: number;
  maxId?: number;
  hobbies: any[][];
  company: any[][];
  series: any[][];
  works: any[][];
  charactar: any[][];
  person: any[][];
}

/** NFKC + 小写 + 去空白/标点/全角括号（与 Rust norm_hpoi 一致） */
export function normHpoi(s: string): string {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[「」『』（）()[\]【】·・:：,，。.!！?？~～\-_/\\'"’“”&+]/g, '');
}

let _entities: KindData[] | null = null;
let _loading: Promise<void> | null = null;
let _dbReady = false;

async function indexDir(): Promise<string> {
  return await path.join(await path.appDataDir(), 'hpoi-index');
}
async function indexPath(kind: string): Promise<string> {
  return await path.join(await indexDir(), `${kind}.json`);
}

/** 只加载实体小组（hobby 走 Rust） */
async function loadEntities(): Promise<void> {
  if (_entities) return;
  if (_loading) return _loading;
  _loading = (async () => {
    const out: KindData[] = [];
    for (const kind of ENTITY_KINDS) {
      try {
        const p = await indexPath(kind);
        if (!(await fs.exists(p))) continue;
        const j = JSON.parse(await fs.readTextFile(p));
        if (j && Array.isArray(j.items)) out.push({ kind, items: j.items });
      } catch {
        // 单文件坏了不影响其它
      }
    }
    _entities = out;
  })();
  await _loading;
  _loading = null;
}

/** 确保索引可用：加载实体小组 + 触发 Rust 建库。返回是否有数据 */
export async function ensureHpoiIndexLoaded(): Promise<boolean> {
  await loadEntities();
  if (!_dbReady) {
    try {
      const counts =
        await invoke<{ kind: string; count: number }[]>('hpoi_counts');
      _dbReady = counts.some((c) => c.count > 0);
    } catch {
      _dbReady = false;
    }
  }
  return _dbReady || (_entities?.length ?? 0) > 0;
}

export function isHpoiIndexLoaded(): boolean {
  return _dbReady || _entities !== null;
}

export function hpoiIndexCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of _entities || []) out[d.kind] = d.items.length;
  return out;
}

export async function getHpoiIndexDir(): Promise<string> {
  return await indexDir();
}

export async function readHpoiIndexMeta(): Promise<{
  builtAt?: string;
  counts: Record<string, number>;
  maxId?: number;
  releaseRef?: string;
} | null> {
  try {
    const p = await path.join(await indexDir(), 'meta.json');
    if (!(await fs.exists(p))) return null;
    const j = JSON.parse(await fs.readTextFile(p));
    return {
      builtAt: j?.builtAt,
      counts: j?.counts || {},
      maxId: Number(j?.maxId) || undefined,
      releaseRef: j?.releaseRef || undefined,
    };
  } catch {
    return null;
  }
}

async function deltaPath(): Promise<string> {
  return await path.join(await indexDir(), 'delta.json');
}

export async function readHpoiDelta(): Promise<HpoiDelta | null> {
  try {
    const p = await deltaPath();
    if (!(await fs.exists(p))) return null;
    const j = JSON.parse(await fs.readTextFile(p));
    if (!j || typeof j !== 'object') return null;
    const arr = (x: any) => (Array.isArray(x) ? x : []);
    return {
      v: j.v ?? 1,
      at: j.at,
      maxId: j.maxId,
      hobbies: arr(j.hobbies),
      company: arr(j.company),
      series: arr(j.series),
      works: arr(j.works),
      charactar: arr(j.charactar),
      person: arr(j.person),
    };
  } catch {
    return null;
  }
}

export async function writeHpoiDelta(d: HpoiDelta): Promise<void> {
  const p = await deltaPath();
  await fs.writeTextFile(p, JSON.stringify(d));
}

/** 清空内存/DB 缓存（导入新索引后调用，下次搜索重新载入 + 重建 DB） */
export function resetHpoiIndex(): void {
  _entities = null;
  _loading = null;
  _dbReady = false;
  invoke('hpoi_db_reset').catch(() => undefined);
}

export async function importHpoiIndexZip(): Promise<string[] | null> {
  const src = await dialog.open({
    title: '导入 hpoi 离线索引包',
    multiple: false,
    filters: [{ name: '索引包 (zip)', extensions: ['zip'] }],
  });
  if (!src) return null;
  const dir = await indexDir();
  const files = await invoke<string[]>('import_hpoi_index', {
    destDir: dir,
    src: String(src),
  });
  resetHpoiIndex();
  await ensureHpoiIndexLoaded();
  return files;
}

/** 同步查一批实体名（实体小组已加载时；未命中返回空） */
export function getHpoiEntityNames(
  kind: HpoiSearchKind,
  ids: Set<number>,
): Map<number, string> {
  const out = new Map<number, string>();
  const d = _entities?.find((x) => x.kind === kind);
  if (!d) return out;
  for (const r of d.items) {
    if (ids.has(r[0]) && !out.has(r[0])) out.set(r[0], r[1] || '');
  }
  return out;
}

/** 同步查一批实体的「名称 + 封面」（实体小组已加载时） */
export function getHpoiEntityInfo(
  kind: HpoiSearchKind,
  ids: Set<number>,
): Map<number, { name: string; cover?: string }> {
  const out = new Map<number, { name: string; cover?: string }>();
  const d = _entities?.find((x) => x.kind === kind);
  if (!d) return out;
  for (const r of d.items) {
    if (ids.has(r[0]) && !out.has(r[0]))
      out.set(r[0], { name: r[1] || '', cover: r[2] || undefined });
  }
  return out;
}

/** 按 id 批量取搜索结果（保持传入顺序）。hobby 走 Rust，实体走内存 */
export async function getHpoiHitsByIds(
  kind: HpoiSearchKind,
  ids: number[],
): Promise<HpoiSearchHit[]> {
  if (ids.length === 0) return [];
  if (kind === 'hobby') {
    return invoke<HpoiSearchHit[]>('hpoi_hits_by_ids', { kind, ids });
  }
  const d = _entities?.find((x) => x.kind === kind);
  if (!d) return [];
  const want = new Set(ids);
  const byId = new Map<number, HpoiSearchHit>();
  for (const r of d.items) {
    if (want.has(r[0]) && !byId.has(r[0])) byId.set(r[0], rowToHit(kind, r));
  }
  return ids.map((id) => byId.get(id)).filter(Boolean) as HpoiSearchHit[];
}

/** 某词条的关联 refs（Rust） */
export async function getHpoiHobbyRefs(
  itemId: number,
): Promise<string[] | undefined> {
  const refs = await invoke<string[] | null>('hpoi_hobby_refs', { id: itemId });
  return refs || undefined;
}

/** 批量取 refs（返回 id→refs 映射） */
export async function getHpoiHobbyRefsBatch(
  ids: number[],
): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (ids.length === 0) return out;
  const rows = await invoke<[number, string[]][]>('hpoi_hobby_refs_batch', {
    ids,
  });
  for (const [id, refs] of rows) out.set(id, refs);
  return out;
}

function rowToHit(kind: HpoiSearchKind, row: any[]): HpoiSearchHit {
  if (kind === 'company') {
    return {
      kind,
      id: row[0],
      name: row[1] || '',
      cover: row[2] || undefined,
      filterId: row[3] || undefined,
      score: 0,
    };
  }
  return {
    kind,
    id: row[0],
    name: row[1] || '',
    cover: row[2] || undefined,
    score: 0,
  };
}

/** 本地索引搜索（Rust：子串 AND + 位置打分 + 类型权重） */
export async function searchHpoiIndex(
  query: string,
  limit = 80,
): Promise<HpoiSearchHit[]> {
  const ok = await ensureHpoiIndexLoaded();
  if (!ok) return [];
  const tokens = query.trim().split(/\s+/).map(normHpoi).filter(Boolean);
  if (tokens.length === 0) return [];
  return invoke<HpoiSearchHit[]>('hpoi_search', { tokens, limit });
}

/** 列出引用某实体的全部手办（Rust） */
export async function listHpoiHobbiesByRef(
  kind: 'company' | 'series' | 'works' | 'charactar' | 'person',
  id: number,
): Promise<HpoiSearchHit[]> {
  const ok = await ensureHpoiIndexLoaded();
  if (!ok) return [];
  return invoke<HpoiSearchHit[]>('hpoi_list_by_ref', { kind, id });
}
