/* eslint-disable react/prop-types */
import {
  App,
  Avatar,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
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
  ReloadOutlined,
} from '@ant-design/icons';
import { fs, path } from '@tauri-apps/api';
import { PageHeader } from '../components/PageHeader';
import MediaType from '../enums/MediaType';
import { Subscription } from '../interfaces/Subscription';
import { useAppStateStore } from '../stores/app-state';
import { useSettingsStore } from '../stores/settings';
import { useSubscriptionStore } from '../stores/subscription';
import { buildUserUrl } from '../twitter/url';
import { resolveVariables } from '../utils/file-name-template';
import { showInFolder } from '../utils/shell';

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
  const [adding, setAdding] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const {
    subscriptions,
    addSubscription,
    removeSubscription,
    updateSubscription,
    setEnabled,
    checkNow,
    checkAll,
  } = useSubscriptionStore();
  const cookieString = useAppStateStore((s) => s.cookieString);

  const onAdd = async (values: {
    username: string;
    intervalMin: number;
    mediaTypes: MediaType[];
  }) => {
    const username = values.username?.trim();
    if (!username) {
      message.error('请输入用户 ID');
      return;
    }
    if (!values.mediaTypes || values.mediaTypes.length === 0) {
      message.error('请至少选择一个媒体类型');
      return;
    }
    setAdding(true);
    try {
      await addSubscription({
        username,
        intervalMin: values.intervalMin,
        mediaTypes: values.mediaTypes,
      });
      message.success(
        `已订阅 @${username}，首次检查将建立基线，后续新推文将自动下载`,
      );
    } catch (err: any) {
      message.error(`订阅失败：${err?.message || '未知原因'}`);
    } finally {
      setAdding(false);
    }
  };

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

      <section className="bg-white rounded-md p-4 border-[1px] mb-4">
        <h2 className="font-bold mb-4">添加订阅</h2>
        <Form
          layout="inline"
          onFinish={onAdd}
          initialValues={{
            intervalMin: 720,
            mediaTypes: [MediaType.Photo, MediaType.Video, MediaType.Gif],
          }}
          disabled={!cookieString}
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户 ID' }]}
          >
            <Input
              placeholder={
                cookieString
                  ? '用户 ID，如：shiratamacaron'
                  : '请先登录后再添加订阅'
              }
              style={{ width: 220 }}
            />
          </Form.Item>
          <Form.Item name="intervalMin" label="刷新间隔">
            <Select options={INTERVAL_OPTIONS} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="mediaTypes" label="媒体类型">
            <Checkbox.Group
              options={[
                { label: '照片', value: MediaType.Photo },
                { label: '视频', value: MediaType.Video },
                { label: 'GIF', value: MediaType.Gif },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={adding}>
              订阅
            </Button>
          </Form.Item>
        </Form>
      </section>

      <section className="bg-white rounded-md p-4 border-[1px]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold">订阅列表（{subscriptions.length}）</h2>
          <Button
            icon={<ReloadOutlined />}
            loading={checkingAll}
            onClick={onCheckAll}
            disabled={!cookieString || subscriptions.length === 0}
          >
            一键刷新
          </Button>
        </div>
        {subscriptions.length === 0 ? (
          <p className="text-gray-400 text-center py-8">
            还没有订阅，添加一个用户开始自动追更吧
          </p>
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
  }>();
  const status = STATUS_MAP[sub.status];
  const intervalLabel =
    INTERVAL_OPTIONS.find((o) => o.value === sub.intervalMin)?.label ||
    `${sub.intervalMin} 分钟`;

  const openEdit = () => {
    form.setFieldsValue({
      intervalMin: sub.intervalMin,
      mediaTypes: sub.mediaTypes,
    });
    setEditing(true);
  };

  const openFolder = async () => {
    const settings = useSettingsStore.getState();
    const dirName = resolveVariables(
      settings.download.dirTemplate,
      // 目录模板通常只依赖用户字段（如 %USER_NAME%），构造最小数据即可
      {
        post: {
          user: {
            name: sub.displayName || sub.username,
            screenName: sub.username,
            id: '',
            avatar: '',
          },
        },
      } as unknown as Parameters<typeof resolveVariables>[1],
    );
    const dir = await path.join(settings.download.saveDirBase, dirName);
    if (await fs.exists(dir)) {
      await showInFolder(dir);
    } else {
      message.info(`@${sub.username} 还没有下载文件夹`);
    }
  };

  const saveEdit = async () => {
    const values = await form.validateFields();
    if (!values.mediaTypes || values.mediaTypes.length === 0) {
      message.error('请至少选择一个媒体类型');
      return;
    }
    onUpdate(sub.id, {
      intervalMin: values.intervalMin,
      mediaTypes: values.mediaTypes,
    });
    message.success(`已更新 @${sub.username} 的订阅设置`);
    setEditing(false);
  };

  return (
    <li className="flex items-center justify-between p-3 border-[1px] border-gray-200 rounded-md">
      <div className="flex items-center min-w-0">
        <Avatar src={sub.avatar} size={42} alt="头像">
          {(sub.displayName || sub.username)?.slice(0, 1)}
        </Avatar>
        <div className="ml-3 min-w-0">
          <div className="flex items-center space-x-2">
            <a
              className="font-medium truncate"
              href={buildUserUrl(sub.username)}
              target="_blank"
              rel="noreferrer"
              title={sub.username}
            >
              {sub.displayName || sub.username}
            </a>
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
          </div>
          <p className="text-sm text-gray-400 truncate">
            @{sub.username} · 间隔 {intervalLabel} · 已下载{' '}
            {sub.downloadedCount}
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
          title={`确定取消订阅 @${sub.username} 吗？`}
          onConfirm={() => onRemove(sub.id)}
        >
          <Button size="small" danger>
            删除
          </Button>
        </Popconfirm>
      </div>

      <Modal
        title={`编辑订阅 @${sub.username}`}
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
        </Form>
      </Modal>
    </li>
  );
};
