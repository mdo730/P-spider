import { invoke } from '@tauri-apps/api';
import { useAppStateStore } from '../stores/app-state';
import { useSettingsStore } from '../stores/settings';

export interface SearchItem {
  thumb: string;
  url: string;
  title: string;
  similarity?: number;
}

export interface EngineResult {
  engine: string;
  items: SearchItem[];
  /** 只能打开的结果页（无法在本页解析时） */
  page_url?: string;
  error?: string;
}

export interface EngineDef {
  id: string;
  name: string;
  hint?: string;
}

/** 引擎清单（解析型会出列表；open 型只给“打开结果页”） */
export const SEARCH_ENGINES: EngineDef[] = [
  { id: 'yandex', name: 'Yandex', hint: '真人 / 通用最强' },
  { id: 'saucenao', name: 'SauceNAO', hint: '二次元 / 找原画师' },
  { id: 'iqdb', name: 'IQDB', hint: '二次元老图' },
  { id: 'trace_moe', name: 'trace.moe', hint: '番剧截图' },
  { id: 'google_lens', name: 'Google Lens', hint: '通用（跳浏览器）' },
  { id: 'ascii2d', name: 'Ascii2D', hint: '二次元（跳浏览器）' },
];

/** 结果可直接在本页列出的引擎 */
export const PARSED_ENGINES = new Set([
  'yandex',
  'saucenao',
  'iqdb',
  'trace_moe',
]);

function proxyUrl(): string {
  const s = useSettingsStore.getState();
  if (!s.proxy.enable) return '';
  return s.proxy.useSystem
    ? useAppStateStore.getState().systemProxyUrl || ''
    : s.proxy.url || '';
}

/** 取“最该打开”的链接：结果页优先，否则第一条命中 */
export function bestOpenUrl(r: EngineResult): string | undefined {
  if (r.page_url) return r.page_url;
  return r.items.find((i) => i.url)?.url;
}

export async function reverseSearch(
  input: string,
  engine: string,
): Promise<EngineResult> {
  return await invoke<EngineResult>('reverse_image_search', {
    input,
    engine,
    proxy: proxyUrl(),
    saucenaoKey: useSettingsStore.getState().imageSearch?.saucenaoKey || null,
  });
}
