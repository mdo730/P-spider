export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  url: string;
  query?: Record<string, any>;
  headers?: Record<string, string>;
  body?: any;
  responseType: 'json' | 'text' | 'binary';
  /**
   * 绕过代理直连（用于无需代理且直连更快的站点，如 pawchive）。
   * 默认 false（走系统/自定义代理，X 需要代理）。
   */
  bypassProxy?: boolean;
  /**
   * 最大重试次数，默认 16。直连站点建议调低（如 3），
   * 避免网络偶发失败触发重试风暴（退避累计会拖很久）。
   */
  maxRetry?: number;
}
