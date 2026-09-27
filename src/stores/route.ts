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

export interface RouteStore {
  route: Route | null;
  setRoute: (route: Route) => void;
  /** 跨页跳转并打开指定文章（时间流「查看正文」用） */
  pendingArticle: { page: string; postId: string } | null;
  openArticle: (page: string, postId: string) => void;
  clearPendingArticle: () => void;
}

export const useRouteStore = create<RouteStore>((set) => ({
  route: null,
  setRoute: (route: Route) => {
    set({
      route,
    });
    setRouteToHash(route);
  },
  pendingArticle: null,
  openArticle: (page: string, postId: string) => {
    const route = ROUTES.find((r) => r.id === page) || null;
    if (route) {
      set({ route, pendingArticle: { page, postId } });
      setRouteToHash(route);
    }
  },
  clearPendingArticle: () => set({ pendingArticle: null }),
}));

// 推迟设置 route，避免因循环引用导致报错
setTimeout(() => {
  useRouteStore.setState({
    route: getRouteFromHash() || ROUTES[0],
  });
}, 10);
