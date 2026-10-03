/* eslint-disable react/prop-types */
import React, { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import Logo from '../../src-tauri/icons/128x128.png';
import { useCheckUpdate } from '../hooks/useCheckUpdate';
import { message, confirm } from '@tauri-apps/api/dialog';
import { fs, path } from '@tauri-apps/api';
import { Switch } from 'antd';
import { useUpdateStore } from '../stores/update';
import { useAppStateStore } from '../stores/app-state';
import { closePetWindow, openPetWindow, useLogoUnlock } from '../pet';

export const About: React.FC = () => {
  const checkForUpdate = useCheckUpdate();
  const { onLogoTap } = useLogoUnlock();
  const petUnlocked = useAppStateStore((s) => s.petUnlocked);
  const petEnabled = useAppStateStore((s) => s.petEnabled);
  const setPetEnabled = useAppStateStore((s) => s.setPetEnabled);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const onTogglePet = (checked: boolean) => {
    setPetEnabled(checked);
    if (checked) openPetWindow();
    else closePetWindow();
  };

  const onDeletePetData = async () => {
    const ok = await confirm('确定删除香蕉君的全部数据吗？此操作不可恢复。', {
      title: '删除宠物数据',
      type: 'warning',
    });
    if (!ok) return;
    closePetWindow();
    try {
      const dir = await path.appDataDir();
      const file = await path.join(dir, 'pet.json');
      if (await fs.exists(file)) await fs.removeFile(file);
      message('宠物数据已删除', { title: '香蕉君' });
    } catch (err: any) {
      message(err?.message || '删除失败，请稍后再试', { title: '删除失败' });
    }
  };
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  const latestVersion = useUpdateStore((s) => s.latestVersion);

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
        <img
          src={Logo}
          className="w-28"
          alt="logo"
          draggable={false}
          onClick={onLogoTap}
        />
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
          {hasUpdate && (
            <span className="ml-2 text-red-500">
              有新版本 v{latestVersion} 可用
            </span>
          )}
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
      {petUnlocked && (
        <section className="mt-6 space-y-2">
          <div className="flex items-center gap-3">
            <span>宠物</span>
            <Switch checked={petEnabled} onChange={onTogglePet} />
          </div>
          <div>
            <button
              onClick={onDeletePetData}
              className="rounded border border-red-300 px-2 py-0.5 text-sm text-red-600 hover:bg-red-50"
            >
              删除宠物数据
            </button>
          </div>
        </section>
      )}
    </>
  );
};
