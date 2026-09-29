/**
 * 解析 X（推特）用户输入，统一取到 screenName：
 * - 用户名 / @用户名：`shiratamacaron` / `@shiratamacaron`
 * - 主页链接：`https://x.com/shiratamacaron`（或 twitter.com）
 * - 推文链接：`https://x.com/shiratamacaron/status/123...`（取作者名）
 * 识别不了返回 undefined（如 `x.com/i/status/...` 这类不带作者名的链接）。
 */
const RESERVED = new Set([
  'i',
  'home',
  'search',
  'explore',
  'notifications',
  'messages',
  'settings',
  'compose',
]);

export function parseTwitterScreenName(raw: string): string | undefined {
  const s = (raw || '').trim();
  if (!s) return undefined;

  // 链接形式
  const m = s.match(
    /(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]+)/i,
  );
  if (m) {
    const seg = m[1];
    return RESERVED.has(seg.toLowerCase()) ? undefined : seg;
  }

  // @用户名 或 纯用户名
  const h = s.match(/^@?([A-Za-z0-9_]{1,15})$/);
  return h ? h[1] : undefined;
}
