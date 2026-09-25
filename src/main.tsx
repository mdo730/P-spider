import ReactDOM from 'react-dom/client';
import { App } from './App';
import './css/preflight.css';
import './css/base.css';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import 'dayjs/locale/zh-cn';
import './utils/log';
import { Logger } from './utils/log';
// 副作用 import：确保下载历史模块常驻加载，注册 onTaskCompleted 监听，
// 使后台订阅下载也能写入历史（时间流数据源）
import './stores/download-history';
// 副作用 import：fig-memo 自用订阅的后台调度（24h 追新）+ 统计监听
import './stores/figmemo';

dayjs.extend(duration);
dayjs.locale('zh-cn');

function bootstrapLogger() {
  window.log = new Logger();

  window.addEventListener('error', (ev) => {
    log.error('Window error', {
      error: ev.error,
      message: ev.message,
      filename: ev.filename,
    });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    log.error('Unhandled rejection', {
      promise: ev.promise,
      reason: ev.reason,
    });
  });
}

/**
 * 屏蔽 WebView 原生右键菜单（桌面应用不需要「后退/刷新/另存图片」这类菜单）。
 * 自定义菜单用 antd Dropdown 的 contextMenu 触发，不受影响；
 * 输入框/可编辑区域保留原生菜单，方便右键粘贴；
 * antd 放大预览的图片（`.ant-image-preview-img`）保留原生菜单，方便「复制图片」。
 */
function blockNativeContextMenu() {
  window.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        'input, textarea, [contenteditable="true"], .ant-image-preview-img',
      )
    )
      return;
    event.preventDefault();
  });
}

function bootstrapView() {
  log.info('Bootstrap view');
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <App />,
  );
}

async function bootstrap() {
  bootstrapLogger();
  blockNativeContextMenu();
  log.info(`App bootstrap, version=${PACKAGE_JSON_VERSION}`);
  bootstrapView();
}

bootstrap();
