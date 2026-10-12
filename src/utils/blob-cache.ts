/**
 * 有上限的 blob URL 缓存（LRU）。
 * 之前各处直接用 `new Map()` 永久缓存 `URL.createObjectURL`，blob 数据常驻内存、
 * 无上限增长（浏览越多占越多）。这里按容量淘汰并 revoke，控制内存。
 */
export class BlobCache {
  private map = new Map<string, string>();

  constructor(private max = 400) {}

  get(key: string): string | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // LRU：命中后移到末尾
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: string): void {
    const old = this.map.get(key);
    if (old && old !== value) {
      try {
        URL.revokeObjectURL(old);
      } catch {
        // ignore
      }
    }
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const first = this.map.keys().next().value as string | undefined;
      if (first === undefined) break;
      const url = this.map.get(first);
      this.map.delete(first);
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
    }
  }
}
