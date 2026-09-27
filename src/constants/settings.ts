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
};

export const CURRENT_SETTINGS_VERSION = 4;
