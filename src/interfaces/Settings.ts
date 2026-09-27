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
}

export type Settings = Settings_V3;
