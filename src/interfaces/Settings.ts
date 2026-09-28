export interface Settings_V1 {
  proxy: {
    enable: boolean;
    url: string;
    useSystem: boolean;
  };
  download: {
    savePath: string;
    fileNameTemplate: string;
    sameFileSkip: boolean;
  };
  app: {
    writeLogs: boolean;
  };
}

export interface Settings_V2 {
  proxy: {
    enable: boolean;
    url: string;
    useSystem: boolean;
  };
  download: {
    saveDirBase: string;
    dirTemplate: string;
    fileNameTemplate: string;
    sameFileSkip: boolean;
    /** GIF(animated_gif) 下载后自动用 ffmpeg 转成真实 .gif（需系统装有 ffmpeg；默认关闭） */
    gifToRealGif?: boolean;
  };
  app: {
    writeLogs: boolean;
    autoStart: boolean;
    closeAction: 'minimize' | 'exit' | 'ask';
    rememberCloseChoice: boolean;
  };
  /** 图片切割预设（本地库右键「复制切割图像」用） */
  split: {
    /** horizontal=左右切（竖条）；vertical=上下切（横条） */
    direction: 'horizontal' | 'vertical';
    parts: number;
    /** 复制切割图像时，附带「作者ID / 原文链接」文本一起进剪贴板（默认关闭） */
    appendSourceInfo?: boolean;
  };
}

export interface Settings_V3 extends Settings_V2 {
  /** 时间流展示限制 */
  timeline: {
    /** 正文最大展示字数（超出折叠） */
    maxTextLen: number;
    /** 单条最大展示图片数（超出折叠） */
    maxImages: number;
    /** 进时间流的 moeyo 分类 id 白名单（不设置 = 全部；设置后只显示这些） */
    moeyoCategoryIds?: number[];
    /** 时间流保留天数（1~30，默认 7） */
    rangeDays?: number;
  };
  /** 以图搜图 */
  imageSearch?: {
    /** 使用的搜索引擎 id（默认 google_lens） */
    engine?: string;
    /** SauceNAO API Key（可选） */
    saucenaoKey?: string;
    /** 是否在资源管理器右键显示「以图搜图」 */
    explorerMenu?: boolean;
  };
  /** 使用指南 */
  guide?: {
    /** 启动时自动打开使用指南（默认 true；用户勾「不再显示」后置 false） */
    showOnStart?: boolean;
  };
  /** 订阅页展示 */
  subscription?: {
    /** 订阅列表视图：detail 详细（默认）/ compact 精简 */
    viewMode?: 'detail' | 'compact';
  };
}

export type Settings = Settings_V3;
