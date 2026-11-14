import { invoke } from '@tauri-apps/api';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { useAppStateStore } from './app-state';
import { useSettingsStore } from './settings';

interface SubscriptionInfo {
  upload: number;
  download: number;
  total: number;
  expire: number;
}

interface ClashStatus {
  running: boolean;
  mixed_port: number;
  controller: string;
  subscription?: SubscriptionInfo | null;
}

interface CoreStatus {
  installed: boolean;
  version: string;
  path: string;
}

/** 拉订阅/下内核时用的代理：优先系统代理；本机地址（内置端口）不能用则直连 */
function fetchProxy(): string {
  const s = useSettingsStore.getState();
  const sys = useAppStateStore.getState().systemProxyUrl || '';
  let p = s.proxy.useSystem ? sys : s.proxy.url;
  if (!p || p.includes('127.0.0.1')) p = sys;
  if (p.includes('127.0.0.1')) p = '';
  return p;
}

interface ClashStore {
  running: boolean;
  mixedPort: number;
  nodes: string[];
  now: string;
  /** 内核是否已安装 */
  coreInstalled: boolean;
  coreVersion: string;
  /** 正在安装内核 */
  installing: boolean;
  /** 安装进度 0..100（-1 未知） */
  installPct: number;
  /** 订阅流量（若有） */
  traffic: SubscriptionInfo | null;
  checkCore: () => Promise<void>;
  installCore: () => Promise<void>;
  start: (subUrl: string, port: number) => Promise<void>;
  stop: () => Promise<void>;
  apply: () => Promise<void>;
  listProxies: () => Promise<void>;
  select: (name: string) => Promise<void>;
}

export const useClashStore = create<ClashStore>((set, get) => ({
  running: false,
  mixedPort: 7899,
  nodes: [],
  now: '',
  coreInstalled: false,
  coreVersion: '',
  installing: false,
  installPct: -1,
  traffic: null,
  async checkCore() {
    try {
      const s = await invoke<CoreStatus>('clash_core_status');
      set({ coreInstalled: s.installed, coreVersion: s.version });
    } catch {
      // ignore
    }
  },
  async installCore() {
    set({ installing: true, installPct: -1 });
    const un = await listen<{
      phase: string;
      downloaded?: number;
      total?: number;
    }>('clash-progress', (e) => {
      const p = e.payload;
      if (p.phase === 'download' && p.total) {
        set({
          installPct: Math.round(((p.downloaded || 0) / p.total) * 100),
        });
      } else if (p.phase === 'extract') {
        set({ installPct: 100 });
      }
    });
    try {
      await invoke('clash_core_install', { proxyUrl: fetchProxy() || null });
      await get().checkCore();
    } finally {
      un();
      set({ installing: false });
    }
  },
  async start(subUrl, port) {
    const status = await invoke<ClashStatus>('clash_start', {
      subscriptionUrl: subUrl,
      mixedPort: port,
      proxyUrl: fetchProxy() || null,
    });
    const s = useSettingsStore.getState();
    await s.updateOne('proxy', 'enable', true);
    await s.updateOne('proxy', 'useSystem', false);
    await s.updateOne('proxy', 'url', `http://127.0.0.1:${status.mixed_port}`);
    set({
      running: true,
      mixedPort: status.mixed_port,
      traffic: status.subscription ?? null,
    });
    setTimeout(() => void get().listProxies(), 4000);
  },
  async stop() {
    await invoke('clash_stop');
    set({ running: false, nodes: [], now: '' });
  },
  async apply() {
    await get().checkCore();
    if (!get().coreInstalled) return;
    const bp = useSettingsStore.getState().builtinProxy;
    if (bp?.enable && bp.subscriptionUrl) {
      try {
        await get().start(bp.subscriptionUrl, bp.port || 7899);
      } catch (err) {
        log.error('启动内置代理失败', err);
      }
    }
  },
  async listProxies() {
    try {
      const v = await invoke<{ all?: string[]; now?: string }>('clash_proxies');
      set({ nodes: v.all || [], now: v.now || '' });
    } catch (err) {
      log.warn('读取节点失败', err);
    }
  },
  async select(name) {
    await invoke('clash_select', { name });
    set({ now: name });
  },
}));
