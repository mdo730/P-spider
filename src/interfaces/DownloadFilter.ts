import { Dayjs } from 'dayjs';
import MediaType from '../enums/MediaType';

export interface DownloadFilter {
  dateRange?: [start: Dayjs, end: Dayjs];
  mediaTypes?: MediaType[];
  source: 'medias' | 'tweets';
  /** pixiv 作品类型（仅 pixiv 建库/批量用） */
  workTypes?: ('illust' | 'manga' | 'ugoira')[];
}
