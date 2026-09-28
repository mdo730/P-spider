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
// 副作用 import：moeyo 的后台调度（24h 追新）+ 统计监听
import './stores/moeyo';
import { invoke } from '@tauri-apps/api';
import { reverseSearch, bestOpenUrl } from './services/image-search';
import { useSettingsStore } from './stores/settings';
import { openUrl } from './utils/shell';

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

/**
 * 资源管理器右键：`P-Spider.exe --image-search "<图片路径>"`
 * 若有该参数 → 直接以图搜图并打开结果，然后退出（不在前台留窗口）。
 */
async function handleImageSearchArg(): Promise<boolean> {
  if (!('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) return false;
  let path: string | null = null;
  try {
    path = await invoke<string | null>('take_image_search_arg');
  } catch {
    return false;
  }
  if (!path) return false;
  try {
    const engine =
      useSettingsStore.getState().imageSearch?.engine || 'google_lens';
    const r = await reverseSearch(path, engine);
    const url = bestOpenUrl(r);
    if (url) await openUrl(url);
  } catch (err) {
    log.error('以图搜图（右键）失败', err);
  }
  try {
    await invoke('quit_app');
  } catch {
    // ignore
  }
  return true;
}

/** 启动时按设置同步资源管理器右键注册（默认开启；除非用户显式关闭） */
async function ensureExplorerMenu(): Promise<void> {
  if (!('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) return;
  const enabled =
    useSettingsStore.getState().imageSearch?.explorerMenu !== false;
  try {
    await invoke('set_image_search_explorer_menu', { enabled });
  } catch (err) {
    log.warn('同步资源管理器右键失败', err);
  }
}

async function bootstrap() {
  bootstrapLogger();
  blockNativeContextMenu();
  log.info(`App bootstrap, version=${PACKAGE_JSON_VERSION}`);
  await ensureExplorerMenu();
  if (await handleImageSearchArg()) return;
  bootstrapView();
}

bootstrap();
