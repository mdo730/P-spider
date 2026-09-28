import { Settings } from '../interfaces/Settings';

export const DEFAULT_SETTINGS: Settings = {
  proxy: {
    enable: true,
    url: 'http://127.0.0.1:7890',
    useSystem: true,
  },
  download: {
    saveDirBase: '',
    dirTemplate: '',
    fileNameTemplate:
      '%POST_TIME% %USER_SCREEN_NAME% %POST_ID%-%MEDIA_INDEX%%EXT%',
    sameFileSkip: true,
    gifToRealGif: false,
  },
  app: {
    writeLogs: false,
    autoStart: true,
    closeAction: 'minimize',
    rememberCloseChoice: true,
  },
  split: {
    direction: 'horizontal',
    parts: 4,
    appendSourceInfo: false,
  },
  timeline: {
    maxTextLen: 200,
    maxImages: 6,
    rangeDays: 7,
  },
  imageSearch: {
    engine: 'google_lens',
    saucenaoKey: '',
    // 资源管理器右键「以图搜图」默认开启（启动时自动注册）
    explorerMenu: true,
  },
  guide: {
    // 首次启动自动打开「使用指南」
    showOnStart: true,
  },
  subscription: {
    // 订阅列表视图：详细 / 精简
    viewMode: 'detail',
  },
};

export const CURRENT_SETTINGS_VERSION = 4;
