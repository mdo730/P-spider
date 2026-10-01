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
  GiftOutlined,
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
import { IntelPage } from '../pages/Intel';
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
    id: 'intel',
    name: 'hpoi',
    // TODO: 换成 hpoi 单色 SVG（现暂用 antd 图标占位）
    icon: <GiftOutlined />,
    element: <IntelPage />,
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
  'intel',
];

/**
 * 按用户自定义顺序重排路由。
 * 新增路由（不在持久化的 order 里）**不会**被丢到最后，而是按默认顺序插到
 * 「默认顺序里它前一个已知路由」之后——避免 hpoi 这种后加的路由跑到「关于」下面。
 */
export function applySidebarOrder(order: string[] = []): Route[] {
  if (order.length === 0) return ROUTES;
  const defaultIds = ROUTES.map((r) => r.id);
  // 用户顺序里有效且去重的部分
  const full = order.filter(
    (id, i) => defaultIds.includes(id) && order.indexOf(id) === i,
  );
  for (const id of defaultIds) {
    if (full.includes(id)) continue;
    const defIdx = defaultIds.indexOf(id);
    let anchor = -1;
    for (let i = defIdx - 1; i >= 0; i--) {
      const pos = full.indexOf(defaultIds[i]);
      if (pos >= 0) {
        anchor = pos;
        break;
      }
    }
    full.splice(anchor + 1, 0, id);
  }
  const idx = (id: string) => full.indexOf(id);
  return [...ROUTES].sort((a, b) => idx(a.id) - idx(b.id));
}
