/**
 * 活动上报（对外的唯一入口）。
 *
 * 主窗口不持有宠物存档，只把行为通过 Tauri 事件广播给桌面宠物窗；
 * 宠物窗负责真正结算。未解锁或非 Tauri 环境直接忽略。
 */

import { emit } from '@tauri-apps/api/event';
import { useAppStateStore } from '../stores/app-state';
import type { PetActivityType } from './types';

/** 供业务侧订阅的事件名（桌面宠物窗监听它） */
export const PET_ACTIVITY_EVENT = 'pet-activity';

function isTauri(): boolean {
  return '__TAURI__' in window || '__TAURI_INTERNALS__' in window;
}

export function emitPetActivity(type: PetActivityType): void {
  if (!useAppStateStore.getState().petUnlocked) return;
  if (!isTauri()) return;
  void emit(PET_ACTIVITY_EVENT, type).catch(() => undefined);
}
