/* eslint-disable react/prop-types */
import clsx from 'clsx';
import React, { useEffect } from 'react';
import { applySidebarOrder } from '../constants/routes';
import { Route } from '../interfaces/Route';
import { useRouteStore } from '../stores/route';
import { useFigmemoStore } from '../stores/figmemo';
import { useMoeyoStore } from '../stores/moeyo';
import { useSettingsStore } from '../stores/settings';
import { useUpdateStore } from '../stores/update';
import {
  SIDEBAR_GRADIENT,
  SIDEBAR_GRADIENT_SPECTATOR,
} from '../constants/antd-theme';
import { Account } from './Account';

interface SideBarItemProps {
  route: Route;
  active: boolean;
  /** 右上角红点（如有新版） */
  dot?: boolean;
  /** 仅显示图标（侧栏更窄） */
  iconOnly?: boolean;
}

const Item: React.FC<SideBarItemProps> = ({ route, active, dot, iconOnly }) => {
  const setRoute = useRouteStore((state) => state.setRoute);
  return (
    <li
      className={clsx(
        'text-ant-color-white',
        iconOnly ? 'flex justify-center' : 'pr-2',
      )}
    >
      <button
        aria-label={`切换到${route.name}${active ? '（当前）' : ''}`}
        title={iconOnly ? route.name : undefined}
        className={clsx(
          'transition-all',
          iconOnly
            ? 'flex h-11 w-11 items-center justify-center rounded-md'
            : 'block w-full py-2 px-4 rounded-r-md',
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
        <span className={clsx('relative', !iconOnly && 'float-left')}>
          {route.icon}
          {iconOnly && dot && (
            <span
              aria-label="有可用更新"
              className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500"
            />
          )}
        </span>
        {!iconOnly && (
          <span className="relative">
            {route.name}
            {dot && (
              <span
                aria-label="有可用更新"
                className="absolute -right-2.5 -top-1 h-2 w-2 rounded-full bg-red-500"
              />
            )}
          </span>
        )}
      </button>
    </li>
  );
};

export const SideBar: React.FC = () => {
  const current = useRouteStore((state) => state.route);
  const figmemoEnabled = useFigmemoStore((s) => s.featureEnabled);
  const moeyoEnabled = useMoeyoStore((s) => s.featureEnabled);
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  const hidden = useSettingsStore((s) => s.sidebar?.hidden || []);
  const order = useSettingsStore((s) => s.sidebar?.order || []);
  const iconOnly = useSettingsStore((s) => s.sidebar?.iconOnly === true);
  const spectator = useSettingsStore((s) => s.app?.spectator === true);
  const gradient = spectator ? SIDEBAR_GRADIENT_SPECTATOR : SIDEBAR_GRADIENT;

  const routes = applySidebarOrder(order).filter(
    (r) =>
      !hidden.includes(r.id) &&
      (r.id !== 'figmemo' || figmemoEnabled) &&
      (r.id !== 'moeyo' || moeyoEnabled),
  );

  // 当前页被隐藏 / 被功能开关关闭时，跳回时间流，避免「没有入口回去」
  const visibleKey = routes.map((r) => r.id).join(',');
  useEffect(() => {
    if (!current) return;
    if (routes.some((r) => r.id === current.id)) return;
    const fallback = routes.find((r) => r.id === 'timeline') || routes[0];
    if (fallback) useRouteStore.getState().setRoute(fallback);
  }, [current?.id, visibleKey]);

  if (!current) return null;

  return (
    <aside
      aria-label="侧边栏"
      style={{
        // 上 80% 实色，下 20% 渐变到底色（8:2）
        backgroundImage: `linear-gradient(to bottom, ${gradient.top} 0%, ${gradient.top} 80%, ${gradient.bottom} 100%)`,
      }}
      className={clsx(
        'fixed top-0 left-0 h-full z-40 transition-all flex flex-col overflow-hidden',
        iconOnly ? 'w-14' : 'w-52',
      )}
    >
      <div className="relative shrink-0">
        <Account />
      </div>
      <nav
        aria-label="页面导航"
        className="relative flex-1 overflow-y-auto pb-4"
      >
        <ul className={clsx('pt-4 space-y-1', iconOnly && 'flex flex-col')}>
          {routes.map((route) => (
            <Item
              key={route.id}
              route={route}
              active={current.id === route.id}
              dot={route.id === 'about' && hasUpdate}
              iconOnly={iconOnly}
            />
          ))}
        </ul>
      </nav>
    </aside>
  );
};
