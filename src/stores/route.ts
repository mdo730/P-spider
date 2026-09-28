import { create } from 'zustand';
import { ROUTES } from '../constants/routes';
import { Route } from '../interfaces/Route';

function getRouteFromHash(): Route | null {
  if (!location.hash) return null;

  return ROUTES.find((route) => route.id === location.hash.slice(1)) || null;
}

function setRouteToHash(route: Route) {
  location.hash = route.id;
}

/** 导航历史栈条目（用于详情「← 返回」） */
export interface NavEntry {
  page: string;
  postId?: string;
}

const MAX_HISTORY = 50;

export interface RouteStore {
  route: Route | null;
  setRoute: (route: Route) => void;
  /** 跨页跳转并打开指定文章（时间流「查看正文」用） */
  pendingArticle: { page: string; postId: string } | null;
  /**
   * 跳转并打开指定文章。origin：入栈的“来源”条目；
   * 不传则用当前页；传 null 表示**不入栈**（供“返回”自身使用，避免来回叠加）。
   */
  openArticle: (page: string, postId: string, origin?: NavEntry | null) => void;
  clearPendingArticle: () => void;
  /** 导航历史栈（详情「← 返回」用） */
  history: NavEntry[];
  clearHistory: () => void;
  popHistory: () => NavEntry | null;
}

export const useRouteStore = create<RouteStore>((set, get) => ({
  route: null,
  setRoute: (route: Route) => {
    set({
      route,
    });
    setRouteToHash(route);
  },
  pendingArticle: null,
  openArticle: (page: string, postId: string, origin?: NavEntry | null) => {
    const route = ROUTES.find((r) => r.id === page) || null;
    if (route) {
      if (origin !== null) {
        const entry = origin || { page: get().route?.id || page };
        set((s) => ({
          history: [...s.history, entry].slice(-MAX_HISTORY),
        }));
      }
      set({ route, pendingArticle: { page, postId } });
      setRouteToHash(route);
    }
  },
  clearPendingArticle: () => set({ pendingArticle: null }),
  history: [],
  clearHistory: () => set({ history: [] }),
  popHistory: () => {
    const h = get().history;
    if (h.length === 0) return null;
    const last = h[h.length - 1];
    set({ history: h.slice(0, -1) });
    return last;
  },
}));

// 推迟设置 route，避免因循环引用导致报错
setTimeout(() => {
  useRouteStore.setState({
    route: getRouteFromHash() || ROUTES[0],
  });
}, 10);
