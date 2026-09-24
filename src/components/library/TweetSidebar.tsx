/* eslint-disable react/prop-types */
import { CloseOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Avatar } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useRemoteImageSrc } from '../../hooks/useRemoteImage';
import { FileTweetInfo } from '../../stores/download-history';
import { useSubscriptionStore } from '../../stores/subscription';
import { getUser } from '../../twitter/api';
import { buildUserUrl } from '../../twitter/url';
import { openUrl } from '../../utils/shell';

/** 用户信息缓存（用户名 → 头像/昵称），避免重复请求 */
const authorCache = new Map<string, { avatar?: string; name?: string }>();

interface Props {
  info?: FileTweetInfo;
  fileName?: string;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * 屏幕右侧固定的推文信息条（覆盖在预览之上，不挤占图像）。
 * 点击头像/@ID → 作者主页；点击时间 → 原推文；左上角可折叠、右上角关闭。
 */
export const TweetSidebar: React.FC<Props> = ({
  info,
  fileName,
  onClose,
  collapsed,
  onToggleCollapse,
}) => {
  const [authorInfo, setAuthorInfo] = useState<{
    avatar?: string;
    name?: string;
  } | null>(null);
  const [imgError, setImgError] = useState(false);

  // 该 body class 用于 CSS 隐藏 antd 预览/弹窗自带的关闭按钮、并把右切换箭头左移
  useEffect(() => {
    if (collapsed) {
      document.body.classList.remove('library-tweet-bar-open');
      return;
    }
    document.body.classList.add('library-tweet-bar-open');
    return () => document.body.classList.remove('library-tweet-bar-open');
  }, [collapsed]);

  // 缺头像时：优先用「订阅」里已有的头像/昵称（本地、免请求），否则按用户名拉一次（带缓存）
  useEffect(() => {
    const username = info?.username;
    if (!username || info?.avatar) {
      setAuthorInfo(null);
      return;
    }
    const sub = useSubscriptionStore
      .getState()
      .subscriptions.find((s) => s.username === username);
    if (sub?.avatar || sub?.displayName) {
      setAuthorInfo({ avatar: sub.avatar, name: sub.displayName });
      return;
    }
    const cached = authorCache.get(username);
    if (cached) {
      setAuthorInfo(cached);
      return;
    }
    let cancelled = false;
    getUser(username)
      .then((user) => {
        const value = { avatar: user.avatar, name: user.name };
        authorCache.set(username, value);
        if (!cancelled) setAuthorInfo(value);
      })
      .catch((err) => log.warn('拉取作者信息失败', err));
    return () => {
      cancelled = true;
    };
  }, [info?.username, info?.avatar]);

  const avatarUrl = info?.avatar || authorInfo?.avatar;
  const remoteAvatar = useRemoteImageSrc(avatarUrl);
  useEffect(() => setImgError(false), [avatarUrl]);

  if (collapsed) {
    return ReactDOM.createPortal(
      <button
        aria-label="展开推文信息"
        onClick={onToggleCollapse}
        title="展开推文信息"
        className="fixed top-4 right-0 z-[2000] flex items-center justify-center bg-[#16181c] text-white rounded-l-md px-2 py-3 hover:bg-[#2a2d33] cursor-pointer border-0"
      >
        <LeftOutlined />
      </button>,
      document.body,
    );
  }

  const displayName =
    info?.displayName || authorInfo?.name || info?.username || '未知作者';
  const profileUrl = info?.username ? buildUserUrl(info.username) : undefined;
  const handle = info?.username ? `@${info.username}` : undefined;

  return ReactDOM.createPortal(
    <aside
      aria-label="推文信息"
      className="fixed top-0 right-0 h-full w-[20rem] z-[2000] bg-[#16181c] text-white overflow-y-auto shadow-2xl"
    >
      <div className="p-5">
        <div className="flex items-center justify-between">
          <button
            aria-label="收起"
            onClick={onToggleCollapse}
            title="收起"
            className="bg-transparent border-0 p-0 cursor-pointer text-gray-400 hover:text-white"
          >
            <RightOutlined />
          </button>
          <button
            aria-label="关闭"
            onClick={onClose}
            title="关闭"
            className="bg-transparent border-0 p-0 cursor-pointer text-gray-400 hover:text-white"
          >
            <CloseOutlined />
          </button>
        </div>

        <div className="flex items-center gap-3 mt-2">
          {profileUrl ? (
            <button
              onClick={() => openUrl(profileUrl)}
              className="shrink-0 bg-transparent border-0 p-0 cursor-pointer"
              title="打开作者主页"
            >
              <Avatar
                src={imgError ? undefined : remoteAvatar}
                size={48}
                alt={displayName}
                onError={() => {
                  setImgError(true);
                  return true;
                }}
              >
                {displayName.slice(0, 1)}
              </Avatar>
            </button>
          ) : (
            <Avatar
              src={imgError ? undefined : remoteAvatar}
              size={48}
              alt={displayName}
              onError={() => {
                setImgError(true);
                return true;
              }}
            >
              {displayName.slice(0, 1)}
            </Avatar>
          )}
          <div className="min-w-0">
            <div className="font-semibold truncate" title={displayName}>
              {displayName}
            </div>
            {handle &&
              (profileUrl ? (
                <button
                  className="block max-w-full bg-transparent border-0 p-0 text-left text-sm text-gray-400 hover:text-white hover:underline truncate cursor-pointer"
                  onClick={() => openUrl(profileUrl)}
                  title="打开作者主页"
                >
                  {handle}
                </button>
              ) : (
                <div className="text-sm text-gray-400 truncate">{handle}</div>
              ))}
          </div>
        </div>

        {info?.text && (
          <p className="mt-4 text-[15px] leading-relaxed whitespace-pre-wrap break-words">
            {info.text}
          </p>
        )}

        {info?.time &&
          (info.url ? (
            <button
              className="mt-4 bg-transparent border-0 p-0 cursor-pointer text-sm text-gray-400 hover:text-white hover:underline"
              onClick={() => openUrl(info.url!)}
              title="打开原推文"
            >
              {dayjs(info.time).format('YYYY-MM-DD HH:mm')}
            </button>
          ) : (
            <div className="mt-4 text-sm text-gray-400">
              {dayjs(info.time).format('YYYY-MM-DD HH:mm')}
            </div>
          ))}

        {!info && (
          <div className="mt-4 text-sm text-gray-500">未找到关联推文信息</div>
        )}
      </div>

      {fileName && (
        <div className="px-5 pb-5 text-xs text-gray-500 break-all">
          {fileName}
        </div>
      )}
    </aside>,
    document.body,
  );
};
