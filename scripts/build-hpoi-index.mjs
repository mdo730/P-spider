#!/usr/bin/env node
/**
 * hpoi 种子 → 紧凑搜索索引 转换脚本（独立运行）
 *
 * 输入：`hpoi-seed/<kind>.jsonl`（由 build-hpoi-seed.mjs 产出）
 * 输出：`<out>/<kind>.json`（数组的数组，紧凑，供 P-Spider 快速载入）
 *       默认输出到 %APPDATA%\p-spider\hpoi-index（即 app 的 dataDir/hpoi-index）
 *
 * 用法：
 *   node scripts/build-hpoi-index.mjs
 *   node scripts/build-hpoi-index.mjs --in hpoi-seed --out "C:\path\to\out"
 *
 * 索引条目：
 *   hobby     [id, nameCN, nameJa, companyName, category, cover, releaseDate, refs, norm, hits, hitsDay, hits7Day, rating, collect]
 *             refs = ["c:25","s:443","w:1498","h:2","p:388"]（c=company s=series w=works h=charactar p=person）
 *             rating = 均分（rating/ratingCount），非总分
 *   company   [id, name, cover, filterId, norm]
 *   series    [id, name, cover, norm]
 *   works/charactar/person  [id, name, cover, norm]
 */

import fs from 'node:fs';
import path from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) args[k] = true;
  else {
    args[k] = v;
    i++;
  }
}

const IN = path.resolve(args.in || 'hpoi-seed');
const OUT = path.resolve(
  args.out || path.join(process.env.APPDATA || '.', 'p-spider', 'hpoi-index'),
);
/** --optimize：别名去垃圾/去重（空、过短、与中/日文名·厂商名·关联名重复）；**保留 refNames** */
const OPTIMIZE = !!args.optimize;

/** 清洗别名：去非字符串/过短/重复，并剔除与主体名重复的 */
function cleanAliases(aliases, exclude) {
  const bad = new Set(exclude.map((x) => norm(String(x || ''))).filter(Boolean));
  const seen = new Set();
  const out = [];
  for (const a of Array.isArray(aliases) ? aliases : []) {
    if (typeof a !== 'string') continue;
    const s = a.trim();
    if (s.length < 2) continue;
    const k = norm(s);
    if (!k || bad.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** 发售基准日（爬取时校准，用于增量脚本；此处仅透传到 meta） */
function readReleaseRef() {
  try {
    const p = path.join(IN, '_release_ref.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : undefined;
  } catch {
    return undefined;
  }
}

/** 归一化（必须与 app 端一致）：NFKC + 小写 + 去空白/标点/全角括号 */
function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[「」『』（）()\[\]【】·・:：,，。.!！?？~～\-_/\\'"’“”&+]/g, '');
}

const REF_CODE = {
  company: 'c',
  series: 's',
  works: 'w',
  charactar: 'h',
  person: 'p',
};

function readJsonl(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const line of txt.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* 跳过半行/坏行 */
    }
  }
  return out;
}

function main() {
  if (!fs.existsSync(IN)) {
    console.error(`找不到输入目录: ${IN}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  console.log('hpoi 索引构建');
  console.log('  输入:', IN);
  console.log('  输出:', OUT);

  const meta = { v: 1, builtAt: new Date().toISOString(), source: IN, counts: {} };
  let maxId = 0;

  const kinds = ['hobby', 'company', 'series', 'works', 'charactar', 'person'];
  for (const kind of kinds) {
    const file = path.join(IN, `${kind}.jsonl`);
    if (!fs.existsSync(file)) {
      console.log(`  - ${kind}: 无文件，跳过`);
      continue;
    }
    const rows = readJsonl(file);
    const items = [];
    for (const r of rows) {
      if (kind === 'hobby') {
        if (Number(r.id) > maxId) maxId = Number(r.id);
        const refs = Array.isArray(r.refs)
          ? r.refs
              .filter((x) => x && REF_CODE[x.type] && x.id)
              .map((x) => `${REF_CODE[x.type]}:${x.id}`)
          : [];
        const refNames = Array.isArray(r.refs) ? r.refs.map((x) => x.name) : [];
        const aliases = OPTIMIZE
          ? cleanAliases(r.aliases, [
              r.nameCN,
              r.nameJa,
              r.companyName,
              ...refNames,
            ])
          : Array.isArray(r.aliases)
            ? r.aliases
            : [];
        const n = norm(
          [
            r.nameCN,
            r.nameJa,
            ...aliases,
            r.companyName,
            ...refNames,
          ].join(' '),
        );
        items.push([
          r.id,
          r.nameCN || '',
          r.nameJa || '',
          r.companyName || '',
          r.category || '',
          r.cover || '',
          r.releaseDate || '',
          refs,
          n,
          r.hits || 0,
          r.hitsDay || 0,
          r.hits7Day || 0,
          r.ratingCount > 0
            ? Number((r.rating / r.ratingCount).toFixed(2))
            : 0,
          Number(r.collect) || 0,
        ]);
      } else if (kind === 'company') {
        items.push([
          r.id,
          r.name || '',
          r.cover || '',
          r.filterId || 0,
          norm([r.name, ...(Array.isArray(r.aliases) ? r.aliases : [])].join(' ')),
        ]);
      } else {
        items.push([
          r.id,
          r.name || '',
          r.cover || '',
          norm([r.name, ...(Array.isArray(r.aliases) ? r.aliases : [])].join(' ')),
        ]);
      }
    }
    fs.writeFileSync(
      path.join(OUT, `${kind}.json`),
      JSON.stringify({ v: 1, kind, items }),
      'utf8',
    );
    meta.counts[kind] = items.length;
    console.log(`  - ${kind}: ${items.length} 条`);
  }

  meta.maxId = maxId;
  const releaseRef = readReleaseRef();
  if (releaseRef) meta.releaseRef = releaseRef;
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  console.log('\n完成 →', OUT);
  console.log(`  maxId=${maxId}${releaseRef ? ` releaseRef=${releaseRef}` : ''}`);
}

main();
