import { RetweetMode } from '../interfaces/Subscription';

/** 转贴模式选项（转贴从头到尾都不下载，只进时间流） */
export const RETWEET_MODE_OPTIONS: { value: RetweetMode; label: string }[] = [
  { value: 'off', label: '不抓转贴' },
  { value: 'include', label: '含转贴（原创照常下载）' },
  { value: 'only', label: '仅转推（只进时间流，不下载）' },
];

/** 精简的按钮/标签文案 */
export const RETWEET_MODE_LABEL: Record<RetweetMode, string> = {
  off: '不抓转贴',
  include: '含转贴',
  only: '仅转推',
};
