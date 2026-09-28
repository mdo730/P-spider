import logos from '../data/figmemo-maker-logos.json';

const LOGOS = logos as Record<string, { id?: number; url: string }>;

export interface MakerLogoSource {
  /** hpoi 厂商 id（手工补充的条目可能没有） */
  id?: number;
  url: string;
}

/** fig-memo 厂商 → hpoi 厂商封面图来源（联网抓一次后本地缓存） */
export function makerLogoSource(name: string): MakerLogoSource | undefined {
  return LOGOS[name];
}
