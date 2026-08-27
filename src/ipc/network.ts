import { invoke } from '@tauri-apps/api';
import { Response } from '../interfaces/Response';
import { RequestOptions } from '../interfaces/RequestOptions';
import * as R from 'ramda';
import { useAppStateStore } from '../stores/app-state';
import { useSettingsStore } from '../stores/settings';
import { delay } from '../utils';

const MAX_RETRY_COUNT = 16;
const MAX_RETRY_DELAY = 16000;

let log: ICategoriedLogger;

export async function request(options: RequestOptions) {
  if (!log) {
    log = window.log.category('NET');
  }
  const url = new URL(options.url);

  if (options.query) {
    Object.entries(options.query).forEach(([k, v]) => {
      url.searchParams.append(k, v);
    });
  }

  const settings = useSettingsStore.getState();
  const appState = useAppStateStore.getState();
  // useSystem 时用轮询到的系统代理地址显式传给后端，避免 reqwest 系统代理缓存问题
  // bypassProxy：绕过代理直连（pawchive 等免登录站点直连更快）
  const useProxy = options.bypassProxy ? false : settings.proxy.enable;
  const resolvedProxy = useProxy
    ? settings.proxy.useSystem
      ? appState.systemProxyUrl
      : settings.proxy.url
    : '';
  const maxRetry = options.maxRetry ?? MAX_RETRY_COUNT;
  let remainingRetryCount = maxRetry;
  let retryDelay = 100;
  let lastErr: any;

  while (remainingRetryCount > 0) {
    try {
      return await requestInternal(
        R.defaultTo('GET', options.method),
        url.href,
        R.defaultTo('', options.body),
        useProxy,
        resolvedProxy,
        R.defaultTo({}, options.headers),
        options.responseType,
      );
    } catch (err: any) {
      lastErr = err;
      log.warn(
        `Request failed, retry after ${retryDelay}ms, remaining retry count: ${remainingRetryCount}`,
        err,
      );
      await delay(retryDelay);
      remainingRetryCount--;
      retryDelay *= 2;
      if (retryDelay > MAX_RETRY_DELAY) {
        retryDelay = MAX_RETRY_DELAY;
      }
    }
  }

  log.error('Max retry count reached, last error:', lastErr);
  throw lastErr;
}

let reqIdGlobal = 0;

async function requestInternal(
  method: string,
  url: string,
  body: string,
  enableProxy: boolean,
  proxyUrl: string,
  headers: Record<string, string>,
  responseType: string,
): Promise<Response> {
  const startTs = Date.now();
  const reqId = reqIdGlobal++;
  log.info(`REQ_${reqId}`, method, url, {
    body,
    enableProxy,
    proxyUrl,
    headers: {
      ...headers,
      Cookie: headers.Cookie ? '******' : undefined,
    },
    responseType,
  });

  const res = await invoke<Response>('network_fetch', {
    method,
    url,
    body,
    enableProxy,
    proxyUrl,
    headers,
    responseType,
  });

  const endTs = Date.now() - startTs;
  // 只打印状态与耗时，避免每次同步序列化整个响应体（大 JSON 会卡主线程）
  log.info(`RES_${reqId}(+${endTs}ms)`, res.status, url);

  return res;
}

export async function getSystemProxy(): Promise<string> {
  const map: Record<string, string> = await invoke(
    'network_get_system_proxy_url',
  );
  const value = map.https || map.http;
  if (value) {
    return `http://${value}`;
  }
  return '';
}
