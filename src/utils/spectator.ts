import { useSettingsStore } from '../stores/settings';

/**
 * 超级旁观者模式是否开启。
 *
 * 开启后：订阅检查 / 站点追新等「自动」下载一律跳过（但仍更新基线与缓存，时间流照常）；
 * 手动操作（显式保存该文章、手动建库等）不受影响。
 */
export function isSpectatorOn(): boolean {
  return useSettingsStore.getState().app?.spectator === true;
}
