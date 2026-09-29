import { invoke } from '@tauri-apps/api';
import { App } from 'antd';
import { useEffect } from 'react';
import { exchangePixivCode } from '../../services/pixiv';

/**
 * 处理 pixiv 浏览器登录的 `pixiv://` 回跳：
 * 协议处理把 `pixiv://account/login?code=...` 交给（或转发给）P-Spider，
 * 这里轮询取出、用授权码换 refresh_token 完成登录。
 */
export function usePixivAuthRequests() {
  const { message } = App.useApp();
  useEffect(() => {
    if (!('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) return;
    let alive = true;
    const handle = async (raw: string) => {
      try {
        const u = await exchangePixivCode(raw);
        if (!alive) return;
        message.success(`pixiv 登录成功：${u.name}（@${u.account}）`);
        // 登录完成即移除协议注册（下次点「打开登录页」会重新注册）
        void invoke('set_pixiv_auth_scheme', { enabled: false }).catch(
          () => undefined,
        );
      } catch (err: any) {
        if (!alive) return;
        message.error(err?.message || 'pixiv 登录失败');
      }
    };
    const tick = async () => {
      try {
        const arg = await invoke<string | null>('take_pixiv_auth_arg');
        if (arg) {
          await handle(arg);
          return;
        }
        const pending = await invoke<string | null>('take_pending_pixiv_auth');
        if (pending) await handle(pending);
      } catch (err) {
        log.warn('处理 pixiv 授权回跳失败', err);
      }
    };
    const timer = setInterval(() => void tick(), 1500);
    void tick();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [message]);
}
