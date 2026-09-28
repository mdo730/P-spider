import { usePollSystemProxyUrl } from './background-tasks/usePollSystemProxyUrl';
import { useAriaBinding } from './background-tasks/useAriaBinding';
import { useTaskNotifications } from './background-tasks/useTaskNotifications';
import { useCheckUpdateAuto } from './background-tasks/useCheckUpdateAuto';
import { useImageSearchRequests } from './background-tasks/useImageSearchRequests';

export function useRunBackgroundTasks() {
  useTaskNotifications();
  usePollSystemProxyUrl();
  useAriaBinding();
  useCheckUpdateAuto();
  useImageSearchRequests();
}
