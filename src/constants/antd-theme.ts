import { ThemeConfig } from 'antd';

/** 主色（按钮 / 链接 / 开关等） */
export const PRIMARY_COLOR = '#239FF0';
/** 超级旁观者模式主色 */
export const PRIMARY_COLOR_SPECTATOR = '#E7587B';

/** 侧栏背景渐变（上 → 下；中间用网点过渡） */
export const SIDEBAR_GRADIENT = { top: '#239FF0', bottom: '#72DCF0' };
/** 侧栏背景渐变（超级旁观者模式：顶部换粉） */
export const SIDEBAR_GRADIENT_SPECTATOR = {
  top: '#E7587B',
  bottom: '#72DCF0',
};

export const ANTD_THEME: ThemeConfig = {
  token: {
    colorPrimary: PRIMARY_COLOR,
  },
  cssVar: true,
  hashed: false,
};
