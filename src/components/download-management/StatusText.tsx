import React from 'react';
import { DownloadTask } from '../../interfaces/DownloadTask';
import * as R from 'ramda';
import clsx from 'clsx';

export interface StatusTextProps {
  task: DownloadTask;
}

export const StatusText: React.FC<StatusTextProps> = React.memo(({ task }) => {
  const [text, className] = R.cond<[DownloadTask], string[]>([
    [R.propEq('waiting', 'status'), R.always(['🟡等待中', 'text-gray-500'])],
    [R.propEq('active', 'status'), R.always(['▶︎下载中', ''])],
    [
      R.propEq('error', 'status'),
      (task) => [`❌️下载错误：${task.error || '未知原因'}`, 'text-red-500'],
    ],
    [R.propEq('paused', 'status'), R.always(['⏸︎已暂停', 'text-yellow-500'])],
    [R.propEq('complete', 'status'), R.always(['✅︎已完成', 'text-green-500'])],
    [R.T, R.always(['未知状态'])],
  ])(task);

  return (
    <span title={text} className={clsx('text-sm', className)}>
      {text}
    </span>
  );
});
