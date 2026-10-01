/* eslint-disable react/prop-types */
import {
  App,
  Avatar,
  Button,
  Checkbox,
  Dropdown,
  Form,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Switch,
  Tag,
  Tooltip,
} from 'antd';
import dayjs from 'dayjs';
import React, { useState } from 'react';
import {
  CheckCircleFilled,
  EditOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { fs, path } from '@tauri-apps/api';
import { PageHeader } from '../components/PageHeader';
import { ROUTES } from '../constants/routes';
import MediaType from '../enums/MediaType';
import { Subscription } from '../interfaces/Subscription';
import { retweetModeOf } from '../stores/subscription';
import { pinUserFolderName } from '../services/user-folders';
import xIcon from '../assets/platform-icons/x.png';
import pawchiveIcon from '../assets/platform-icons/pawchive.png';
import pixivIcon from '../assets/platform-icons/pixiv.svg';
import { LoadingOutlined, RetweetOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../stores/settings';
import { useSubscriptionStore } from '../stores/subscription';
import { useArchiverBrowseStore } from '../stores/archiver-browse';
import { useHomepageStore } from '../stores/homepage';
import { usePixivStore } from '../stores/pixiv';
import { useRouteStore } from '../stores/route';
import { buildUserUrl } from '../twitter/url';
import { resolveVariables } from '../utils/file-name-template';
import { showInFolder } from '../utils/shell';
import { useRemoteImageSrc } from '../hooks/useRemoteImage';

/** pixiv 头像在 i.pximg.net，需带 Referer 经后端拉取；其它平台直连 */
function useSubAvatar(sub: Subscription): string | undefined {
  const fetched = useRemoteImageSrc(
    sub.source === 'pixiv' ? sub.avatar : undefined,
    { headers: { Referer: 'https://www.pixiv.net/' } },
  );
  return sub.source === 'pixiv' ? fetched : sub.avatar;
}

const INTERVAL_OPTIONS = [
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 180, label: '3 小时' },
  { value: 360, label: '6 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '1 天' },
];

const STATUS_MAP: Record<
  Subscription['status'],
  { color: string; text: string }
> = {
  idle: { color: 'success', text: '正常' },
  running: { color: 'processing', text: '检查中' },
  paused: { color: 'warning', text: '已暂停' },
  error: { color: 'error', text: '出错' },
};

const PLATFORM_LABEL: Record<string, string> = {
  twitter: 'X',
  pawchive: 'Pawchive',
  pixiv: 'pixiv',
};

const PLATFORM_ICON: Record<string, string> = {
  twitter: xIcon,
  pawchive: pawchiveIcon,
  pixiv: pixivIcon,
};

const PLATFORM_TAG_COLOR: Record<string, string> = {
  twitter: 'blue',
  pawchive: 'purple',
  pixiv: 'geekblue',
};

/** 按订阅平台生成创作者主页链接 */
function buildSubProfileUrl(sub: Subscription): string {
  if (sub.source === 'pawchive') {
    const [service, user] = sub.username.split('/');
    return service && user
      ? `https://pawchive.pw/${service}/user/${user}`
      : '#';
  }
  if (sub.source === 'pixiv') {
    return `https://www.pixiv.net/users/${sub.username}`;
  }
  return buildUserUrl(sub.username);
}

/**
 * 点击订阅名 → 跳到 app 内对应标签页并加载该作者（不喂额外 ID，直接用订阅里已有的标识/主页链接）。
 * - X：loadUser 只吃 screenName（不解析链接）→ 喂 sub.username
 * - pixiv：loadUser 走 parsePixivInput，支持主页链接/纯数字 ID → 喂 sub.username
 * - Pawchive：load 支持完整主页链接 / service-id / 纯 ID → 喂 buildSubProfileUrl(sub)
 */
async function openSubInApp(sub: Subscription): Promise<void> {
  if (sub.source === 'pixiv') {
    const route = ROUTES.find((r) => r.id === 'pixiv');
    if (route) useRouteStore.getState().setRoute(route);
    usePixivStore.getState().setKeyword(sub.username);
    await usePixivStore.getState().loadUser(sub.username);
    return;
  }
  if (sub.source === 'pawchive') {
    const route = ROUTES.find((r) => r.id === 'archiver');
    if (route) useRouteStore.getState().setRoute(route);
    const identifier = buildSubProfileUrl(sub);
    useArchiverBrowseStore.getState().setKeyword(identifier);
    await useArchiverBrowseStore.getState().load(identifier);
    return;
  }
  // twitter：先清掉上一个用户的媒体列表，否则主页挂载时会走「加载更多」而非重新加载
  const hp = useHomepageStore.getState();
  hp.setKeyword(sub.username);
  hp.clearUser();
  hp.clearPostList();
  const home = ROUTES.find((r) => r.id === 'home');
  if (home) useRouteStore.getState().setRoute(home);
  await hp.loadUser(sub.username);
}

/** 相对时间格式化：刚刚 / X 分钟前 / X 小时前 / MM-DD HH:mm */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / 3600000)} 小时前`;
  }
  return dayjs(ts).format('MM-DD HH:mm');
}

export const SubscriptionPage: React.FC = () => {
  const { message } = App.useApp();
  const [checkingAll, setCheckingAll] = useState(false);
  const {
    subscriptions,
    removeSubscription,
    updateSubscription,
    setEnabled,
    checkNow,
    checkAll,
  } = useSubscriptionStore();
  const viewMode =
    useSettingsStore((s) => s.subscription?.viewMode) || 'detail';

  const onCheckAll = async () => {
    if (subscriptions.length === 0) {
      message.info('暂无订阅');
      return;
    }
    setCheckingAll(true);
    try {
      await checkAll();
      message.success('所有订阅已检查完毕');
    } catch (err: any) {
      message.error(`检查失败：${err?.message || '未知原因'}`);
    } finally {
      setCheckingAll(false);
    }
  };

  return (
    <>
      <PageHeader />

      <p className="mb-4 text-sm text-gray-400">
        本页只管理已有订阅（开关 / 编辑 /
        删除）。添加订阅请到「X主页」或「Pawchive」里搜索用户后点「订阅」。
      </p>

      <section className="bg-white rounded-md p-4 border-[1px]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold">订阅列表（{subscriptions.length}）</h2>
          <div className="flex items-center gap-2">
            <Segmented
              value={viewMode}
              onChange={(v) =>
                useSettingsStore
                  .getState()
                  .updateOne('subscription', 'viewMode', v as string)
              }
              options={[
                { label: '详细', value: 'detail' },
                { label: '精简', value: 'compact' },
              ]}
            />
            <Button
              icon={<ReloadOutlined />}
              loading={checkingAll}
              onClick={onCheckAll}
              disabled={subscriptions.length === 0}
            >
              一键刷新
            </Button>
          </div>
        </div>
        {subscriptions.length === 0 ? (
          <p className="text-gray-400 text-center py-8">
            还没有订阅，添加一个用户开始自动追更吧
          </p>
        ) : viewMode === 'compact' ? (
          <div className="flex flex-wrap gap-1.5">
            {subscriptions.map((sub) => (
              <SubscriptionCompact
                key={sub.id}
                sub={sub}
                onRemove={removeSubscription}
                onToggle={setEnabled}
                onCheckNow={checkNow}
              />
            ))}
          </div>
        ) : (
          <ul className="space-y-3">
            {subscriptions.map((sub) => (
              <SubscriptionItem
                key={sub.id}
                sub={sub}
                onRemove={removeSubscription}
                onToggle={setEnabled}
                onCheckNow={checkNow}
                onUpdate={updateSubscription}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
};

interface SubscriptionItemProps {
  sub: Subscription;
  onRemove: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onCheckNow: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Subscription>) => void;
}

const SubscriptionItem: React.FC<SubscriptionItemProps> = ({
  sub,
  onRemove,
  onToggle,
  onCheckNow,
  onUpdate,
}) => {
  const { message } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm<{
    intervalMin: number;
    mediaTypes: MediaType[];
    workTypes?: ('illust' | 'manga' | 'ugoira')[];
    includeRetweets?: boolean;
    observe?: boolean;
  }>();
  const avatarSrc = useSubAvatar(sub);
  const status = STATUS_MAP[sub.status];
  const intervalLabel =
    INTERVAL_OPTIONS.find((o) => o.value === sub.intervalMin)?.label ||
    `${sub.intervalMin} 分钟`;

  const openEdit = () => {
    form.setFieldsValue({
      intervalMin: sub.intervalMin,
      mediaTypes: sub.mediaTypes,
      workTypes:
        sub.workTypes && sub.workTypes.length
          ? sub.workTypes
          : ['illust', 'ugoira'],
      includeRetweets: retweetModeOf(sub) !== 'off',
      observe: sub.observe === true,
    });
    setEditing(true);
  };

  const openFolder = async () => {
    const settings = useSettingsStore.getState();
    // 用绑定的文件夹名（首次建夹时锁定的显示名），避免改名后指到不存在的目录
    const dirCreatorName = await pinUserFolderName(
      sub.source,
      { username: sub.username },
      sub.displayName || sub.username,
    );
    const dirName = resolveVariables(
      settings.download.dirTemplate,
      // 模板 replacer 读取的是 post.creator（见 constants/file-name-template）
      {
        post: {
          id: '',
          creator: {
            id: '',
            name: dirCreatorName || sub.displayName || sub.username,
            username: sub.username,
            avatar: '',
          },
          medias: [],
          tags: [],
          links: [],
        },
        media: { id: '', type: MediaType.Photo },
      } as unknown as Parameters<typeof resolveVariables>[1],
    );
    const dir = await path.join(settings.download.saveDirBase, dirName);
    if (await fs.exists(dir)) {
      await showInFolder(dir);
    } else {
      message.info(`${sub.username} 还没有下载文件夹`);
    }
  };

  const saveEdit = async () => {
    const values = await form.validateFields();
    if (sub.source === 'pixiv') {
      const workTypes =
        values.workTypes && values.workTypes.length
          ? values.workTypes
          : (['illust', 'ugoira'] as ('illust' | 'manga' | 'ugoira')[]);
      onUpdate(sub.id, {
        intervalMin: values.intervalMin,
        workTypes,
        observe: values.observe === true,
      });
      message.success(`已更新 ${sub.username} 的订阅设置`);
      setEditing(false);
      return;
    }
    if (!values.mediaTypes || values.mediaTypes.length === 0) {
      message.error('请至少选择一个媒体类型');
      return;
    }
    onUpdate(sub.id, {
      intervalMin: values.intervalMin,
      mediaTypes: values.mediaTypes,
      retweetMode: values.includeRetweets ? 'include' : 'off',
      observe: values.observe === true,
    });
    message.success(`已更新 ${sub.username} 的订阅设置`);
    setEditing(false);
  };

  return (
    <li className="flex items-center justify-between p-3 border-[1px] border-gray-200 rounded-md">
      <div className="flex items-center min-w-0">
        <div className="relative shrink-0">
          <Avatar src={avatarSrc} size={42} alt="头像">
            {(sub.displayName || sub.username)?.slice(0, 1)}
          </Avatar>
          {sub.observe && (
            <span
              title="观察模式：只进时间流，不自动下载"
              className="absolute -left-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] shadow ring-1 ring-black/5"
            >
              👀
            </span>
          )}
        </div>
        <div className="ml-3 min-w-0">
          <div className="flex items-center space-x-2">
            <Tag color={PLATFORM_TAG_COLOR[sub.source] || 'purple'}>
              {PLATFORM_LABEL[sub.source] || sub.source}
            </Tag>
            <button
              type="button"
              className="font-medium truncate text-ant-color-primary hover:underline"
              title={`${sub.username}（站内打开）`}
              onClick={() =>
                openSubInApp(sub).catch((err: any) =>
                  message.error(err?.message || '站内打开失败'),
                )
              }
            >
              {sub.displayName || sub.username}
            </button>
            <Tooltip title="在浏览器中打开">
              <a
                className="text-gray-400 hover:text-ant-color-primary"
                href={buildSubProfileUrl(sub)}
                target="_blank"
                rel="noreferrer"
              >
                <LinkOutlined />
              </a>
            </Tooltip>
            <Tag
              color={status.color}
              icon={sub.status === 'idle' ? <CheckCircleFilled /> : undefined}
            >
              {sub.status === 'idle' && sub.lastCheckedAt
                ? `上次 ${formatRelativeTime(sub.lastCheckedAt)}`
                : status.text}
            </Tag>
            {sub.errorMessage && (
              <Tooltip title={sub.errorMessage}>
                <Tag color="error">错误详情</Tag>
              </Tooltip>
            )}
            {retweetModeOf(sub) === 'include' && (
              <Tag color="magenta">含转贴</Tag>
            )}
            {retweetModeOf(sub) === 'only' && <Tag color="purple">仅转推</Tag>}
            {sub.observe && <Tag color="cyan">观察</Tag>}
          </div>
          <p className="text-sm text-gray-400 truncate">
            {sub.source === 'twitter' ? `@${sub.username}` : sub.username} ·
            间隔 {intervalLabel} · 已下载 {sub.downloadedCount}
          </p>
        </div>
      </div>
      <div className="flex items-center space-x-2 shrink-0">
        <Switch
          checked={sub.enabled}
          onChange={(checked) => onToggle(sub.id, checked)}
          checkedChildren="开启"
          unCheckedChildren="暂停"
        />
        <Button
          size="small"
          loading={sub.status === 'running'}
          onClick={() => onCheckNow(sub.id)}
        >
          立即检查
        </Button>
        <Button size="small" icon={<EditOutlined />} onClick={openEdit}>
          编辑
        </Button>
        <Button size="small" icon={<FolderOpenOutlined />} onClick={openFolder}>
          文件夹
        </Button>
        <Popconfirm
          title={`确定取消订阅 ${sub.username} 吗？`}
          onConfirm={() => onRemove(sub.id)}
        >
          <Button size="small" danger>
            删除
          </Button>
        </Popconfirm>
      </div>

      <Modal
        title={`编辑订阅 ${sub.username}`}
        open={editing}
        onOk={saveEdit}
        onCancel={() => setEditing(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item
            name="intervalMin"
            label="刷新间隔"
            rules={[{ required: true, message: '请选择刷新间隔' }]}
          >
            <Select options={INTERVAL_OPTIONS} />
          </Form.Item>
          {sub.source === 'pixiv' ? (
            <Form.Item
              name="workTypes"
              label="作品类型"
              rules={[
                {
                  required: true,
                  validator: (_, value) =>
                    value && value.length > 0
                      ? Promise.resolve()
                      : Promise.reject(new Error('请至少选择一种作品类型')),
                },
              ]}
            >
              <Checkbox.Group
                options={[
                  { label: '插画', value: 'illust' },
                  { label: '漫画', value: 'manga' },
                  { label: '动图', value: 'ugoira' },
                ]}
              />
            </Form.Item>
          ) : (
            <>
              <Form.Item
                name="mediaTypes"
                label="媒体类型"
                rules={[
                  {
                    required: true,
                    validator: (_, value) =>
                      value && value.length > 0
                        ? Promise.resolve()
                        : Promise.reject(new Error('请至少选择一个媒体类型')),
                  },
                ]}
              >
                <Checkbox.Group
                  options={[
                    { label: '照片', value: MediaType.Photo },
                    { label: '视频', value: MediaType.Video },
                    { label: 'GIF', value: MediaType.Gif },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="includeRetweets"
                valuePropName="checked"
                tooltip="转贴只进时间流，不下载（默认关闭）"
              >
                <Checkbox>转推</Checkbox>
              </Form.Item>
            </>
          )}
          <Form.Item
            name="observe"
            valuePropName="checked"
            tooltip="观察模式：只进时间流，不进行任何自动下载"
          >
            <Switch checkedChildren="观察" unCheckedChildren="自动下载" />
          </Form.Item>
        </Form>
      </Modal>
    </li>
  );
};

/**
 * 精简视图卡片（迷你）：头像 50×50，**顶部显示最近更新（检查）时间**，
 * ID 前带**平台图标**；有转贴（含/仅）时**右下角挂紫色转发小标志**。
 * 开关 / 立即检查 / 删除 移到**右键菜单**（暂停时卡片半透明）。
 */
const SubscriptionCompact: React.FC<{
  sub: Subscription;
  onRemove: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onCheckNow: (id: string) => void;
}> = ({ sub, onRemove, onToggle, onCheckNow }) => {
  const { modal, message } = App.useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const avatarSrc = useSubAvatar(sub);
  const mode = retweetModeOf(sub);
  const updated = sub.lastCheckedAt
    ? dayjs(sub.lastCheckedAt).format('MM-DD HH:mm')
    : '未检查';

  return (
    <Dropdown
      trigger={['contextMenu']}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      menu={{
        items: [
          {
            key: 'toggle',
            label: sub.enabled ? '暂停订阅' : '开启订阅',
          },
          { key: 'check', label: '立即检查' },
          { type: 'divider' },
          { key: 'remove', label: '删除订阅', danger: true },
        ],
        onClick: ({ key }) => {
          setMenuOpen(false);
          if (key === 'toggle') onToggle(sub.id, !sub.enabled);
          if (key === 'check') onCheckNow(sub.id);
          if (key === 'remove') {
            modal.confirm({
              title: `确定取消订阅 ${sub.username} 吗？`,
              okText: '删除',
              okButtonProps: { danger: true },
              cancelText: '取消',
              onOk: () => onRemove(sub.id),
            });
          }
        },
      }}
    >
      <div
        title={`${sub.username}（右键：开关 / 检查 / 删除）`}
        className={`relative flex w-[64px] cursor-default flex-col items-center rounded-md border-[1px] border-gray-100 bg-white p-0.5 transition-shadow hover:ring-2 hover:ring-ant-color-primary ${
          sub.enabled ? '' : 'opacity-50'
        }`}
      >
        <div className="relative">
          <Avatar src={avatarSrc} size={56} alt="头像" shape="square">
            {(sub.displayName || sub.username)?.slice(0, 1)}
          </Avatar>
          {sub.observe && (
            <span
              title="观察模式：只进时间流，不自动下载"
              className="absolute -left-1 -bottom-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] shadow ring-1 ring-black/5"
            >
              👀
            </span>
          )}
          {/* 顶部：最近更新（检查）时间 */}
          <span className="absolute top-0 left-0 right-0 rounded-t-sm bg-black/55 text-center text-[9px] leading-[13px] text-white">
            {updated}
          </span>
          {/* 右下角：有转贴（含/仅）时的紫色转发标志 */}
          {mode !== 'off' && (
            <span
              title={mode === 'only' ? '仅转推' : '含转贴'}
              className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500 text-white shadow"
            >
              <RetweetOutlined className="text-[9px]" />
            </span>
          )}
          {sub.status === 'running' && (
            <span className="absolute -left-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-ant-color-primary text-white shadow">
              <LoadingOutlined className="text-[9px]" />
            </span>
          )}
          {sub.status === 'error' && (
            <Tooltip title={sub.errorMessage}>
              <span className="absolute -left-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-ant-color-error text-white shadow">
                !
              </span>
            </Tooltip>
          )}
        </div>
        <button
          type="button"
          className="mt-1 flex w-full items-center gap-0.5"
          title={`${sub.username}（站内打开）`}
          onClick={(e) => {
            e.stopPropagation();
            openSubInApp(sub).catch((err: any) =>
              message.error(err?.message || '站内打开失败'),
            );
          }}
        >
          <img
            src={PLATFORM_ICON[sub.source] || xIcon}
            alt={PLATFORM_LABEL[sub.source] || sub.source}
            className="h-3 w-3 shrink-0 object-contain"
          />
          <span className="min-w-0 flex-1 truncate text-[11px] leading-4">
            {sub.displayName || sub.username}
          </span>
        </button>
      </div>
    </Dropdown>
  );
};
