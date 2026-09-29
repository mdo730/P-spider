import { create } from 'zustand';
import dayjs, { Dayjs } from 'dayjs';
import {
  fetchPixivUser,
  fetchPixivWorks,
  parsePixivInput,
  PixivUser,
  PixivWork,
  PixivWorkType,
  resolveWorkAuthorId,
} from '../services/pixiv';

export interface PixivFilter {
  /** 作品类型（插画 / 漫画 / 动图） */
  types: PixivWorkType[];
  dateRange?: [Dayjs, Dayjs];
}

export const DEFAULT_PIXIV_FILTER: PixivFilter = {
  types: ['illust', 'manga', 'ugoira'],
};

interface Cursors {
  illust: number | null;
  manga: number | null;
}

export interface PixivStore {
  keyword: string;
  setKeyword: (kw: string) => void;
  filter: PixivFilter;
  setFilter: (f: PixivFilter) => void;

  userInfo: { data?: PixivUser; loading: boolean };
  works: PixivWork[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error?: string;

  loadUser: (input: string) => Promise<void>;
  loadMore: () => Promise<void>;
  clear: () => void;
}

let userId = '';
let cursors: Cursors = { illust: 0, manga: 0 };
let seq = 0;

async function pull(
  uid: string,
  c: Cursors,
): Promise<{ works: PixivWork[]; cursors: Cursors }> {
  const illP =
    c.illust === null
      ? Promise.resolve({ works: [] as PixivWork[], nextOffset: null })
      : fetchPixivWorks(uid, c.illust, 'illust');
  const manP =
    c.manga === null
      ? Promise.resolve({ works: [] as PixivWork[], nextOffset: null })
      : fetchPixivWorks(uid, c.manga, 'manga');
  const [ill, man] = await Promise.all([illP, manP]);
  return {
    works: [...ill.works, ...man.works],
    cursors: { illust: ill.nextOffset, manga: man.nextOffset },
  };
}

export const usePixivStore = create<PixivStore>((set) => ({
  keyword: '',
  setKeyword: (kw) => set({ keyword: kw }),
  filter: DEFAULT_PIXIV_FILTER,
  setFilter: (f) => set({ filter: f }),

  userInfo: { loading: false, data: undefined },
  works: [],
  loading: false,
  loadingMore: false,
  hasMore: false,
  error: undefined,

  loadUser: async (input) => {
    const mySeq = ++seq;
    const parsed = parsePixivInput(input);
    let uid = parsed.userId;
    set({
      userInfo: { loading: true, data: undefined },
      works: [],
      loading: true,
      loadingMore: false,
      hasMore: false,
      error: undefined,
    });
    try {
      if (!uid && parsed.workId) uid = await resolveWorkAuthorId(parsed.workId);
      if (!uid) throw new Error('无法识别 pixiv 链接 / ID');
      userId = uid;
      const [user, page] = await Promise.all([
        fetchPixivUser(uid),
        pull(uid, { illust: 0, manga: 0 }),
      ]);
      if (mySeq !== seq) return;
      cursors = page.cursors;
      set({
        userInfo: { loading: false, data: user },
        works: page.works,
        loading: false,
        hasMore: page.cursors.illust !== null || page.cursors.manga !== null,
      });
    } catch (err: any) {
      if (mySeq !== seq) return;
      const message = err?.message || '加载失败';
      set({
        userInfo: { loading: false, data: undefined },
        works: [],
        loading: false,
        hasMore: false,
        error: message,
      });
      throw err;
    }
  },

  loadMore: async () => {
    if (!userId) return;
    if (cursors.illust === null && cursors.manga === null) return;
    const mySeq = seq;
    set({ loadingMore: true });
    try {
      const page = await pull(userId, cursors);
      if (mySeq !== seq) return;
      cursors = page.cursors;
      set((s) => {
        const seen = new Set(s.works.map((w) => w.id));
        const merged = [...s.works];
        for (const w of page.works) {
          if (!seen.has(w.id)) {
            seen.add(w.id);
            merged.push(w);
          }
        }
        return {
          works: merged,
          loadingMore: false,
          hasMore: page.cursors.illust !== null || page.cursors.manga !== null,
        };
      });
    } catch (err: any) {
      if (mySeq === seq) {
        set({ loadingMore: false, error: err?.message || '加载更多失败' });
      }
      throw err;
    }
  },

  clear: () => {
    seq += 1;
    userId = '';
    cursors = { illust: 0, manga: 0 };
    set({
      userInfo: { loading: false, data: undefined },
      works: [],
      loading: false,
      loadingMore: false,
      hasMore: false,
      error: undefined,
    });
  },
}));

/** 按筛选条件过滤作品（类型 + 时间范围） */
export function filterPixivWorks(
  works: PixivWork[],
  filter: PixivFilter,
): PixivWork[] {
  const types = new Set(filter.types);
  const [start, end] = filter.dateRange || [];
  return works.filter((w) => {
    if (!types.has(w.type)) return false;
    const t = dayjs(w.createDate);
    if (start && t.isBefore(start)) return false;
    if (end && t.isAfter(end)) return false;
    return true;
  });
}
