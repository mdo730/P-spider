import { ReactElement } from 'react';
import { Route } from '../interfaces/Route';
import {
  SettingFilled,
  DownloadOutlined,
  InfoCircleFilled,
  BellOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import xIcon from '../assets/platform-icons/x.svg';
import pawchiveIcon from '../assets/platform-icons/pawchive.svg';
import figmemoIcon from '../assets/platform-icons/figmemo.svg';
import moeyoIcon from '../assets/platform-icons/moeyo.svg';
import pixivIcon from '../assets/platform-icons/pixiv.svg';

/**
 * 侧栏用站点图标：单色 SVG 走 CSS mask + `bg-current`，
 * 从而跟随按钮颜色（未选中=白、选中=主题色），与 antd 图标一致。
 */
function siteIcon(src: string): ReactElement {
  return (
    <span
      aria-hidden
      className="inline-block h-[1em] w-[1em] bg-current align-[-0.125em]"
      style={{
        WebkitMaskImage: `url("${src}")`,
        maskImage: `url("${src}")`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  );
}
import { Homepage } from '../pages/Homepage';
import { Archiver } from '../pages/Archiver';
import { LibraryPage } from '../pages/Library';
import { FigmemoPage } from '../pages/Figmemo';
import { MoeyoPage } from '../pages/Moeyo';
import { PixivPage } from '../pages/Pixiv';
import { DownloadManagement } from '../pages/DownloadManagement';
import { SubscriptionPage } from '../pages/Subscription';
import { StatisticsPage } from '../pages/Statistics';
import { TimelinePage } from '../pages/Timeline';
import { Settings } from '../pages/Settings';
import { About } from '../pages/About';

export const ROUTES: Route[] = [
  {
    id: 'timeline',
    name: '时间流',
    icon: <ClockCircleOutlined />,
    element: <TimelinePage />,
  },
  {
    id: 'home',
    name: 'X主页',
    icon: siteIcon(xIcon),
    element: <Homepage />,
  },
  {
    id: 'archiver',
    name: 'Pawchive',
    icon: siteIcon(pawchiveIcon),
    element: <Archiver />,
  },
  {
    id: 'library',
    name: '本地库',
    icon: <FolderOutlined />,
    element: <LibraryPage />,
  },
  {
    id: 'figmemo',
    name: 'fig-memo',
    icon: siteIcon(figmemoIcon),
    element: <FigmemoPage />,
  },
  {
    id: 'moeyo',
    name: 'moeyo',
    icon: siteIcon(moeyoIcon),
    element: <MoeyoPage />,
  },
  {
    id: 'pixiv',
    name: 'pixiv',
    icon: siteIcon(pixivIcon),
    element: <PixivPage />,
  },
  {
    id: 'subscription',
    name: '订阅',
    icon: <BellOutlined />,
    element: <SubscriptionPage />,
  },
  {
    id: 'statistics',
    name: '统计',
    icon: <BarChartOutlined />,
    element: <StatisticsPage />,
  },
  {
    id: 'download-management',
    name: '下载管理',
    icon: <DownloadOutlined />,
    element: <DownloadManagement />,
  },
  {
    id: 'settings',
    name: '设置',
    icon: <SettingFilled />,
    element: <Settings />,
  },
  {
    id: 'about',
    name: '关于',
    icon: <InfoCircleFilled />,
    element: <About />,
  },
];

/**
 * 侧栏可隐藏的页面：其余页面（时间流/订阅/下载管理/设置/关于）强制常显，
 * 避免用户把关键入口藏掉后「回不去」。
 */
export const SIDEBAR_HIDEABLE_IDS: string[] = [
  'home',
  'archiver',
  'library',
  'statistics',
  'figmemo',
  'moeyo',
  'pixiv',
];

/** 按用户自定义顺序重排路由；未列在 order 里的路由按默认顺序排在其后 */
export function applySidebarOrder(order: string[] = []): Route[] {
  if (order.length === 0) return ROUTES;
  const idx = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...ROUTES].sort((a, b) => idx(a.id) - idx(b.id));
}
