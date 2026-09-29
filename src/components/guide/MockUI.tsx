/* eslint-disable react/prop-types */
import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/**
 * 「假界面」用的模拟组件：用来在《使用指南》里画演示画面，
 * 不依赖真实数据 / 登录态 / 路由。
 * 高亮用「聚光灯」遮罩：目标区域挖空，其余变暗 + 目标描边。
 */

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 注册「当前要高亮的元素」的上下文（由 MockFrame 内部提供） */
const SpotlightCtx = createContext<((el: HTMLElement | null) => void) | null>(
  null,
);

/** 把子元素标记为「高亮目标」（同一帧内只应有一个） */
export const Spot: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const register = useContext(SpotlightCtx);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    register?.(ref.current);
    return () => register?.(null);
  }, [register]);
  return <div ref={ref}>{children}</div>;
};

const SIDEBAR_ITEMS = [
  '时间流',
  'X主页',
  'Pawchive',
  '本地库',
  '订阅',
  '统计',
  '下载管理',
  '设置',
  '关于',
];

/** 设置页左侧的二级分组 */
const SETTINGS_NAV = ['常规', '下载', '平台', '站点', '工具与数据'];

/** 模拟应用窗口：左侧栏 + 内容区 + 右上角「?」 */
export const MockFrame: React.FC<{
  content?: React.ReactNode;
  /** 需要高亮的整体区域（内容里的高亮用 <Spot>，见 MockRow） */
  highlight?: 'sidebar' | 'account' | 'help' | 'settingsNav' | null;
  /** 左侧栏当前选中项（默认「时间流」） */
  activeSidebar?: string;
  /** 传了就在内容区左侧画设置页的二级分组菜单（值为当前分组） */
  settingsNav?: string;
}> = ({ content, highlight, activeSidebar = '时间流', settingsNav }) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const [spotEl, setSpotEl] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const register = useCallback((el: HTMLElement | null) => setSpotEl(el), []);

  useLayoutEffect(() => {
    const el =
      highlight === 'sidebar'
        ? sidebarRef.current
        : highlight === 'account'
          ? accountRef.current
          : highlight === 'help'
            ? helpRef.current
            : highlight === 'settingsNav'
              ? navRef.current
              : spotEl;
    const frame = frameRef.current;
    if (!el || !frame) {
      setRect(null);
      return;
    }
    const measure = () => {
      const f = frame.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setRect({
        top: r.top - f.top,
        left: r.left - f.left,
        width: r.width,
        height: r.height,
      });
    };
    measure();
    const t = window.setTimeout(measure, 60);
    return () => window.clearTimeout(t);
  }, [highlight, spotEl, settingsNav]);

  return (
    <SpotlightCtx.Provider value={register}>
      <div
        ref={frameRef}
        className="relative flex h-[300px] w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50 select-none"
      >
        {/* 左侧栏 */}
        <div
          ref={sidebarRef}
          className="flex w-28 shrink-0 flex-col gap-1 bg-ant-color-primary p-2"
        >
          <div
            ref={accountRef}
            className="mx-auto mb-1 flex h-9 w-9 items-center justify-center rounded-full bg-white/25 text-[10px] text-white"
          >
            头像
          </div>
          {SIDEBAR_ITEMS.map((n) => (
            <div
              key={n}
              className={`flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-white/90 ${
                n === activeSidebar ? 'bg-white/30 font-medium' : ''
              }`}
            >
              <span className="h-2 w-2 rounded-sm bg-white/60" />
              {n}
            </div>
          ))}
        </div>

        {/* 内容区 */}
        <div className="relative flex flex-1 overflow-hidden p-3">
          {settingsNav ? (
            <div className="flex w-full gap-3">
              <div ref={navRef} className="w-20 shrink-0 space-y-1">
                {SETTINGS_NAV.map((g) => (
                  <div
                    key={g}
                    className={`rounded px-2 py-1 text-[11px] ${
                      g === settingsNav
                        ? 'bg-ant-color-primary text-white'
                        : 'text-gray-500'
                    }`}
                  >
                    {g}
                  </div>
                ))}
              </div>
              <div className="min-w-0 flex-1">{content}</div>
            </div>
          ) : (
            <div className="h-full w-full">{content}</div>
          )}
          <div
            ref={helpRef}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-sm text-gray-500"
          >
            ?
          </div>
        </div>

        {/* 聚光灯遮罩 + 高亮描边 */}
        {rect && (
          <>
            <div
              className="pointer-events-none absolute z-30 rounded-md"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.35)',
              }}
            />
            <div
              className="pointer-events-none absolute z-40 rounded-md ring-2 ring-ant-color-primary animate-pulse"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
              }}
            />
          </>
        )}
      </div>
    </SpotlightCtx.Provider>
  );
};

/** 模拟「设置卡片」 */
export const MockCard: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <div className="rounded-md border border-gray-200 bg-white p-3">
    <div className="mb-2 text-sm font-bold text-gray-700">{title}</div>
    <div className="space-y-2">{children}</div>
  </div>
);

/** 模拟「一行设置项」；highlight 时会被聚光灯高亮（不用再自己加环） */
export const MockRow: React.FC<{
  label: string;
  value?: string;
  highlight?: boolean;
}> = ({ label, value, highlight }) => {
  const body = (
    <div className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1.5">
      <span className="w-16 shrink-0 text-[11px] text-gray-500">{label}</span>
      <span className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-[11px] text-gray-600">
        {value ?? ''}
      </span>
    </div>
  );
  return highlight ? <Spot>{body}</Spot> : body;
};
