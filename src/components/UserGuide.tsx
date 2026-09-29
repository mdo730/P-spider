/* eslint-disable react/prop-types */
import { QuestionOutlined } from '@ant-design/icons';
import { Button, Collapse, Drawer } from 'antd';
import { useMount } from 'ahooks';
import React, { useState } from 'react';
import { USER_GUIDE } from '../content/user-guide';
import { GUIDE_TOURS } from '../content/guide-tours';
import { GuidePlayer } from './guide/GuidePlayer';
import { useGuidePlayerStore } from '../stores/guide-player';
import { useSettingsStore } from '../stores/settings';

/**
 * 使用指南：右上角圆形「?」按钮 → 右侧抽屉。
 * 首次启动自动播放「新手引导」（设置 guide.showOnStart 未关）；抽屉里可重新播放。
 */
export const UserGuide: React.FC = () => {
  const [open, setOpen] = useState(false);

  useMount(() => {
    if (useSettingsStore.getState().guide?.showOnStart !== false) {
      // 首次启动：播放新手引导（第 1 章「快速上手」），并把 showOnStart 关掉不再自动弹
      useGuidePlayerStore.getState().open('start');
      useSettingsStore.getState().updateOne('guide', 'showOnStart', false);
    }
  });

  return (
    <>
      <button
        type="button"
        title="使用指南"
        aria-label="使用指南"
        data-tour="help"
        onClick={() => setOpen(true)}
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
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-400">
              各章可单独播放，也可一次看完全部
            </span>
            <Button
              type="primary"
              onClick={() => {
                setOpen(false);
                useGuidePlayerStore.getState().playAll();
              }}
            >
              连续播放全部引导
            </Button>
          </div>
        }
      >
        <Collapse
          defaultActiveKey={[USER_GUIDE[0].id]}
          items={USER_GUIDE.map((s) => ({
            key: s.id,
            label: s.title,
            children: (
              <div>
                {GUIDE_TOURS[s.id]?.length ? (
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    className="mb-2"
                    onClick={() => {
                      setOpen(false);
                      useGuidePlayerStore.getState().open(s.id);
                    }}
                  >
                    ▶ 播放本节引导
                  </Button>
                ) : null}
                <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-600">
                  {s.items.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            ),
          }))}
        />
      </Drawer>

      <GuidePlayer />
    </>
  );
};
