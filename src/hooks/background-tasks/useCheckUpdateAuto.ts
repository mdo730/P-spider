import { useEffect } from 'react';
import { useUpdateStore } from '../../stores/update';

/** 启动时检测一次，之后每 24 小时检测一次（有新版时侧栏「关于」出现红点） */
const INTERVAL_MS = 24 * 60 * 60 * 1000;

export function useCheckUpdateAuto() {
  useEffect(() => {
    void useUpdateStore.getState().check();
    const timer = setInterval(() => {
      void useUpdateStore.getState().check();
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
