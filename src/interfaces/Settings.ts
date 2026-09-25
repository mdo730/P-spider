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

export type Settings = Settings_V2;
