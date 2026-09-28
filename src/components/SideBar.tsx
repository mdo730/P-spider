/* eslint-disable react/prop-types */
import clsx from 'clsx';
import React from 'react';
import { ROUTES } from '../constants/routes';
import { Route } from '../interfaces/Route';
import { useRouteStore } from '../stores/route';
import { useFigmemoStore } from '../stores/figmemo';
import { useMoeyoStore } from '../stores/moeyo';
import { useUpdateStore } from '../stores/update';
import { Account } from './Account';

interface SideBarItemProps {
  route: Route;
  active: boolean;
  /** 右上角红点（如有新版） */
  dot?: boolean;
}

const Item: React.FC<SideBarItemProps> = ({ route, active, dot }) => {
  const setRoute = useRouteStore((state) => state.setRoute);
  return (
    <li className="text-ant-color-white pr-2">
      <button
        aria-label={`切换到${route.name}${active ? '（当前）' : ''}`}
        className={clsx(
          'block w-full py-3 px-4 rounded-r-md transition-all',
          active
            ? 'bg-ant-color-white text-ant-color-primary'
            : 'bg-transparent hover:bg-[rgba(255,255,255,0.2)] ',
        )}
        onClick={() => {
          // 侧栏切页视为新起点：清空详情「返回」的历史栈（页面状态由各页缓存保持）
          useRouteStore.getState().clearHistory();
          setRoute(route);
        }}
      >
        <span className="float-left">{route.icon}</span>
        <span className="relative">
          {route.name}
          {dot && (
            <span
              aria-label="有可用更新"
              className="absolute -right-2.5 -top-1 h-2 w-2 rounded-full bg-red-500"
            />
          )}
        </span>
      </button>
    </li>
  );
};

export const SideBar: React.FC = () => {
  const current = useRouteStore((state) => state.route);
  const figmemoEnabled = useFigmemoStore((s) => s.featureEnabled);
  const moeyoEnabled = useMoeyoStore((s) => s.featureEnabled);
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);

  if (!current) return null;

  const routes = ROUTES.filter(
    (r) =>
      (r.id !== 'figmemo' || figmemoEnabled) &&
      (r.id !== 'moeyo' || moeyoEnabled),
  );

  return (
    <aside
      aria-label="侧边栏"
      className="fixed top-0 left-0 h-full w-52 bg-ant-color-primary z-40 transition-transform"
    >
      <Account />
      <nav aria-label="页面导航">
        <ul className="pt-6 space-y-2">
          {routes.map((route) => (
            <Item
              key={route.id}
              route={route}
              active={current.id === route.id}
              dot={route.id === 'about' && hasUpdate}
            />
          ))}
        </ul>
      </nav>
    </aside>
  );
};
