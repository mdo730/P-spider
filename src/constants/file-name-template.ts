import * as R from 'ramda';
import { FileNameTemplateData } from '../interfaces/FileNameTemplateData';
import MediaType from '../enums/MediaType';
import { PlatformCreator, PlatformMedia, PlatformPost } from '../platforms';
import dayjs from 'dayjs';
import { unicodeSubstring } from '../utils/unicode';

export const EXAMPLE_USER: Required<PlatformCreator> = {
  avatar:
    'https://pbs.twimg.com/profile_images/1440258619912585220/KiYN-52Z_normal.jpg',
  name: '这是用户昵称',
  username: 'userscreenname',
  id: '1145141919',
  profileUrl: 'https://twitter.com/userscreenname',
};

export const EXAMPLE_POST: Required<PlatformPost> = {
  id: '1145141919810',
  source: 'twitter',
  creator: EXAMPLE_USER,
  publishedAt: dayjs(1705756536000),
  text: '这里是推文内容,这里是推文内容，这里是推文内容，这里是推文内容，这里是推文内容，这里是推文内容。',
  medias: [
    {
      id: '1748695771262889984',
      url: 'https://pbs.twimg.com/media/GESdifpaMAA6rth.jpg',
      thumbUrl:
        'https://pbs.twimg.com/media/GESdifpaMAA6rth.jpg?format=jpg&name=thumb',
      downloadUrl: 'https://pbs.twimg.com/media/GESdifpaMAA6rth.jpg?name=orig',
      width: 1323,
      height: 1136,
      type: MediaType.Photo,
      fileName: '',
      videoInfo: {},
    },
  ],
  tags: ['标签1', '标签2'],
  links: [],
  postUrl: 'https://twitter.com/userscreenname/status/1145141919810',
};

export const EXAMPLE_MEDIA: Required<PlatformMedia> = EXAMPLE_POST
  .medias[0] as Required<PlatformMedia>;

export const EXAMPLE_FILE_NAME_TEMPLATE_DATA: FileNameTemplateData = {
  media: EXAMPLE_MEDIA,
  post: EXAMPLE_POST,
};

export const REPLACER_MAP: Record<
  string,
  {
    desc: string;
    params?: {
      name: string;
      desc: string;
      default: string;
    }[];
    replacer: (
      data: FileNameTemplateData,
      params: Record<string, string>,
    ) => string | undefined;
  }
> = {
  POST_ID: {
    desc: '推文 ID',
    replacer: R.path(['post', 'id']),
  },
  POST_TIME: {
    desc: '推文发布日期',
    replacer: (data, params) => {
      if (!data.post.publishedAt) return '未知日期';
      const dateOnly = params.d ? params.d === '1' : false;
      return data.post.publishedAt.format(
        dateOnly ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH-mm-ss',
      );
    },
    params: [
      {
        name: 'd',
        desc: '仅日期（0 或 1）',
        default: '0',
      },
    ],
  },
  USER_ID: {
    desc: '用户 ID',
    replacer: R.path(['post', 'creator', 'id']),
  },
  USER_NAME: {
    desc: '用户昵称',
    replacer: R.path(['post', 'creator', 'name']),
  },
  USER_SCREEN_NAME: {
    desc: '用户名',
    replacer: R.path(['post', 'creator', 'username']),
  },
  MEDIA_ID: {
    desc: '资源 ID',
    replacer: R.path(['media', 'id']),
  },
  MEDIA_WIDTH: {
    desc: '资源宽度',
    replacer: R.path(['media', 'width']),
  },
  MEDIA_HEIGHT: {
    desc: '资源高度',
    replacer: R.path(['media', 'height']),
  },
  MEDIA_INDEX: {
    desc: '资源索引',
    replacer: (data) =>
      (
        data.post.medias!.findIndex((media) => media.id === data.media.id) + 1
      ).toString(),
  },
  CONTENT: {
    desc: '推文内容',
    params: [
      {
        name: 't',
        desc: '截断长度',
        default: '16',
      },
    ],
    replacer: (data, params) => {
      const paramTrim = Number(params.t);
      const trimLen = Number.isNaN(paramTrim) ? 32 : Math.floor(paramTrim);
      return data.post.text ? unicodeSubstring(data.post.text, 0, trimLen) : '';
    },
  },
  MEDIA_TYPE: {
    desc: '媒体类型',
    replacer: (data) => data.media.type,
  },
  EXT: {
    desc: '扩展名',
    replacer: R.pipe(
      (data) => data.media.downloadUrl || data.media.url || '',
      R.split('.'),
      R.last,
      R.split('?'),
      R.head,
      (s) => `.${s}`,
    ),
  },
  TAGS: {
    desc: '推文标签',
    replacer: R.pipe(
      // @ts-ignore
      R.path(['post', 'tags']),
      R.join(','),
    ),
  },
};
