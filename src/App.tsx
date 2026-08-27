/* eslint-disable react/prop-types */
import { CloseCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { useMount } from 'ahooks';
import { Button, Checkbox, ConfigProvider, Modal, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api';
import { listen } from '@tauri-apps/api/event';
import { getCurrent } from '@tauri-apps/api/window';
import { SideBar } from './components/SideBar';
import { ANTD_THEME } from './constants/antd-theme';
import { useBootstrap } from './hooks/useBootstrap';
import { useRunBackgroundTasks } from './hooks/useRunBackgroundTasks';
import { useAppStateStore } from './stores/app-state';
import { useRouteStore } from './stores/route';
import { useSettingsStore } from './stores/settings';

const AppInternal: React.FC = () => {
  const currentRoute = useRouteStore((state) => state.route);
  const [closeModalVisible, setCloseModalVisible] = useState(false);
  const [rememberChoice, setRememberChoice] = useState(false);

  useMount(() => {
    log.info('Settings', useSettingsStore.getState());
    const appState = useAppStateStore.getState();
    log.info('AppStates', {
      ...appState,
      cookieString: appState.cookieString ? '******' : '[empty]',
    });
  });

  // 监听窗口关闭请求（Rust 侧拦截 CloseRequested 后发来）
  useEffect(() => {
    const unlistenPromise = listen('close-requested', async () => {
      const settings = useSettingsStore.getState();
      if (settings.app.closeAction === 'minimize') {
        await getCurrent().hide();
        return;
      }
      if (settings.app.closeAction === 'exit') {
        await invoke('quit_app');
        return;
      }
      // ask：弹窗让用户选择
      setCloseModalVisible(true);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const onCloseDecision = async (action: 'minimize' | 'exit') => {
    const settings = useSettingsStore.getState();
    if (rememberChoice) {
      // 记住选择，下次直接执行
      await settings.update({
        ...settings,
        app: {
          ...settings.app,
          closeAction: action,
          rememberCloseChoice: true,
        },
      });
    }
    setCloseModalVisible(false);
    if (action === 'minimize') {
      await getCurrent().hide();
    } else {
      await invoke('quit_app');
    }
  };

  useRunBackgroundTasks();

  return (
    <div className="bg-gray-50 w-full h-full overflow-auto">
      <SideBar />
      <main
        className="w-full overflow-auto transition-all pl-52"
        key={currentRoute?.id}
        aria-label={currentRoute?.name}
      >
        <div className="px-10">{currentRoute?.element}</div>
      </main>

      <Modal
        title="关闭 P-Spider？"
        open={closeModalVisible}
        closable={false}
        maskClosable={false}
        footer={[
          <Button
            key="minimize"
            onClick={() => onCloseDecision('minimize')}
            type="primary"
          >
            最小化到托盘
          </Button>,
          <Button key="exit" danger onClick={() => onCloseDecision('exit')}>
            退出
          </Button>,
        ]}
      >
        <p className="mb-2">选择关闭行为：</p>
        <Checkbox
          checked={rememberChoice}
          onChange={(e) => setRememberChoice(e.target.checked)}
        >
          记住我的选择
        </Checkbox>
      </Modal>
    </div>
  );
};

export const App: React.FC = () => {
  const { ready, error } = useBootstrap();

  return (
    <ConfigProvider
      theme={ANTD_THEME}
      autoInsertSpaceInButton={false}
      locale={zhCN}
    >
      <AntApp>
        <div className="css-var-r0 select-none text-gray-800 relative w-screen h-screen flex flex-col overflow-hidden">
          {!ready && (
            <div className="w-screen h-screen flex flex-col items-center justify-center">
              {!error && (
                <>
                  <LoadingOutlined className="text-5xl text-ant-color-primary" />
                  <p className="mt-4 text-xl">应用启动中，请稍候...</p>
                </>
              )}
              {error && (
                <>
                  <CloseCircleFilled className="text-5xl text-ant-color-error" />
                  <p className="mt-4 text-xl">应用启动失败，请尝试重启应用</p>
                  <p className="text-gray-600 mt-2">{error || '未知错误'}</p>
                </>
              )}
            </div>
          )}
          {ready && <AppInternal />}
        </div>
      </AntApp>
    </ConfigProvider>
  );
};
