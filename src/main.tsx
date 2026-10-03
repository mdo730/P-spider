import ReactDOM from 'react-dom/client';
import './css/preflight.css';
import './css/base.css';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import 'dayjs/locale/zh-cn';
import './utils/log';
import { Logger } from './utils/log';
import { getCurrent } from '@tauri-apps/api/window';
import { ConfigProvider } from 'antd';
import { ANTD_THEME } from './constants/antd-theme';

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

/** 当前窗口 label（非 Tauri 环境返回 null） */
function currentWindowLabel(): string | null {
  try {
    return getCurrent().label;
  } catch {
    return null;
  }
}

/**
 * 桌面宠物窗（label='pet'）：**只加载宠物模块**。
 * 绝不 import 主应用/业务 store，避免第二套 store 实例和主窗口抢写同一批 JSON。
 */
function bootstrapPetWindow() {
  log.info('Bootstrap pet window');
  void import('./pet/desktop/PetDesktop').then(({ PetDesktop }) => {
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <ConfigProvider theme={ANTD_THEME} autoInsertSpaceInButton={false}>
        <div className="w-screen h-screen">
          <PetDesktop />
        </div>
      </ConfigProvider>,
    );
  });
}

/**
 * 主窗口：初始化业务副作用（后台任务 / 活跃度桥接）后再渲染主应用。
 * 全部动态 import，确保**只有主窗口**会实例化这些 store。
 */
async function renderMainApp(): Promise<void> {
  await import('./stores/download-history');
  await import('./stores/figmemo');
  await import('./stores/moeyo');
  await import('./pet/activity-bridge');
  const { App } = await import('./App');
  log.info('Bootstrap view');
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <App />,
  );
}

/**
 * 资源管理器右键：`P-Spider.exe --image-search "<图片路径>"`
 */
async function handleImageSearchArg(): Promise<boolean> {
  if (!('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) return false;
  const { invoke } = await import('@tauri-apps/api');
  let path: string | null = null;
  try {
    path = await invoke<string | null>('take_image_search_arg');
  } catch {
    return false;
  }
  if (!path) return false;
  try {
    const { reverseSearch, bestOpenUrl } = await import(
      './services/image-search'
    );
    const { useSettingsStore } = await import('./stores/settings');
    const { openUrlForeground } = await import('./utils/shell');
    const engine =
      useSettingsStore.getState().imageSearch?.engine || 'google_lens';
    const r = await reverseSearch(path, engine);
    const url = bestOpenUrl(r);
    if (url) await openUrlForeground(url);
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

/** 启动时按设置同步资源管理器右键注册（仅主窗口） */
async function ensureExplorerMenu(): Promise<void> {
  if (!('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) return;
  const { invoke } = await import('@tauri-apps/api');
  const { useSettingsStore } = await import('./stores/settings');
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

  if (currentWindowLabel() === 'pet') {
    bootstrapPetWindow();
    return;
  }

  log.info(`App bootstrap, version=${PACKAGE_JSON_VERSION}`);
  await ensureExplorerMenu();
  if (await handleImageSearchArg()) return;
  await renderMainApp();

  // 若已解锁且启用桌面宠物 → 随软件启动显示（等 app-state 异步水合后再判断）
  window.setTimeout(async () => {
    const { useAppStateStore } = await import('./stores/app-state');
    const { openPetWindow } = await import('./pet');
    const s = useAppStateStore.getState();
    if (s.petUnlocked && s.petEnabled) openPetWindow();
  }, 1500);
}

bootstrap();
