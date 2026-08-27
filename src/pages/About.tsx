/* eslint-disable react/prop-types */
import React, { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import Logo from '../../src-tauri/icons/128x128.png';
import { useCheckUpdate } from '../hooks/useCheckUpdate';
import { message } from '@tauri-apps/api/dialog';

export const About: React.FC = () => {
  const checkForUpdate = useCheckUpdate();
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const onCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const hasUpdate = await checkForUpdate();
      if (!hasUpdate) {
        message('软件已是最新版本', {
          title: '软件已是最新版本',
        });
      }
    } catch (err: any) {
      log.error(err);
      message(err?.message || '无法获取最新更新，请稍后再试', {
        title: '获取更新错误',
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  return (
    <>
      <PageHeader />
      <section className="flex items-center">
        <img src={Logo} className="w-28" alt="logo" />
        <span className="text-5xl ml-4 font-bold">P-Spider</span>
      </section>
      <ul className="space-y-2 [&_a]:underline">
        <li>
          <strong>版本号：</strong>
          <span>{PACKAGE_JSON_VERSION}</span>
          <button
            onClick={onCheckUpdate}
            className="bg-transparent text-blue-500 disabled:text-gray-400 ml-2"
            disabled={isCheckingUpdate}
          >
            {isCheckingUpdate ? '请稍候...' : '检查更新'}
          </button>
        </li>
        <li>
          <strong>作者：</strong>
          <span>parukamun</span>
        </li>
        <li>
          <strong>基于</strong>
          <a
            href="https://github.com/MiningCattiva/x-spider"
            target="_blank"
            rel="noreferrer"
          >
            X-Spider
          </a>
          开发
        </li>
        <li>
          <strong>仓库地址：</strong>
          <a
            href="https://github.com/mdo730/P-spider"
            target="_blank"
            rel="noreferrer"
          >
            https://github.com/mdo730/P-spider
          </a>
        </li>
        <li>
          <strong>开源协议：</strong>
          <a
            href="https://github.com/mdo730/P-spider/blob/master/LICENSE"
            target="_blank"
            rel="noreferrer"
          >
            {PACKAGE_JSON_LICENSE}
          </a>
        </li>
      </ul>
    </>
  );
};
