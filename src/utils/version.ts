/** 版本号比较：a 是否高于 b（按 major.minor.patch 从高位逐位比较；忽略 v 前缀与缺失位） */
export function isVersionGt(a: string, b: string) {
  const parse = (v: string) =>
    String(v)
      .replace(/^v/i, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const aa = parse(a);
  const bb = parse(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i += 1) {
    const x = aa[i] || 0;
    const y = bb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}
