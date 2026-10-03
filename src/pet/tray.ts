/**
 * 系统托盘 tooltip：把宠物现状显示在托盘图标悬停提示里。
 * 由桌面宠物窗在状态变化时调用（内部做了节流）。
 */

import { invoke } from '@tauri-apps/api';
import { isSick, taskRemaining } from './engine';
import type { PetState } from './types';

let lastText = '';
let lastAt = 0;

export function updateTrayTooltip(s: PetState): void {
  const remain = taskRemaining(s.task, Date.now());
  const doing = s.task
    ? s.task.type === 'work'
      ? `打工中 剩${Math.ceil(remain / 60000)}分`
      : `学习中 剩${Math.ceil(remain / 60000)}分`
    : '发呆中';
  const text =
    `${s.name}｜饱${Math.round(s.satiety)} 洁${Math.round(s.cleanliness)} ` +
    `心${Math.round(s.mood)} 健${Math.round(s.health)} 力${Math.round(s.energy)}` +
    `${isSick(s) ? ' · 生病' : ''}\n${doing}｜🪙${Math.floor(s.coin)}`;

  const now = Date.now();
  if (text === lastText && now - lastAt < 15000) return;
  lastText = text;
  lastAt = now;
  void invoke('set_tray_tooltip', { text }).catch(() => undefined);
}
