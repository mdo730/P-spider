#!/usr/bin/env node
/**
 * hpoi 全量种子构建脚本（独立运行，不经 P-Spider）
 *
 * 用途：从 hpoi 的 **sitemap**（robots 明确允许）拿全量 id，再逐页抓元数据，落 JSONL 种子，
 *       供 P-Spider 离线秒开 / 减少请求。
 *
 * 用法（在仓库根目录）：
 *   node scripts/build-hpoi-seed.mjs --types company,series
 *   node scripts/build-hpoi-seed.mjs                 # 全部类型（hobby 约 13 万，很慢！）
 *   node scripts/build-hpoi-seed.mjs --types hobby --delay 800 --concurrency 1
 *   node scripts/build-hpoi-seed.mjs --ids-only      # 只落 sitemap id，不抓页面（秒完）
 *   node scripts/build-hpoi-seed.mjs --cookie "utoken=UTK..."   # 带登录（R18 用）
 *
 * 选项：
 *   --types a,b,c     company,series,hobby,works,charactar,person（默认全部）
 *   --out <dir>       输出目录（默认 ./hpoi-seed）
 *   --delay <ms>      两次请求最小间隔（默认 500）
 *   --concurrency <n> 并发（默认 1；建议 1~2）
 *   --max <n>         每类型最多处理 n 条（调试用）
 *   --ids-only        只从 sitemap 提取 id，不抓页面
 *   --cookie <str>    请求带 Cookie（如 utoken=...）
 *   --timeout <ms>    单请求超时（默认 20000）
 *   --pause-on-ban <min>  疑似被限流/封禁时暂停分钟（默认 5，0=不暂停）
 *
 * Clash 联动（配合 get-all-seed-proxy.cmd / NODE_USE_ENV_PROXY=1 + HTTPS_PROXY）：
 *   --clash <url>         外部控制地址（默认环境变量 CLASH_URL）
 *   --clash-secret <s>    secret（或 CLASH_SECRET）
 *   --clash-group <name>  切换的代理组（默认 GLOBAL）
 *   遇 429/403/连接失败累计 3 次 → 切到组内下一个节点并暂停 N 分钟
 *
 * 输出（每类一个 JSONL，可断点续跑：已存在的 id 会跳过）：
 *   hpoi-seed/company.jsonl    { id, name, cover, filterId, lastmod, url }
 *   hpoi-seed/series.jsonl     { id, name, cover, lastmod, url }
 *   hpoi-seed/hobby.jsonl      { id, nameCN, nameJa, cover, companyName, category, scale, price, releaseDate, refs:[{type,id,name,field}], lastmod, url }
 *   hpoi-seed/works.jsonl      { id, name, cover, lastmod, url }
 *   hpoi-seed/charactar.jsonl  { id, name, cover, lastmod, url }
 *   hpoi-seed/person.jsonl     { id, name, cover, lastmod, url }
 *   hpoi-seed/_ids/<type>.txt  纯 id 列表（含 lastmod）
 *   hpoi-seed/_errors.jsonl    失败记录
 */

import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const SITE = 'https://www.hpoi.net';
const SITEMAP_INDEX = `${SITE}/sitemap.xml`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const ALL_TYPES = ['company', 'series', 'hobby', 'works', 'charactar', 'person'];

// ---------------- args ----------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(args.out || 'hpoi-seed');
const TYPES = String(args.types || ALL_TYPES.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((t) => ALL_TYPES.includes(t));
const DELAY = Number(args.delay ?? 500);
const CONC = Math.max(1, Number(args.concurrency ?? 1));
const MAX = args.max ? Number(args.max) : Infinity;
const IDS_ONLY = !!args['ids-only'];
const COOKIE = args.cookie || process.env.HPOI_COOKIE || '';
const TIMEOUT = Number(args.timeout ?? 20000);

if (TYPES.length === 0) {
  console.error('没有有效类型。可选：' + ALL_TYPES.join(','));
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, '_ids'), { recursive: true });

// ---------------- Clash 联动（外部控制 API 切节点） ----------------
const CLASH_URL = process.env.CLASH_URL || args.clash || '';
const CLASH_SECRET = process.env.CLASH_SECRET || args['clash-secret'] || '';
const CLASH_GROUP = process.env.CLASH_GROUP || args['clash-group'] || 'GLOBAL';
let clashNodes = null;
let clashIdx = -1;
let blockStreak = 0;

async function clashApi(path, method = 'GET', body) {
  const headers = {};
  if (CLASH_SECRET) headers.Authorization = `Bearer ${CLASH_SECRET}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${CLASH_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`clash HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

/** 依次切到组里的下一个节点（避开 DIRECT/REJECT） */
async function rotateClashNode() {
  if (!CLASH_URL) return false;
  try {
    if (!clashNodes) {
      const data = await clashApi('/proxies');
      const g = data?.proxies?.[CLASH_GROUP];
      const all = (g?.all || []).filter(
        (n) => !/DIRECT|REJECT|PASS|COMPATIBLE|GLOBAL/i.test(n),
      );
      if (all.length === 0) {
        console.error(`   [clash] 组「${CLASH_GROUP}」没找到可用节点`);
        return false;
      }
      clashNodes = all;
      clashIdx = Math.max(0, all.indexOf(g.now));
    }
    clashIdx = (clashIdx + 1) % clashNodes.length;
    const name = clashNodes[clashIdx];
    await clashApi(`/proxies/${encodeURIComponent(CLASH_GROUP)}`, 'PUT', {
      name,
    });
    console.error(`   [clash] 切换节点 → ${name}`);
    return true;
  } catch (e) {
    console.error('   [clash] 切换失败：', e?.message || e);
    clashNodes = null;
    return false;
  }
}

/** 疑似被封时暂停的分钟数（--pause-on-ban / PAUSE_ON_BAN_MIN，默认 5） */
const PAUSE_ON_BAN_MIN = Number(
  process.env.PAUSE_ON_BAN_MIN ?? args['pause-on-ban'] ?? 5,
);

/** 累计被限流/失败次数，达阈值则切节点（若有）并暂停 N 分钟 */
async function maybeRotate() {
  blockStreak++;
  if (blockStreak < 3) return;
  blockStreak = 0;
  if (CLASH_URL) await rotateClashNode();
  if (PAUSE_ON_BAN_MIN > 0) {
    const ms = PAUSE_ON_BAN_MIN * 60 * 1000;
    console.error(
      `   [ban] 疑似被限流/封禁，暂停 ${PAUSE_ON_BAN_MIN} 分钟后再试…`,
    );
    await sleep(ms);
    console.error('   [ban] 恢复');
  } else {
    await sleep(2500);
  }
}

// ---------------- http（超时 + 429/403/5xx 退避重试 + 全局限速） ----------------
let lastAt = 0;
async function pacedFetch(url, tries = 4) {
  // 全局最小间隔（串行化发起时间）
  const wait = lastAt + DELAY - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();

  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'zh-CN',
          ...(COOKIE ? { Cookie: COOKIE } : {}),
        },
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status === 403) {
        await maybeRotate();
        const backoff = 1500 * (i + 1) + Math.floor(Math.random() * 800);
        console.error(`    [retry ${i + 1}/${tries}] HTTP ${res.status} → ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      if (res.status >= 500) {
        const backoff = 1500 * (i + 1) + Math.floor(Math.random() * 800);
        console.error(`    [retry ${i + 1}/${tries}] HTTP ${res.status} → ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blockStreak = 0; // 成功即清零
      return await res.text();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      await maybeRotate();
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr || new Error('fetch failed');
}

// ---------------- sitemap ----------------
async function loadShards() {
  const xml = await pacedFetch(SITEMAP_INDEX);
  const map = new Map(); // type -> [shardUrl]
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const sm = m[1].match(/\/sitemap\/([a-z]+)\/\d+\.xml$/);
    if (!sm) continue;
    if (!map.has(sm[1])) map.set(sm[1], []);
    map.get(sm[1]).push(m[1]);
  }
  return map;
}

async function collectIds(type, shards) {
  const idsFile = path.join(OUT, '_ids', `${type}.txt`);
  if (fs.existsSync(idsFile)) {
    return fs
      .readFileSync(idsFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [id, lastmod] = l.split('\t');
        return { id: Number(id), lastmod };
      });
  }
  const out = [];
  const seen = new Set();
  for (const shard of shards) {
    process.stdout.write(`  拉取 sitemap ${path.basename(shard)} ... `);
    const xml = await pacedFetch(shard);
    let n = 0;
    for (const block of xml.split('<url>').slice(1)) {
      const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
      if (!loc) continue;
      const idm = loc.match(/\/(\d+)\/?$/);
      if (!idm) continue;
      const id = Number(idm[1]);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, lastmod: block.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1] || '' });
      n++;
    }
    console.log(`${n} 条（累计 ${out.length}）`);
  }
  fs.writeFileSync(idsFile, out.map((o) => `${o.id}\t${o.lastmod || ''}`).join('\n'), 'utf8');
  return out;
}

// ---------------- 解析 ----------------
function stripTitle(html) {
  const t = html.match(/<title>([^<]*)<\/title>/)?.[1] || '';
  return t.split('|')[0].trim();
}
function ogImage(html) {
  return (
    html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/)?.[1] ||
    html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/)?.[1] ||
    undefined
  );
}
function extractProduct(html) {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    let j;
    try {
      j = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const cands = [j, j?.mainEntity, ...(Array.isArray(j?.['@graph']) ? j['@graph'] : [])];
    for (const c of cands) if (c && c['@type'] === 'Product') return c;
  }
  return null;
}
function parseSpecs(desc) {
  const out = {};
  for (const part of String(desc || '').split(/[,，]/)) {
    const m = part.match(/([^:：]+)[:：]\s*(.+)/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}
function decodeHtml(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
/** 词条页「关联资料」里的类型链接（厂商/作品/角色/原型…）→ 归属关系 */
function parseInfoRefs(html) {
  const refs = [];
  for (const block of html.split('hpoi-infoList-item').slice(1)) {
    const field = block.match(/<span>([^<]+)<\/span>/)?.[1]?.trim();
    if (!field) continue;
    const re = /href="(company|works|charactar|person)\/(\d+)"[^>]*>([^<]+)<\/a>/g;
    let m;
    while ((m = re.exec(block))) {
      refs.push({
        type: m[1],
        id: Number(m[2]),
        name: decodeHtml(m[3].trim()),
        field,
      });
    }
  }
  return refs;
}
function parseEntity(html) {
  const info = {};
  // 形式一（company/series）：<div class="item-info"><span>键：</span><span>值</span></div>
  const pickVal = (raw) => {
    const href = raw.match(/href="([^"]+)"/)?.[1];
    return href || decodeHtml(raw.replace(/<[^>]+>/g, '').trim());
  };
  for (const m of html.matchAll(
    /<div class="item-info">\s*<span>([^<]*)<\/span>\s*<span>([\s\S]*?)<\/span>\s*<\/div>/g,
  )) {
    const key = m[1].replace(/[:：]\s*$/, '').trim();
    if (key) info[key] = pickVal(m[2]);
  }
  // 形式二（works/person/charactar「更多信息」）：<li class="item-more"><span>键：</span>值</li>
  for (const m of html.matchAll(
    /<li class="item-more">\s*<span>([^<]*)<\/span>([\s\S]*?)<\/li>/g,
  )) {
    const key = m[1].replace(/[:：]\s*$/, '').trim();
    if (key && !(key in info)) info[key] = pickVal(m[2]);
  }
  const aliases = (info['别名'] || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const name = info['中文名'] || info['名称'] || stripTitle(html);
  return {
    name,
    nameOriginal: info['名称'] || '',
    aliases,
    cover: ogImage(html),
    info,
  };
}
function parseCompany(html) {
  const base = parseEntity(html);
  const fid = html.match(/hobby\/all\?[^"']*?company=(\d+)/)?.[1];
  return { ...base, filterId: fid ? Number(fid) : undefined };
}
/** 截取第一个平衡的 JSON 对象并解析（页面内嵌数据是 entity 编码 + 可能尾随） */
function firstJsonObject(s) {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 词条页内嵌的 fn_share JSON（含热度/评分/收藏/规格/多语言名等） */
function parseFnShare(html) {
  const m = html.match(/fn_share\.init\('([\s\S]*?)'\);/);
  if (!m) return {};
  return firstJsonObject(decodeHtml(m[1])) || {};
}

function parseHobby(html) {
  const refs = parseInfoRefs(html);
  const share = parseFnShare(html);
  const prod = extractProduct(html);
  // 多语言名（name_zh / name_ja / name_en / name_ko）
  const names = [];
  try {
    const n = JSON.parse(share.names || '{}');
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) names.push(...v);
    }
  } catch {
    /* ignore */
  }
  const alt = Array.isArray(prod?.alternateName)
    ? prod.alternateName
    : prod?.alternateName
      ? [prod.alternateName]
      : [];
  const aliases = Array.from(
    new Set([...alt, ...names, share.name_ja].filter(Boolean)),
  );
  const specs = parseSpecs(prod?.description || '');
  const specsMap = {};
  if (Array.isArray(share.otherInfo)) {
    for (const o of share.otherInfo) {
      if (o?.key) specsMap[o.key] = o.value;
    }
  }
  const specTags = Array.isArray(share.specTags)
    ? share.specTags.map((t) => t?.nameCN || t?.name).filter(Boolean)
    : [];
  return {
    nameCN: prod?.name || share.nameCN || share.name || stripTitle(html),
    nameJa:
      share.name_ja ||
      alt.find((s) => /[\u3040-\u30ff]/.test(s)) ||
      undefined,
    aliases,
    cover: prod?.image || ogImage(html),
    companyName: prod?.manufacturer?.name || share.companyName || '',
    category: prod?.category || share.category?.name || undefined,
    scale: specs['比例'] || undefined,
    price:
      prod?.offers?.price != null
        ? Number(prod.offers.price)
        : share.money || undefined,
    currency: share.currency || undefined,
    releaseDate:
      prod?.releaseDate ||
      (share.releaseDate ? String(share.releaseDate).slice(0, 10) : undefined),
    // 内嵌 JSON 的附加字段
    hits: share.hits,
    hitsDay: share.hitsDay,
    hits7Day: share.hits7Day,
    rating: share.rating,
    ratingCount: share.ratingCount,
    collect: share.collect,
    commentCount: share.commentCount,
    r18: share.r18,
    sex: share.sex,
    specTags,
    size: specsMap['尺寸'] || undefined,
    material: specsMap['材质'] || undefined,
    // 归属关系：word 的 {type,id,name,field}（可反查 厂商/作品/角色/原型 → 词条）
    refs,
  };
}

const PATH_OF = {
  company: 'company',
  series: 'series',
  hobby: 'hobby',
  works: 'works',
  charactar: 'charactar',
  person: 'person',
};

// ---------------- 最新入库（增量用） ----------------
/** 抓 hpoi 首页「最新入库」的词条 id（#hpoi-dataBase-Box-List，约 12 条） */
async function fetchLatestHobbyIds() {
  const html = await pacedFetch('https://www.hpoi.net/hobby/');
  const at = html.indexOf('hpoi-dataBase-Box-List');
  const scope = at >= 0 ? html.slice(at, at + 8000) : html;
  const ids = [];
  for (const m of scope.matchAll(/href="hobby\/(\d+)"/g)) {
    const id = Number(m[1]);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

// ---------------- API 分页枚举模式（--via-api）：请求量降 ~100 倍 ----------------
function coverUrl(cover) {
  if (!cover) return '';
  return /^https?:/i.test(cover)
    ? cover
    : `https://rfx.hpoi.net/gk/cover/s/${cover}`;
}

async function apiPost(pathname, form) {
  const body = new URLSearchParams(
    Object.entries(form).map(([k, v]) => [k, String(v)]),
  ).toString();
  const res = await fetch(`https://www.hpoi.net/api${pathname}`, {
    method: 'POST',
    headers: {
      'User-Agent': 'hpoi/android',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j && j.success === false) throw new Error(j.msg || 'api error');
  return j?.data ?? {};
}

/** 手办详情页 JSON-LD 的 releaseDate（用于校准 releaseDays 基准日） */
async function fetchHobbyReleaseDate(id) {
  const res = await fetch(`${SITE}/hobby/${id}`, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN',
      Referer: `${SITE}/`,
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m =
    html.match(/"releaseDate"\s*:\s*"([^"]+)"/) ||
    html.match(/"datePublished"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

/**
 * query-v2 的 releaseDays = 「基准日 R − 发售日」的天数（已发售为正、未发售为负，0=未知）。
 * 取几条有 releaseDays 的热门手办，抓明细页得真实发售日，反推 R（releaseDate + releaseDays），
 * 取中位数作为基准日。返回 UTC 零点 Date 或 null。
 */
async function calibrateReleaseRef() {
  const data = await apiPost('/hobby/query-v2', {
    category: 100,
    order: 'hits',
    page: 1,
    pageSize: 20,
  });
  const cands = (data.list || []).filter((it) => it.releaseDays);
  const ms = [];
  for (const it of cands.slice(0, 5)) {
    try {
      const rel = await fetchHobbyReleaseDate(it.itemId);
      if (!rel) continue;
      const d = new Date(rel + 'T00:00:00Z');
      if (Number.isNaN(d.getTime())) continue;
      d.setUTCDate(d.getUTCDate() + Number(it.releaseDays));
      ms.push(d.getTime());
    } catch {
      /* ignore */
    }
    await sleep(300);
  }
  if (!ms.length) return null;
  ms.sort((a, b) => a - b);
  return new Date(ms[Math.floor(ms.length / 2)]);
}

async function runApiSeed() {
  const CATS = [
    [100, '手办'],
    [200, '动漫模型'],
    [300, 'Doll娃娃'],
    [400, '毛绒布偶'],
    [500, '真实模型'],
  ];
  const files = {};
  for (const k of ['hobby', 'company', 'series', 'works', 'charactar', 'person']) {
    const p = path.join(OUT, `${k}.jsonl`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    files[k] = p;
  }
  const ents = {
    company: new Map(),
    series: new Map(),
    works: new Map(),
    charactar: new Map(),
    person: new Map(),
  };
  let total = 0;
  let reqs = 0;

  const refDate = await calibrateReleaseRef();
  if (refDate) {
    const iso = refDate.toISOString().slice(0, 10);
    fs.writeFileSync(path.join(OUT, '_release_ref.txt'), iso);
    console.log(`  发售基准日 R = ${iso}`);
  } else {
    console.log('  ⚠️ 未能校准发售基准日，releaseDate 将省略');
  }

  for (const [cat, catName] of CATS) {
    for (let page = 1; ; page++) {
      let data;
      try {
        data = await apiPost('/hobby/query-v2', {
          category: cat,
          order: 'add',
          page,
          pageSize: 200,
        });
      } catch (e) {
        console.error(`  api err cat=${cat} page=${page}: ${e.message}，5s 后重试`);
        await sleep(5000);
        page--;
        continue;
      }
      reqs++;
      const list = data.list || [];
      if (list.length === 0) break;
      for (const it of list) {
        let namesObj = {};
        try {
          namesObj = JSON.parse(it.names || '{}');
        } catch {
          /* ignore */
        }
        const nameList = Object.values(namesObj).flat().filter(Boolean);
        const aliases = Array.from(
          new Set(
            [
              ...(Array.isArray(it.appendWord) ? it.appendWord : []),
              ...nameList,
              it.name_ja,
              it.name_en,
              it.name,
            ].filter(Boolean),
          ),
        );
        const refs = [];
        for (const w of it.working || []) {
          for (const wk of w.workers || []) {
            if (!wk?.itemId || !wk?.itemType) continue;
            refs.push({
              type: wk.itemType,
              id: wk.itemId,
              name: wk.nameCN || wk.name || '',
              field: w.job?.jobName || '',
            });
            const m = ents[wk.itemType];
            if (m && !m.get(wk.itemId)) {
              m.set(wk.itemId, {
                id: wk.itemId,
                name: wk.nameCN || wk.name || '',
                nameOriginal: wk.name || '',
                cover: coverUrl(wk.cover),
                lastmod: '',
                url: `https://www.hpoi.net/${wk.itemType}/${wk.itemId}`,
              });
            }
          }
        }
        let releaseDate;
        if (refDate) {
          const rd = Number(it.releaseDays);
          if (rd) {
            const d = new Date(refDate.getTime());
            d.setUTCDate(d.getUTCDate() - rd);
            releaseDate = d.toISOString().slice(0, 10);
          }
        }
        fs.appendFileSync(
          files.hobby,
          JSON.stringify({
            id: it.itemId,
            nameCN: it.nameCN || it.name || '',
            nameJa: it.name_ja || undefined,
            aliases,
            cover: coverUrl(it.cover),
            companyName: it.companyName || '',
            category: (it.category && it.category.name) || catName,
            releaseDate,
            releaseDays: it.releaseDays || undefined,
            scale: it.scale != null ? String(it.scale) : undefined,
            price: it.money || undefined,
            currency: it.currency || undefined,
            hits: it.hits,
            hitsDay: it.hitsDay,
            hits7Day: it.hits7Day,
            rating: it.rating,
            ratingCount: it.ratingCount,
            collect: it.collect,
            commentCount: it.commentCount,
            r18: it.r18,
            sex: it.sex,
            specTags: (it.specTags || [])
              .map((t) => t?.nameCN || t?.name)
              .filter(Boolean),
            refs,
            lastmod: it.updTime || '',
            url: `https://www.hpoi.net/hobby/${it.itemId}`,
          }) + '\n',
        );
        total++;
      }
      console.log(`  [${cat} ${catName}] page ${page} +${list.length}  累计 ${total}`);
      await sleep(400);
      if (list.length < 200) break;
    }
  }

  for (const k of ['company', 'series', 'works', 'charactar', 'person']) {
    const arr = [...ents[k].values()];
    fs.writeFileSync(files[k], arr.map((r) => JSON.stringify(r)).join('\n'));
    console.log(`  ${k}: ${arr.length} 个实体（从 working 派生）`);
  }
  console.log(`\n完成：hobby ${total} 条，共 ${reqs} 次请求`);
}

// ---------------- 主流程 ----------------
async function main() {
  console.log('hpoi 种子构建');
  console.log(`  类型    : ${TYPES.join(', ')}`);
  console.log(`  输出    : ${OUT}`);
  console.log(`  限速    : delay=${DELAY}ms concurrency=${CONC}${IDS_ONLY ? '（仅 id）' : ''}`);
  if (COOKIE) console.log('  Cookie  : 已设置');
  if (TYPES.includes('hobby') && !IDS_ONLY) {
    console.log('  ⚠️  hobby 约 13 万个页面，按当前限速会跑很久；建议先 --types company,series');
  }
  console.log('');

  // --via-api：用 query-v2 分页枚举全量（请求量降 ~100 倍），并派生实体
  if (args['via-api']) {
    await runApiSeed();
    return;
  }

  // --check-new：只检查 hpoi 首页「最新入库」，把没抓到的 id 追加进 _ids/hobby.txt
  if (args['check-new']) {
    console.log('检查 hpoi 首页「最新入库」…');
    const latest = await fetchLatestHobbyIds();
    const done = new Set();
    const hobbyFile = path.join(OUT, 'hobby.jsonl');
    if (fs.existsSync(hobbyFile)) {
      for (const line of fs.readFileSync(hobbyFile, 'utf8').split('\n')) {
        if (!line) continue;
        try {
          done.add(JSON.parse(line).id);
        } catch {
          /* ignore */
        }
      }
    }
    const fresh = latest.filter((id) => !done.has(id));
    console.log('最新入库：', latest.join(', ') || '（无）');
    console.log(
      '未抓到的：',
      fresh.length ? fresh.join(', ') : '（无，全部已抓）',
    );
    if (fresh.length) {
      const idsFile = path.join(OUT, '_ids', 'hobby.txt');
      const existed = fs.existsSync(idsFile)
        ? fs.readFileSync(idsFile, 'utf8').trim()
        : '';
      const existing = new Set(
        existed
          .split('\n')
          .filter(Boolean)
          .map((l) => Number(l.split('\t')[0])),
      );
      const add = fresh.filter((id) => !existing.has(id));
      if (add.length) {
        fs.appendFileSync(
          idsFile,
          (existed ? '\n' : '') + add.map((id) => `${id}\t`).join('\n'),
        );
        console.log('已追加到 _ids/hobby.txt：', add.join(', '));
      }
    }
    return;
  }

  console.log('  拉取 sitemap 索引中…（网络慢时会等一会，别关）');
  const shards = await loadShards();
  console.log(
    'sitemap 分片：' +
      [...shards.entries()].map(([t, a]) => `${t}×${a.length}`).join(', '),
  );
  console.log('');

  for (const type of TYPES) {
    const list = await collectIds(type, shards.get(type) || []);
    console.log(`\n== ${type}：sitemap 共 ${list.length} 条`);
    if (IDS_ONLY) continue;

    const file = path.join(OUT, `${type}.jsonl`);
    const done = new Set();
    if (fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        try {
          done.add(JSON.parse(line).id);
        } catch {
          /* ignore */
        }
      }
    }
    const todo = list.filter((o) => !done.has(o.id)).slice(0, MAX);
    console.log(`   已完成 ${done.size}，待抓 ${todo.length}（开始抓取…）`);

    const parser = type === 'company' ? parseCompany : type === 'hobby' ? parseHobby : parseEntity;
    let ok = 0;
    let fail = 0;
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= todo.length) return;
        const { id, lastmod } = todo[idx];
        const url = `${SITE}/${PATH_OF[type]}/${id}`;
        try {
          const html = await pacedFetch(url);
          const rec = {
            id,
            ...parser(html),
            lastmod,
            url,
          };
          fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf8');
          ok++;
        } catch (e) {
          fail++;
          fs.appendFileSync(
            path.join(OUT, '_errors.jsonl'),
            JSON.stringify({ type, id, url, error: String(e?.message || e) }) + '\n',
            'utf8',
          );
        }
        const total = ok + fail;
        if (total % 20 === 0 || total === todo.length) {
          console.log(
            `   [${type}] ${total}/${todo.length}  ok=${ok} fail=${fail}`,
          );
        }
      }
    };
    await Promise.all(Array.from({ length: CONC }, worker));
    console.log(`   [${type}] 完成：ok=${ok} fail=${fail} → ${file}`);
  }

  fs.writeFileSync(
    path.join(OUT, 'index.json'),
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        types: TYPES,
        delay: DELAY,
        concurrency: CONC,
        idsOnly: IDS_ONLY,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('\n全部完成 →', OUT);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
