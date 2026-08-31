import { PlatformAdapter, PlatformSource } from './types';
import { twitterAdapter } from './twitter';
import { pawchiveAdapter } from './pawchive';

export * from './types';
export { twitterAdapter, TWITTER_SOURCE } from './twitter';
export { pawchiveAdapter, PAWCHIVE_SOURCE } from './pawchive';
export { withCreator } from './archiver';

const adapters: Partial<Record<PlatformSource, PlatformAdapter>> = {
  twitter: twitterAdapter,
  pawchive: pawchiveAdapter,
};

/**
 * 按平台源获取适配器。
 * 阶段2/3 起，订阅/下载 store 应通过本函数按订阅的 source 获取适配器，
 * 替代当前直接调用 twitter/api 的写法。
 */
export function getAdapter(source: PlatformSource): PlatformAdapter {
  const adapter = adapters[source];
  if (!adapter) {
    throw new Error(`未知平台: ${source}`);
  }
  return adapter;
}
