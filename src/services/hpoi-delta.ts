import { request } from '../ipc/network';
import {
  HpoiDelta,
  normHpoi,
  readHpoiDelta,
  readHpoiIndexMeta,
  resetHpoiIndex,
  writeHpoiDelta,
} from './hpoi-search';

/**
 * hpoi 增量补齐：主索引快照之后新增的词条。
 *
 * 做法：用 `query-v2` 的 `order=add`（最新在前）按分类从第 1 页往回翻，
 * 把 `itemId > 本地最大 id` 的条目解析成与 `build-hpoi-index.mjs` **完全同格式**的行，
 * 追加进 `hpoi-index/delta.json`；搜索/实体页加载时与主索引合并去重。
 * 遇到「本页最小 id ≤ 最大 id」即认为翻到已知区间，停止该类翻页。
 *
 * 这样无论隔多久（哪怕几个月），新增条目都能一次补齐，且字段与主索引一致
 * （含 series、热度、均分、发售日）。
 */

const SITE = 'https://www.hpoi.net';
const CATS = [100, 200, 300, 400, 500];
const PAGE_SIZE = 200;
const PAGE_CAP = 100;
const DELAY_MS = 350;
/** 自动同步最小间隔（12h） */
export const AUTO_SYNC_MIN_MS = 12 * 3600 * 1000;

const REF_CODE: Record<string, string> = {
  company: 'c',
  series: 's',
  works: 'w',
  charactar: 'h',
  person: 'p',
};
const ENT_KINDS = [
  'company',
  'series',
  'works',
  'charactar',
  'person',
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function coverUrl(cover?: string): string {
  if (!cover) return '';
  return /^https?:/i.test(cover)
    ? cover
    : `https://rfx.hpoi.net/gk/cover/s/${cover}`;
}

async function apiQueryV2(category: number, page: number): Promise<any[]> {
  const body = new URLSearchParams({
    category: String(category),
    order: 'add',
    page: String(page),
    pageSize: String(PAGE_SIZE),
  }).toString();
  const res = await request({
    method: 'POST',
    responseType: 'json',
    url: `${SITE}/api/hobby/query-v2`,
    headers: {
      'User-Agent': 'hpoi/android',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    bypassProxy: true,
    maxRetry: 1,
  });
  const j = res.body as any;
  if (res.status >= 400 || (j && j.success === false)) {
    throw new Error(`hpoi query-v2 失败 status=${res.status}`);
  }
  return j?.data?.list || [];
}

interface RefRow {
  type: string;
  id: number;
  name: string;
  cover?: string;
}

/** 单条 query-v2 条目 → 索引 hobby 行（14 列，格式同 build-hpoi-index.mjs） */
function buildHobbyRow(
  it: any,
  refDate: Date | null,
): { row: any[]; refs: RefRow[] } {
  let namesObj: any = {};
  try {
    namesObj = JSON.parse(it.names || '{}');
  } catch {
    namesObj = {};
  }
  const nameList = Object.values(namesObj)
    .flat()
    .filter((v): v is string => typeof v === 'string' && !!v);
  const aliases = Array.from(
    new Set(
      [
        ...(Array.isArray(it.appendWord) ? it.appendWord : []),
        ...nameList,
        it.name_ja,
        it.name_en,
        it.name,
      ].filter((v) => typeof v === 'string' && v),
    ),
  );

  const refs: RefRow[] = [];
  const refCodes: string[] = [];
  for (const w of it.working || []) {
    for (const wk of w.workers || []) {
      if (!wk?.itemId || !wk?.itemType || !REF_CODE[wk.itemType]) continue;
      const name = wk.nameCN || wk.name || '';
      refs.push({
        type: wk.itemType,
        id: wk.itemId,
        name,
        cover: coverUrl(wk.cover),
      });
      refCodes.push(`${REF_CODE[wk.itemType]}:${wk.itemId}`);
    }
  }

  const norm = normHpoi(
    [
      it.nameCN,
      it.name_ja,
      ...aliases,
      it.companyName,
      ...refs.map((r) => r.name),
    ].join(' '),
  );

  let releaseDate: string | undefined;
  if (refDate) {
    const rd = Number(it.releaseDays);
    if (rd) {
      const d = new Date(refDate.getTime());
      d.setUTCDate(d.getUTCDate() - rd);
      releaseDate = d.toISOString().slice(0, 10);
    }
  }

  const ratingCount = Number(it.ratingCount) || 0;
  const row = [
    it.itemId,
    it.nameCN || it.name || '',
    it.name_ja || '',
    it.companyName || '',
    (it.category && it.category.name) || '',
    coverUrl(it.cover),
    releaseDate || '',
    Array.from(new Set(refCodes)),
    norm,
    Number(it.hits) || 0,
    Number(it.hitsDay) || 0,
    Number(it.hits7Day) || 0,
    ratingCount > 0 ? Number((Number(it.rating) / ratingCount).toFixed(2)) : 0,
    Number(it.collect) || 0,
  ];
  return { row, refs };
}

/** 实体行（格式同 build-hpoi-index.mjs） */
function entityRow(type: string, r: RefRow): any[] {
  const n = normHpoi(r.name);
  if (type === 'company') return [r.id, r.name, r.cover || '', 0, n];
  return [r.id, r.name, r.cover || '', n];
}

export interface HpoiSyncResult {
  added: number;
  pages: number;
  maxId: number;
  /** 未安装主索引 / 距上次同步太近而跳过 */
  skipped?: boolean;
}

/**
 * 增量补齐新增词条。
 * `force=false` 时若距上次同步 < AUTO_SYNC_MIN_MS 则跳过。
 */
export async function syncHpoiIncremental(
  force = false,
): Promise<HpoiSyncResult> {
  const meta = await readHpoiIndexMeta();
  if (!meta) return { added: 0, pages: 0, maxId: 0, skipped: true };

  const delta: HpoiDelta = (await readHpoiDelta()) || {
    v: 1,
    hobbies: [],
    company: [],
    series: [],
    works: [],
    charactar: [],
    person: [],
  };

  const baseMax = Number(meta.maxId) || 0;
  const maxId = Math.max(baseMax, Number(delta.maxId) || 0);

  if (!force && delta.at && Date.now() - delta.at < AUTO_SYNC_MIN_MS) {
    return { added: 0, pages: 0, maxId, skipped: true };
  }

  const refDate = meta.releaseRef
    ? new Date(`${meta.releaseRef}T00:00:00Z`)
    : null;

  const seenHobby = new Set<number>(delta.hobbies.map((r) => r[0]));
  const entSeen: Record<string, Set<number>> = {};
  for (const k of ENT_KINDS) {
    entSeen[k] = new Set((delta[k] as any[][]).map((r) => r[0]));
  }

  let added = 0;
  let pages = 0;
  let maxSeen = maxId;

  for (const cat of CATS) {
    for (let page = 1; page <= PAGE_CAP; page++) {
      let list: any[];
      try {
        list = await apiQueryV2(cat, page);
      } catch {
        break;
      }
      pages++;
      if (list.length === 0) break;

      let oldest = Infinity;
      for (const it of list) {
        oldest = Math.min(oldest, it.itemId);
        maxSeen = Math.max(maxSeen, it.itemId);
        if (it.itemId <= maxId || seenHobby.has(it.itemId)) continue;
        const { row, refs } = buildHobbyRow(it, refDate);
        delta.hobbies.push(row);
        seenHobby.add(it.itemId);
        added++;
        for (const r of refs) {
          const s = entSeen[r.type];
          if (s && !s.has(r.id)) {
            s.add(r.id);
            ((delta as any)[r.type] as any[][]).push(entityRow(r.type, r));
          }
        }
      }

      if (oldest <= maxId) break; // 翻到已知区间
      if (list.length < PAGE_SIZE) break;
      await sleep(DELAY_MS);
    }
  }

  delta.at = Date.now();
  delta.maxId = maxSeen;
  await writeHpoiDelta(delta);
  if (added > 0) resetHpoiIndex();
  return { added, pages, maxId: maxSeen };
}
