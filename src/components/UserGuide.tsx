/* eslint-disable react/prop-types */
import { QuestionOutlined } from '@ant-design/icons';
import { Checkbox, Collapse, Drawer } from 'antd';
import { useMount } from 'ahooks';
import React, { useState } from 'react';
import { USER_GUIDE } from '../content/user-guide';
import { useSettingsStore } from '../stores/settings';

/**
 * 使用指南：右上角圆形「?」按钮 → 右侧抽屉。
 * 首次启动（设置 guide.showOnStart 未关）自动弹出，底部有「下次启动不再显示」。
 */
export const UserGuide: React.FC = () => {
  const [open, setOpen] = useState(false);
  /** 是否由「首次启动」自动打开（决定是否显示底部不再提示） */
  const [autoOpened, setAutoOpened] = useState(false);
  const [dontRemind, setDontRemind] = useState(false);

  useMount(() => {
    const show = useSettingsStore.getState().guide?.showOnStart !== false;
    if (show) {
      setAutoOpened(true);
      setOpen(true);
    }
  });

  const applyDontRemind = (checked: boolean) => {
    setDontRemind(checked);
    useSettingsStore.getState().updateOne('guide', 'showOnStart', !checked);
  };

  return (
    <>
      <button
        type="button"
        title="使用指南"
        aria-label="使用指南"
        onClick={() => {
          setAutoOpened(false);
          setOpen(true);
        }}
        className="fixed top-4 right-4 z-[900] flex h-9 w-9 items-center justify-center rounded-full border-[1px] border-gray-200 bg-white text-gray-500 shadow-sm transition-colors hover:border-ant-color-primary hover:text-ant-color-primary"
      >
        <QuestionOutlined />
      </button>

      <Drawer
        title="使用指南"
        placement="right"
        width={430}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          autoOpened ? (
            <Checkbox
              checked={dontRemind}
              onChange={(e) => applyDontRemind(e.target.checked)}
            >
              下次启动不再显示
            </Checkbox>
          ) : null
        }
      >
        <Collapse
          defaultActiveKey={[USER_GUIDE[0].id]}
          items={USER_GUIDE.map((s) => ({
            key: s.id,
            label: s.title,
            children: (
              <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-600">
                {s.items.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            ),
          }))}
        />
      </Drawer>
    </>
  );
};
