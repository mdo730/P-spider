import { dialog, fs, invoke, path } from '@tauri-apps/api';

/**
 * hpoi 本地种子索引搜索。
 *
 * 索引由 `scripts/build-hpoi-index.mjs` 生成，位于 appDataDir/hpoi-index/<kind>.json
 * （条目为「数组的数组」，紧凑）。首次搜索时懒加载，之后常驻内存。
 *
 * ⚠️ 归一化函数必须与 build-hpoi-index.mjs 的 norm() 完全一致，否则搜不到。
 */

export type HpoiSearchKind =
  | 'hobby'
  | 'company'
  | 'series'
  | 'works'
  | 'charactar'
  | 'person';

const KINDS: HpoiSearchKind[] = [
  'hobby',
  'company',
  'series',
  'works',
  'charactar',
  'person',
];

export interface HpoiSearchHit {
  kind: HpoiSearchKind;
  id: number;
  /** 主名称（hobby 用中文名） */
  name: string;
  nameJa?: string;
  cover?: string;
  companyName?: string;
  category?: string;
  releaseDate?: string;
  filterId?: number;
  /** 排序用（hobby） */
  hits?: number;
  hitsDay?: number;
  hits7Day?: number;
  rating?: number;
  collect?: number;
  /** 关联实体 refs（如 `["c:25","h:3"]`，hobby） */
  refs?: string[];
  score: number;
}

interface KindData {
  kind: HpoiSearchKind;
  items: any[][];
}

/**
 * 增量数据（`hpoi-index/delta.json`）：主索引快照之后新增/补抓的条目。
 * 加载时并入主索引（按 id 去重，主索引优先），不修改 73MB 的主文件。
 */
export interface HpoiDelta {
  v: number;
  /** 上次同步时间戳 */
  at?: number;
  /** 已并入的最大 hobby id（判断新旧用） */
  maxId?: number;
  hobbies: any[][];
  company: any[][];
  series: any[][];
  works: any[][];
  charactar: any[][];
  person: any[][];
}

/** NFKC + 小写 + 去空白/标点/全角括号（与脚本一致） */
export function normHpoi(s: string): string {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[「」『』（）()[\]【】·・:：,，。.!！?？~～\-_/\\'"’“”&+]/g, '');
}

let loaded: KindData[] | null = null;
let loading: Promise<void> | null = null;

async function indexDir(): Promise<string> {
  return await path.join(await path.appDataDir(), 'hpoi-index');
}

async function indexPath(kind: string): Promise<string> {
  return await path.join(await indexDir(), `${kind}.json`);
}

/** 当前已载入的索引（读时断言，规避 TS 把闭包外收窄成 null） */
function current(): KindData[] | null {
  return loaded as KindData[] | null;
}

/** 载入索引（懒加载）；返回是否有数据 */
export async function ensureHpoiIndexLoaded(): Promise<boolean> {
  if (current()) return current()!.length > 0;
  if (loading) {
    await loading;
    return (current()?.length ?? 0) > 0;
  }
  loading = (async () => {
    const out: KindData[] = [];
    for (const kind of KINDS) {
      try {
        const p = await indexPath(kind);
        if (!(await fs.exists(p))) continue;
        const j = JSON.parse(await fs.readTextFile(p));
        if (j && Array.isArray(j.items)) out.push({ kind, items: j.items });
      } catch {
        // 单个文件坏了不影响其它
      }
    }
    // 并入增量（delta.json）：新条目/兜底补齐
    const delta = await readHpoiDelta();
    if (delta) {
      const byKind = new Map(out.map((d) => [d.kind, d]));
      const mergeRows = (kind: HpoiSearchKind, rows: any[][]) => {
        if (!rows.length) return;
        const d = byKind.get(kind);
        if (!d) {
          out.push({ kind, items: rows.slice() });
          return;
        }
        const seen = new Set(d.items.map((r) => r[0]));
        for (const r of rows) {
          if (!seen.has(r[0])) {
            d.items.push(r);
            seen.add(r[0]);
          }
        }
      };
      mergeRows('hobby', delta.hobbies);
      mergeRows('company', delta.company);
      mergeRows('series', delta.series);
      mergeRows('works', delta.works);
      mergeRows('charactar', delta.charactar);
      mergeRows('person', delta.person);
    }
    loaded = out;
  })();
  await loading;
  loading = null;
  return (current()?.length ?? 0) > 0;
}

export function isHpoiIndexLoaded(): boolean {
  return current() !== null;
}

export function hpoiIndexCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of current() || []) out[d.kind] = d.items.length;
  return out;
}

/** 索引目录（appDataDir/hpoi-index） */
export async function getHpoiIndexDir(): Promise<string> {
  return await indexDir();
}

/** 读取索引元信息（小文件 meta.json，不加载大索引）；未安装返回 null */
export async function readHpoiIndexMeta(): Promise<{
  builtAt?: string;
  counts: Record<string, number>;
  /** 主索引里最大的 hobby id（增量判断新旧） */
  maxId?: number;
  /** 发售基准日（YYYY-MM-DD，增量算 releaseDate 用） */
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

/** 读取增量文件（不存在返回 null） */
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

/** 写入增量文件 */
export async function writeHpoiDelta(d: HpoiDelta): Promise<void> {
  const p = await deltaPath();
  await fs.writeTextFile(p, JSON.stringify(d));
}

/** 清空内存中的索引（导入新索引后调用，下次搜索重新载入） */
export function resetHpoiIndex(): void {
  loaded = null;
  loading = null;
}

/** 弹出选择框，从可选索引包(.zip)导入到 appDataDir/hpoi-index；取消返回 null */
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

/** 同步查一批实体名（索引已加载时；未命中返回空） */
export function getHpoiEntityNames(
  kind: HpoiSearchKind,
  ids: Set<number>,
): Map<number, string> {
  const out = new Map<number, string>();
  const d = current()?.find((x) => x.kind === kind);
  if (!d) return out;
  for (const r of d.items) {
    if (ids.has(r[0]) && !out.has(r[0])) out.set(r[0], r[1] || '');
  }
  return out;
}

/** 同步查一批实体的「名称 + 封面」（索引已加载时） */
export function getHpoiEntityInfo(
  kind: HpoiSearchKind,
  ids: Set<number>,
): Map<number, { name: string; cover?: string }> {
  const out = new Map<number, { name: string; cover?: string }>();
  const d = current()?.find((x) => x.kind === kind);
  if (!d) return out;
  for (const r of d.items) {
    if (ids.has(r[0]) && !out.has(r[0]))
      out.set(r[0], { name: r[1] || '', cover: r[2] || undefined });
  }
  return out;
}

/** 按 id 批量取搜索结果（索引已加载时），保持传入顺序 */
export function getHpoiHitsByIds(
  kind: HpoiSearchKind,
  ids: number[],
): HpoiSearchHit[] {
  const d = current()?.find((x) => x.kind === kind);
  if (!d) return [];
  const want = new Set(ids);
  const byId = new Map<number, HpoiSearchHit>();
  for (const r of d.items) {
    if (want.has(r[0]) && !byId.has(r[0])) byId.set(r[0], rowToHit(kind, r));
  }
  return ids.map((id) => byId.get(id)).filter(Boolean) as HpoiSearchHit[];
}

/** 某词条的关联 refs（如 `["c:45","h:3"]`；索引已加载时） */
export function getHpoiHobbyRefs(itemId: number): string[] | undefined {
  const d = current()?.find((x) => x.kind === 'hobby');
  if (!d) return undefined;
  const row = d.items.find((r) => r[0] === itemId);
  return row && Array.isArray(row[7]) ? row[7] : undefined;
}

function rowToHit(kind: HpoiSearchKind, row: any[]): HpoiSearchHit {
  if (kind === 'hobby') {
    return {
      kind,
      id: row[0],
      name: row[1] || '',
      nameJa: row[2] || undefined,
      companyName: row[3] || undefined,
      category: row[4] || undefined,
      cover: row[5] || undefined,
      releaseDate: row[6] || undefined,
      hits: row[9] || 0,
      hitsDay: row[10] || 0,
      hits7Day: row[11] || 0,
      rating: row[12] || 0,
      collect: row[13] || 0,
      refs: Array.isArray(row[7]) ? row[7] : undefined,
      score: 0,
    };
  }
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

function rowNorm(kind: HpoiSearchKind, row: any[]): string {
  if (kind === 'hobby') return row[8] || '';
  if (kind === 'company') return row[4] || '';
  return row[3] || '';
}

/** 本地索引搜索（多词 AND；完全匹配/前缀/命中位置加权 + 类型权重） */
export async function searchHpoiIndex(
  query: string,
  limit = 80,
): Promise<HpoiSearchHit[]> {
  const ok = await ensureHpoiIndexLoaded();
  if (!ok) return [];
  const tokens = query.trim().split(/\s+/).map(normHpoi).filter(Boolean);
  if (tokens.length === 0) return [];

  const hits: HpoiSearchHit[] = [];
  for (const { kind, items } of current()!) {
    const kindWeight = kind === 'hobby' ? 3 : kind === 'company' ? 2 : 1;
    for (const row of items) {
      const hay = rowNorm(kind, row);
      if (!hay) continue;
      let score = 0;
      let all = true;
      for (const t of tokens) {
        const idx = hay.indexOf(t);
        if (idx < 0) {
          all = false;
          break;
        }
        score += idx === 0 ? 3 : 1;
      }
      if (!all) continue;
      const nameNorm = normHpoi(row[1] || '');
      if (tokens.length === 1 && nameNorm === tokens[0]) score += 6;
      else if (nameNorm.startsWith(tokens[0])) score += 2;
      const hit = rowToHit(kind, row);
      hit.score = score + kindWeight;
      hits.push(hit);
    }
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')),
  );
  return hits.slice(0, limit);
}

const REF_TAG: Record<
  'company' | 'series' | 'works' | 'charactar' | 'person',
  string
> = { company: 'c', series: 's', works: 'w', charactar: 'h', person: 'p' };

/**
 * 列出引用某实体（厂商 / 系列 / 作品 / 角色 / 原型）的全部手办。
 * 纯本地种子（按 hobby 的 refs 过滤），离线、完整；未安装索引返回 []。
 */
export async function listHpoiHobbiesByRef(
  kind: 'company' | 'series' | 'works' | 'charactar' | 'person',
  id: number,
): Promise<HpoiSearchHit[]> {
  const ok = await ensureHpoiIndexLoaded();
  if (!ok) return [];
  const tag = `${REF_TAG[kind]}:${id}`;
  const out: HpoiSearchHit[] = [];
  for (const { kind: k, items } of current()!) {
    if (k !== 'hobby') continue;
    for (const row of items) {
      const refs = row[7];
      if (Array.isArray(refs) && refs.includes(tag))
        out.push(rowToHit('hobby', row));
    }
  }
  return out;
}
