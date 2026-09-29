/* eslint-disable react/prop-types */
import { Button } from 'antd';
import React, { useEffect, useState } from 'react';
import { useGuidePlayerStore } from '../../stores/guide-player';

/**
 * 分章「假界面」引导播放器：全屏浮层。
 * 支持单章播放与「连续播放全部」；连续模式下多一个「跳过本章」。
 */
export const GuidePlayer: React.FC = () => {
  const chapters = useGuidePlayerStore((s) => s.chapters);
  const close = useGuidePlayerStore((s) => s.close);
  const [ci, setCi] = useState(0);
  const [si, setSi] = useState(0);

  // 每次打开/换章节都从第一步开始
  useEffect(() => {
    setCi(0);
    setSi(0);
  }, [chapters]);

  if (!chapters || chapters.length === 0) return null;

  const chapter = chapters[Math.min(ci, chapters.length - 1)];
  const steps = chapter.steps;
  const safeSi = Math.min(si, steps.length - 1);
  const step = steps[safeSi];
  const multi = chapters.length > 1;
  const atStart = ci === 0 && safeSi === 0;

  const next = () => {
    if (safeSi < steps.length - 1) setSi(safeSi + 1);
    else if (ci < chapters.length - 1) {
      setCi(ci + 1);
      setSi(0);
    } else close();
  };
  const prev = () => {
    if (safeSi > 0) setSi(safeSi - 1);
    else if (ci > 0) {
      setCi(ci - 1);
      setSi(chapters[ci - 1].steps.length - 1);
    }
  };
  const skipChapter = () => {
    if (ci < chapters.length - 1) {
      setCi(ci + 1);
      setSi(0);
    } else close();
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-label="新手引导"
      onClick={close}
    >
      <div
        className="w-[760px] max-w-full rounded-xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-gray-400">
            {multi ? chapter.title : ''}
          </span>
          <span className="shrink-0 text-xs text-gray-400">
            {safeSi + 1}/{steps.length}
          </span>
        </div>

        <div className="mb-3 text-base font-bold text-gray-800">
          {step.title}
        </div>
        <div className="mb-3">{step.render()}</div>
        <p className="mb-4 text-sm leading-relaxed text-gray-600">
          {step.desc}
        </p>

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button size="small" onClick={close}>
              跳过
            </Button>
            {multi && (
              <Button size="small" onClick={skipChapter}>
                跳过本章
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="small" disabled={atStart} onClick={prev}>
              上一步
            </Button>
            <Button size="small" type="primary" onClick={next}>
              {ci === chapters.length - 1 && safeSi === steps.length - 1
                ? '完成'
                : '下一步'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
