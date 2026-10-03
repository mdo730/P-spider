/**
 * 宠物彩蛋模块统一出口（**轻量**，不引入 pet store）。
 *
 * 主窗口只从这里拿「打开宠物窗」和「连点解锁」；
 * 完整 UI/store 由桌面宠物窗单独 import（见 desktop/PetDesktop）。
 */

export {
  openPetWindow,
  closePetWindow,
  resizePetWindow,
  PET_LABEL,
} from './open-window';
export type { PetWindowSize } from './open-window';
export { useLogoUnlock } from './useLogoUnlock';
export { emitPetActivity, PET_ACTIVITY_EVENT } from './activity';
export type { PetActivityType, PetState } from './types';
