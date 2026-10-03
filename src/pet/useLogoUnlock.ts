/**
 * 「连点 Logo 解锁彩蛋」hook。
 *
 * 在 3 秒内连点 total 次解锁；解锁状态存在 app-state（主窗口），
 * 解锁后自动打开桌面宠物窗。
 */

import { App } from 'antd';
import { useCallback, useRef } from 'react';
import { useAppStateStore } from '../stores/app-state';
import { openPetWindow } from './open-window';

export function useLogoUnlock(total = 5, windowMs = 3000) {
  const { message } = App.useApp();
  const taps = useRef<number[]>([]);
  const unlocked = useAppStateStore((s) => s.petUnlocked);
  const unlockPet = useAppStateStore((s) => s.unlockPet);
  const setPetEnabled = useAppStateStore((s) => s.setPetEnabled);

  const onLogoTap = useCallback(() => {
    const now = Date.now();
    taps.current = taps.current.filter((t) => now - t < windowMs);
    taps.current.push(now);
    if (taps.current.length >= total) {
      taps.current = [];
      if (!unlocked) {
        unlockPet();
        setPetEnabled(true);
        message.open({ content: '🥚 彩蛋解锁：香蕉君来啦～', type: 'success' });
      }
      openPetWindow();
    }
  }, [total, windowMs, unlocked, unlockPet, setPetEnabled, message]);

  return { onLogoTap };
}
