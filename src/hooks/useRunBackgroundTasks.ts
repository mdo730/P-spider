import { usePollSystemProxyUrl } from './background-tasks/usePollSystemProxyUrl';
import { useAriaBinding } from './background-tasks/useAriaBinding';
import { useTaskNotifications } from './background-tasks/useTaskNotifications';

export function useRunBackgroundTasks() {
  useTaskNotifications();
  usePollSystemProxyUrl();
  useAriaBinding();
}
