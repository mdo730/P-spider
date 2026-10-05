/* eslint-disable react/prop-types */
import React, { useCallback } from 'react';
import { DownloadList } from './DownloadList';
import * as R from 'ramda';
import { useDownloadStore } from '../../stores/download';
import { DownloadTask } from '../../interfaces/DownloadTask';

export const TabDownloading: React.FC = () => {
  const setAutoSyncIds = useDownloadStore((s) => s.setAutoSyncTaskIds);

  const onInScreenTasksChanged = useCallback(
    (tasks: DownloadTask[]) => {
      // MEGA 任务非 aria2，不参与 tellStatus 轮询
      setAutoSyncIds(tasks.filter((t) => !t.isMega).map((t) => t.gid));
    },
    [setAutoSyncIds],
  );

  return (
    <DownloadList
      batchActions={['pauseAll', 'unpauseAll', 'deleteAll']}
      onInScreenTasksChanged={onInScreenTasksChanged}
      filter={(t) => ['waiting', 'active', 'paused'].includes(t.status)}
      sort={(a, b) => {
        const transformStatus = R.cond([
          [R.equals('active'), R.always(0)],
          [R.equals('paused'), R.always(1)],
          [R.equals('waiting'), R.always(2)],
          [R.T, R.always(3)],
        ]);
        return transformStatus(a.status) - transformStatus(b.status);
      }}
    />
  );
};
