import { DownloadFilter } from './DownloadFilter';
import { PlatformCreator, PlatformSource } from '../platforms';

export interface CreationTask {
  id: string;
  /** 平台源（twitter / pawchive），决定拉取方式 */
  source: PlatformSource;
  creator: PlatformCreator;
  filter: DownloadFilter;
  status: 'waiting' | 'active';
  completeCount: number;
  skipCount: number;
}
