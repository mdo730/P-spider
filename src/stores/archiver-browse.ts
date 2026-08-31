import { create } from 'zustand';
import {
  getAdapter,
  PAWCHIVE_SOURCE,
  PlatformCreator,
  PlatformPost,
  PlatformSource,
  withCreator,
} from '../platforms';

/**
 * Pawchive 浏览 store。
 *
 * 2026-08 定案：只检索 pawchive（活跃归档站，Patreon/Fanbox/Discord）。
 * kemono 已移除（数据停滞在 2026-01 且原图 CDN 连不上，pawchive 基于 kemono 数据基本覆盖）。
 * 同一 `service/数字ID` 可定位创作者（pawchive 需数字 id，无 slug 端点）：
 * - 纯数字 ID 自动探测 service（fanbox/patreon/discord）
 * - 某 service 解析失败自动降级（不阻塞）
 * - 结果按 post id 去重（单源即自身），按发布时间倒序
 */

/** 参与检索的归档站（当前仅 pawchive） */
export const ARCHIVER_SOURCES: PlatformSource[] = [PAWCHIVE_SOURCE];

/** pawchive 支持的原站 service */
const COMMON_SERVICES = ['fanbox', 'patreon', 'discord'];

/** 检索序号：快速连续检索时，慢响应不覆盖新结果（竞态保护） */
let loadSeq = 0;

export interface ArchiverSourceState {
  source: PlatformSource;
  posts: PlatformPost[];
  cursor: string | null;
  loading: boolean;
  failed: boolean;
  errorMessage?: string;
}

function parseIdentifier(identifier: string): {
  service: string;
  id: string;
} {
  const trimmed = identifier.trim();
  // 支持完整创作者链接：https://pawchive.pw/fanbox/user/11229342
  const urlMatch = trimmed.match(/pawchive\.pw\/([a-z]+)\/user\/(\d+)/i);
  if (urlMatch) {
    return { service: urlMatch[1], id: urlMatch[2] };
  }
  const parts = trimmed.split('/');
  if (parts.length === 2) {
    const [service, id] = parts;
    if (service && /^\d+$/.test(id)) {
      return { service, id };
    }
  }
  if (/^\d+$/.test(trimmed)) {
    // 纯数字：service 待探测
    return { service: '', id: trimmed };
  }
  throw new Error(
    '格式应为 Pawchive 创作者链接（如 https://pawchive.pw/fanbox/user/3316400）、service/ID（如 fanbox/3316400）或数字 ID（如 3316400）',
  );
}

/**
 * 探测数字 ID 对应的 service：并发尝试 pawchive 支持的原站，
 * 任一 resolveCreator 成功即确认，并复用其解析出的 creator（省一次请求）。
 */
async function detectService(
  id: string,
): Promise<{ service: string; creator: PlatformCreator }> {
  const adapter = getAdapter(PAWCHIVE_SOURCE);
  const results = await Promise.all(
    COMMON_SERVICES.map(async (service) => {
      try {
        const creator = await adapter.resolveCreator(`${service}/${id}`);
        return { service, creator };
      } catch (err) {
        return null;
      }
    }),
  );
  const hit = results.find((r) => r !== null);
  if (!hit) {
    throw new Error(
      `找不到数字 ID ${id} 对应的创作者（已尝试 fanbox/patreon/discord）`,
    );
  }
  return hit;
}

/** 合并去重：按 post id 去重（pawchive 优先），按发布时间倒序 */
function mergePosts(lists: PlatformPost[][]): PlatformPost[] {
  const map = new Map<string, PlatformPost>();
  for (const list of lists) {
    for (const p of list) {
      if (p?.id && !map.has(p.id)) map.set(p.id, p);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => (b.publishedAt?.valueOf() || 0) - (a.publishedAt?.valueOf() || 0),
  );
}

const emptySources = (): ArchiverSourceState[] =>
  ARCHIVER_SOURCES.map((source) => ({
    source,
    posts: [],
    cursor: null,
    loading: false,
    failed: false,
  }));

export interface ArchiverBrowseStore {
  keyword: string;
  setKeyword: (kw: string) => void;

  identifier?: string;
  creator?: PlatformCreator;
  creatorLoading: boolean;
  creatorError?: string;

  sources: ArchiverSourceState[];
  mergedPosts: PlatformPost[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;

  load: (identifier: string) => Promise<void>;
  loadMore: () => Promise<void>;
  clear: () => void;
}

export const useArchiverBrowseStore = create<ArchiverBrowseStore>(
  (set, get) => ({
    keyword: '',
    setKeyword: (kw) => set({ keyword: kw }),

    creatorLoading: false,
    sources: emptySources(),
    mergedPosts: [],
    loading: false,
    loadingMore: false,
    hasMore: false,

    load: async (identifier) => {
      const seq = ++loadSeq;
      const parsed = parseIdentifier(identifier);
      const id = parsed.id;
      let service = parsed.service;
      let knownCreator: PlatformCreator | undefined;
      if (!service) {
        // 纯数字 ID：并发探测 service，直接复用解析出的 creator（省一次请求）
        const detected = await detectService(id);
        service = detected.service;
        knownCreator = detected.creator;
      }
      if (seq !== loadSeq) return;
      const creatorKey = `${service}/${id}`;
      set({
        identifier,
        creator: undefined,
        creatorError: undefined,
        sources: emptySources(),
        mergedPosts: [],
        loading: true,
        loadingMore: false,
        hasMore: false,
      });

      const adapter = getAdapter(PAWCHIVE_SOURCE);
      let creator: PlatformCreator;
      let page: { posts: PlatformPost[]; cursor: string | null };
      try {
        if (knownCreator) {
          // 探测已带 creator，只需拉帖
          creator = knownCreator;
          page = await adapter.fetchPosts(creator.id, undefined, 50);
        } else {
          // 带 service/链接：并行解析创作者 + 拉帖
          [creator, page] = await Promise.all([
            adapter.resolveCreator(creatorKey),
            adapter.fetchPosts(creatorKey, undefined, 50),
          ]);
        }
      } catch (err: any) {
        if (seq !== loadSeq) return;
        set({
          loading: false,
          creatorError:
            typeof err === 'string' ? err : err?.message || '未知原因',
        });
        return;
      }
      if (seq !== loadSeq) return;

      // fetchPosts 返回的帖子 creator 无 name，用已解析的 creator 填充（目录命名用创作者名）
      const enrichedPosts = withCreator(page.posts, creator);

      set({
        creator,
        sources: [
          {
            source: PAWCHIVE_SOURCE,
            posts: enrichedPosts,
            cursor: page.cursor,
            loading: false,
            failed: false,
          },
        ],
        mergedPosts: enrichedPosts,
        loading: false,
        hasMore: !!page.cursor,
      });
    },

    loadMore: async () => {
      const seq = loadSeq;
      const state = get();
      if (state.loadingMore || !state.creator) return;
      set({ loadingMore: true });

      const creatorId = state.creator.id;
      const creator = state.creator;
      const next = await Promise.all(
        state.sources.map(async (s) => {
          if (s.failed || !s.cursor) return s;
          try {
            const adapter = getAdapter(s.source);
            const page = await adapter.fetchPosts(creatorId, s.cursor, 50);
            return {
              ...s,
              posts: s.posts.concat(withCreator(page.posts, creator)),
              cursor: page.cursor,
            };
          } catch (err: any) {
            return {
              ...s,
              failed: true,
              errorMessage: err?.message || '未知原因',
            };
          }
        }),
      );

      // 期间发生了新检索，丢弃本次结果
      if (seq !== loadSeq) {
        set({ loadingMore: false });
        return;
      }

      const merged = mergePosts(next.map((s) => s.posts));
      set({
        sources: next,
        mergedPosts: merged,
        loadingMore: false,
        hasMore: next.some((s) => !s.failed && s.cursor),
      });
    },

    clear: () => {
      set({
        identifier: undefined,
        creator: undefined,
        creatorError: undefined,
        sources: emptySources(),
        mergedPosts: [],
        loading: false,
        loadingMore: false,
        hasMore: false,
      });
    },
  }),
);
