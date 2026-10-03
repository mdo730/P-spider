/**
 * 打开 / 关闭 / 调整桌面宠物窗。
 *
 * 宠物锚定窗口**右上角**；打开面板时窗口**向左**扩展（宠物窗本就贴在屏幕右侧），
 * 从而面板出现在宠物左侧且宠物屏幕位置不变。
 */

import {
  getAll,
  getCurrent,
  LogicalPosition,
  LogicalSize,
  WebviewWindow,
} from '@tauri-apps/api/window';

export const PET_LABEL = 'pet';

export type PetWindowSize = 'base' | 'panel' | 'attr' | 'adopt';

/** 各 UI 状态下的窗口尺寸（逻辑像素） */
export const PET_WINDOW_SIZE: Record<
  PetWindowSize,
  { width: number; height: number }
> = {
  base: { width: 268, height: 250 },
  panel: { width: 360, height: 250 },
  attr: { width: 440, height: 280 },
  adopt: { width: 250, height: 250 },
};

function isTauri(): boolean {
  return '__TAURI__' in window || '__TAURI_INTERNALS__' in window;
}

function findPetWindow(): WebviewWindow | null {
  return (
    WebviewWindow.getByLabel(PET_LABEL) ??
    getAll().find((w) => w.label === PET_LABEL) ??
    null
  );
}

export function openPetWindow(): void {
  if (!isTauri()) return;

  const existing = findPetWindow();
  if (existing) {
    void existing.show();
    void existing.setFocus();
    return;
  }

  const { width, height } = PET_WINDOW_SIZE.base;
  let x: number | undefined;
  let y: number | undefined;
  try {
    x = Math.max(0, window.screen.availWidth - width - 40);
    y = Math.max(0, window.screen.availHeight - height - 80);
  } catch {
    x = undefined;
    y = undefined;
  }

  try {
    const win = new WebviewWindow(PET_LABEL, {
      title: '香蕉君',
      width,
      height,
      x,
      y,
      transparent: true,
      decorations: false,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: false,
    });
    win.once('tauri://error', (e) => {
      log.error('打开香蕉君窗口失败', e);
    });
  } catch (err) {
    log.error('创建香蕉君窗口异常', err);
  }
}

export function closePetWindow(): void {
  if (!isTauri()) return;
  const win = findPetWindow();
  if (win) void win.close();
}

/**
 * 调整宠物窗大小：保持**右上角**不动（向左/向下扩展）。
 */
export async function resizePetWindow(size: PetWindowSize): Promise<void> {
  if (!isTauri()) return;
  const target = PET_WINDOW_SIZE[size];
  try {
    const win = getCurrent();
    const scale = window.devicePixelRatio || 1;
    const pos = await win.outerPosition();
    const cur = await win.outerSize();
    const curW = cur.width / scale;
    const curX = pos.x / scale;
    const curY = pos.y / scale;
    // 先撑大（向右下），再把左边界往左推，使右边界固定
    const newX = Math.round(curX + (curW - target.width));
    await win.setSize(new LogicalSize(target.width, target.height));
    await win.setPosition(new LogicalPosition(newX, curY));
  } catch {
    // ignore
  }
}
