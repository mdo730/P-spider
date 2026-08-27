import { Route } from '../interfaces/Route';
import {
  HomeFilled,
  SettingFilled,
  DownloadOutlined,
  InfoCircleFilled,
  BellOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { Homepage } from '../pages/Homepage';
import { Archiver } from '../pages/Archiver';
import { DownloadManagement } from '../pages/DownloadManagement';
import { SubscriptionPage } from '../pages/Subscription';
import { StatisticsPage } from '../pages/Statistics';
import { TimelinePage } from '../pages/Timeline';
import { Settings } from '../pages/Settings';
import { About } from '../pages/About';

export const ROUTES: Route[] = [
  {
    id: 'home',
    name: '主页',
    icon: <HomeFilled />,
    element: <Homepage />,
  },
  {
    id: 'archiver',
    name: 'Pawchive',
    icon: <AppstoreOutlined />,
    element: <Archiver />,
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
    id: 'timeline',
    name: '时间流',
    icon: <ClockCircleOutlined />,
    element: <TimelinePage />,
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
