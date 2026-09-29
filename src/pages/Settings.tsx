/* eslint-disable react/prop-types */
import React, { useEffect, useState } from 'react';
import { invoke, dialog, fs } from '@tauri-apps/api';
import clsx from 'clsx';
import { PageHeader } from '../components/PageHeader';
import { Section, SettingsTabContext } from '../components/settings/Section';
import { Item } from '../components/settings/Item';
import {
  DownloadOutlined,
  FolderOutlined,
  GlobalOutlined,
  ScissorOutlined,
  ClockCircleOutlined,
  SearchOutlined,
  MenuOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import Joi from 'joi';
import { SavePathSelector } from '../components/settings/SavePathSelector';
import {
  App,
  Avatar,
  Button,
  Checkbox,
  DatePicker,
  Divider,
  Input,
  InputNumber,
  Modal,
  Radio,
  Segmented,
  Switch,
} from 'antd';
import { useSettingsStore } from '../stores/settings';
import { useSettingsUiStore } from '../stores/settings-ui';
import { FileNameTemplateInput } from '../components/settings/FileNameTemplateInput';
import { openUrlForeground, showInFolder } from '../utils/shell';
import { path } from '@tauri-apps/api';
import { useSubscriptionStore } from '../stores/subscription';
import { clearThumbCache, getThumbCacheStats } from '../utils/thumbnail';
import { LibraryFolderStats, formatBytes } from '../utils/library';
import { useLibraryTraceStore } from '../stores/library-trace';
import { useVideoCoverCacheStore } from '../stores/library-video-cover-cache';
import { useThumbCacheStore } from '../stores/library-thumb-cache';
import { useFigmemoStore } from '../stores/figmemo';
import {
  FigmemoCategory,
  fetchCategories,
  rebuildFigmemoMakerTags,
} from '../services/figmemo';
import { useMoeyoStore } from '../stores/moeyo';
import {
  MoeyoCategory,
  fetchCategories as fetchMoeyoCategories,
} from '../services/moeyo';
import dayjs, { Dayjs } from 'dayjs';
import { exportUserBackup, importUserBackup } from '../services/user-backup';
import {
  buildPixivLoginUrl,
  exchangePixivCode,
  verifyPixivLogin,
} from '../services/pixiv';
import { useRemoteImageSrc } from '../hooks/useRemoteImage';
import { SIDEBAR_HIDEABLE_IDS, applySidebarOrder } from '../constants/routes';

/** 设置页分组（左栏二级导航） */
const SETTINGS_GROUPS = [
  { key: 'general', label: '常规' },
  { key: 'download', label: '下载' },
  { key: 'platform', label: '平台' },
  { key: 'sites', label: '站点' },
  { key: 'tools', label: '工具与数据' },
];
/** 区块 name → 分组 */
const SECTION_GROUP: Record<string, string> = {
  app: 'general',
  proxy: 'general',
  sidebar: 'general',
  timeline: 'general',
  download: 'download',
  split: 'download',
  pixiv: 'platform',
  parukamun: 'sites',
  moeyo: 'sites',
  library: 'tools',
  imageSearch: 'tools',
  dataBackup: 'tools',
};
const groupOf = (name: string) => SECTION_GROUP[name] ?? 'general';

export const Settings: React.FC = () => {
  const { message, modal } = App.useApp();
  const settingsTab = useSettingsUiStore((s) => s.tab);
  const setSettingsTab = useSettingsUiStore((s) => s.setTab);
  const { exportSubscriptions, importSubscriptions } = useSubscriptionStore();
  const [backupBusy, setBackupBusy] = useState(false);
  const [rebuildingTags, setRebuildingTags] = useState(false);
  const [cacheStats, setCacheStats] = useState<LibraryFolderStats | null>(null);
  const trace = useLibraryTraceStore();
  const videoCover = useVideoCoverCacheStore();
  const thumbCache = useThumbCacheStore();
  const figmemo = useFigmemoStore();
  const [figmemoCategories, setFigmemoCategories] = useState<FigmemoCategory[]>(
    [],
  );
  const moeyo = useMoeyoStore();
  const [moeyoCategories, setMoeyoCategories] = useState<MoeyoCategory[]>([]);
  const updateOne = useSettingsStore((s) => s.updateOne);
  const sidebarOrder = useSettingsStore((s) => s.sidebar?.order || []);
  const sidebarHidden = useSettingsStore((s) => s.sidebar?.hidden || []);
  const sidebarIconOnly = useSettingsStore((s) => s.sidebar?.iconOnly === true);
  const [sidebarModalOpen, setSidebarModalOpen] = useState(false);
  const splitCfg = useSettingsStore((s) => s.split);
  const timelineCfg = useSettingsStore((s) => s.timeline);
  const proxyCfg = useSettingsStore((s) => s.proxy);
  const appCfg = useSettingsStore((s) => s.app);
  const [proxyUrlDraft, setProxyUrlDraft] = useState(proxyCfg.url);
  useEffect(() => {
    setProxyUrlDraft(proxyCfg.url);
  }, [proxyCfg.url]);
  const orderedRoutes = applySidebarOrder(sidebarOrder);
  const moveSidebarRoute = (idx: number, dir: -1 | 1) => {
    const ids = orderedRoutes.map((r) => r.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    updateOne('sidebar', 'order', ids);
  };
  const setSidebarHidden = (id: string, show: boolean) => {
    const next = show
      ? sidebarHidden.filter((x) => x !== id)
      : [...sidebarHidden, id];
    updateOne('sidebar', 'hidden', next);
  };
  const imageSearchCfg = useSettingsStore((s) => s.imageSearch) || {};
  const setImageSearch = (key: string, value: unknown) =>
    useSettingsStore.getState().updateOne('imageSearch', key, value);
  const onToggleExplorer = async (checked: boolean) => {
    setImageSearch('explorerMenu', checked);
    try {
      await invoke('set_image_search_explorer_menu', { enabled: checked });
      message.success(
        checked ? '已添加到资源管理器右键' : '已从资源管理器右键移除',
      );
    } catch (err: any) {
      message.error(err?.message || '设置失败');
    }
  };
  const moeyoTimelineSetting = useSettingsStore(
    (s) => s.timeline?.moeyoCategoryIds,
  );
  // 未设置 = 全部进时间流（呈现为全选）
  const timelineCats = moeyoTimelineSetting ?? moeyoCategories.map((c) => c.id);
  const [buildYears, setBuildYears] = useState<[Dayjs, Dayjs] | null>(null);
  const [moeyoBuildYears, setMoeyoBuildYears] = useState<[Dayjs, Dayjs] | null>(
    null,
  );
  const pixivCfg = useSettingsStore((s) => s.pixiv) || {};
  const pixivSelfAvatar = useRemoteImageSrc(
    pixivCfg.userId ? pixivCfg.userAvatar : undefined,
    { headers: { Referer: 'https://www.pixiv.net/' } },
  );
  const [pixivToken, setPixivToken] = useState(pixivCfg.refreshToken || '');
  const [pixivBusy, setPixivBusy] = useState(false);
  const [pixivCode, setPixivCode] = useState('');
  const [pixivLoginBusy, setPixivLoginBusy] = useState(false);
  const onPixivOpenLogin = async () => {
    try {
      const url = await buildPixivLoginUrl();
      // 注册 pixiv:// 协议处理，浏览器登录后自动把 code 回传给 P-Spider（零复制）
      try {
        await invoke('set_pixiv_auth_scheme', { enabled: true });
      } catch (err) {
        log.warn('注册 pixiv:// 协议失败（可改用粘贴）', err);
      }
      await openUrlForeground(url);
      message.info(
        '已打开登录页；登录完成后会自动回到 P-Spider 完成登录（若没自动回，可把地址栏整段粘到右侧）',
      );
    } catch (err: any) {
      message.error(err?.message || '打开登录页失败');
    }
  };
  const onPixivComplete = async () => {
    if (!pixivCode.trim()) {
      message.error('请粘贴登录后的链接或 code');
      return;
    }
    setPixivLoginBusy(true);
    try {
      const u = await exchangePixivCode(pixivCode);
      setPixivToken(useSettingsStore.getState().pixiv?.refreshToken || '');
      setPixivCode('');
      message.success(`pixiv 登录成功：${u.name}（@${u.account}）`);
    } catch (err: any) {
      message.error(err?.message || 'pixiv 登录失败');
    } finally {
      setPixivLoginBusy(false);
    }
  };
  const savePixiv = async () => {
    setPixivBusy(true);
    try {
      await updateOne('pixiv', 'refreshToken', pixivToken.trim());
      const u = await verifyPixivLogin();
      message.success(`pixiv 登录成功：${u.name}（@${u.account}）`);
    } catch (err: any) {
      message.error(err?.message || 'pixiv 校验失败');
    } finally {
      setPixivBusy(false);
    }
  };
  const clearPixiv = async () => {
    for (const k of [
      'refreshToken',
      'cookie',
      'userId',
      'userName',
      'userAccount',
      'userAvatar',
    ]) {
      await updateOne('pixiv', k, '');
    }
    setPixivToken('');
    message.success('已清除 pixiv 登录信息');
  };

  useEffect(() => {
    fetchCategories()
      .then((map) => setFigmemoCategories([...map.values()]))
      .catch((err) => log.warn('读取 fig-memo 分类失败', err));
    fetchMoeyoCategories()
      .then(({ cats }) => setMoeyoCategories([...cats.values()]))
      .catch((err) => log.warn('读取 moeyo 分类失败', err));
  }, []);

  const figmemoStatusText = (() => {
    if (figmemo.running && figmemo.progress) {
      const p = figmemo.progress;
      const verb = p.phase === 'building' ? '建库中' : '检查中';
      return `${verb} ${p.done}/${p.total}…`;
    }
    if (figmemo.lastError) return `上次出错：${figmemo.lastError}`;
    if (figmemo.enabledCategories.length > 0) {
      const parts: string[] = [
        `已订阅 ${figmemo.enabledCategories.length} 个分类`,
      ];
      if (figmemo.lastCheckedAt) {
        parts.push(
          `上次检查 ${dayjs(figmemo.lastCheckedAt).format('MM-DD HH:mm')}`,
        );
      }
      parts.push(`累计下载 ${figmemo.downloadedCount}`);
      return parts.join(' · ');
    }
    if (figmemo.downloadedCount > 0) {
      return `未订阅 · 累计下载 ${figmemo.downloadedCount}`;
    }
    return '默认关闭';
  })();

  const moeyoStatusText = (() => {
    if (moeyo.running && moeyo.progress) {
      const p = moeyo.progress;
      const verb = p.phase === 'building' ? '建库中' : '检查中';
      return `${verb} ${p.done}/${p.total}…`;
    }
    if (moeyo.lastError) return `上次出错：${moeyo.lastError}`;
    if (moeyo.enabledCategories.length > 0) {
      const parts: string[] = [
        `已订阅 ${moeyo.enabledCategories.length} 个分类`,
      ];
      if (moeyo.lastCheckedAt) {
        parts.push(
          `上次检查 ${dayjs(moeyo.lastCheckedAt).format('MM-DD HH:mm')}`,
        );
      }
      parts.push(`累计下载 ${moeyo.downloadedCount}`);
      return parts.join(' · ');
    }
    if (moeyo.downloadedCount > 0) {
      return `未订阅 · 累计下载 ${moeyo.downloadedCount}`;
    }
    return '默认关闭';
  })();

  const thumbStatusText = (() => {
    if (thumbCache.error) return `失败：${thumbCache.error}`;
    if (thumbCache.phase === 'scanning') return '正在扫描文件…';
    if (thumbCache.phase === 'generating' && thumbCache.progress) {
      const p = thumbCache.progress;
      return `生成中 ${p.processedFiles}/${p.totalFiles}（新增 ${p.generated}，跳过 ${p.skipped}${
        p.failed ? `，失败 ${p.failed}` : ''
      }）`;
    }
    if (thumbCache.result) {
      const r = thumbCache.result;
      return `${r.aborted ? '已中止，' : '完成：'}共 ${r.total} 张，新增 ${r.generated}，跳过 ${r.skipped}${
        r.failed ? `，失败 ${r.failed}` : ''
      }`;
    }
    return '为现有图片预生成缩略图缓存，之后浏览不再有初次载入卡顿';
  })();

  const traceStatusText = (() => {
    if (trace.error) return `失败：${trace.error}`;
    if (trace.phase === 'scanning' && trace.progress) {
      return `扫描作者 ${trace.progress.processedAuthors}/${trace.progress.totalAuthors}…`;
    }
    if (trace.phase === 'tracing' && trace.progress) {
      return `溯源作者 ${trace.progress.processedAuthors}/${trace.progress.totalAuthors}${
        trace.progress.currentAuthor
          ? `（${trace.progress.currentAuthor}）`
          : ''
      }，已匹配 ${trace.progress.matchedFiles} 个文件`;
    }
    if (trace.result) {
      const r = trace.result;
      return `${r.aborted ? '已中止，' : '完成：'}匹配 ${r.matched} 个文件 / ${r.authors} 个作者${
        r.skipped ? `，跳过 ${r.skipped} 个` : ''
      }`;
    }
    return '将已下载的老文件按文件名回溯推文信息（仅 X，需登录；已删除的推文无法找回）';
  })();

  const videoCoverStatusText = (() => {
    if (videoCover.error) return `失败：${videoCover.error}`;
    if (videoCover.phase !== 'idle' && videoCover.progress) {
      const p = videoCover.progress;
      const label = p.phase === 'scanning' ? '扫描中' : '填充封面';
      return `${label} ${p.processedFiles}/${p.totalFiles}（已写 ${p.generated}，跳过 ${p.skipped}）…`;
    }
    if (videoCover.result) {
      const r = videoCover.result;
      return `${r.aborted ? '已中止，' : '完成：'}写入 ${r.generated} 个封面 / 共 ${r.total} 个视频${
        r.failed ? `，失败 ${r.failed} 个（多无在线封面）` : ''
      }`;
    }
    return '给本地视频批量生成封面（优先 ffmpeg 取首帧；没 ffmpeg 时回退在线封面）';
  })();

  const refreshCacheStats = async () => {
    try {
      setCacheStats(await getThumbCacheStats());
    } catch (err) {
      log.warn('读取缓存占用失败', err);
      setCacheStats(null);
    }
  };

  useEffect(() => {
    refreshCacheStats();
  }, []);

  // 一键生成完成后刷新缓存占用显示
  useEffect(() => {
    if (!thumbCache.running && thumbCache.result) {
      refreshCacheStats();
    }
  }, [thumbCache.running, thumbCache.result]);

  const onExport = async () => {
    const json = exportSubscriptions();
    const filePath = await dialog.save({
      title: '导出订阅',
      defaultPath: 'p-spider-subscriptions.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!filePath) return;
    await fs.writeTextFile(filePath, json);
    message.success('订阅已导出');
  };

  const onImport = async () => {
    const filePath = await dialog.open({
      title: '导入订阅',
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!filePath) return;
    try {
      const content = await fs.readTextFile(String(filePath));
      const { added, skipped } = importSubscriptions(content);
      message.success(`导入完成：新增 ${added} 个，跳过 ${skipped} 个`);
    } catch (err: any) {
      message.error(`导入失败：${err?.message || '未知原因'}`);
    }
  };

  const onExportBackup = async () => {
    setBackupBusy(true);
    try {
      const dest = await exportUserBackup();
      if (dest) message.success('用户数据已导出');
    } catch (err: any) {
      message.error(`导出失败：${err?.message || '未知原因'}`);
    } finally {
      setBackupBusy(false);
    }
  };

  const onImportBackup = async () => {
    setBackupBusy(true);
    try {
      const res = await importUserBackup();
      if (!res) return;
      modal.confirm({
        title: '导入完成，需重启生效',
        content: `已恢复 ${res.restored.length} 个数据文件。原数据已备份为 *.pre-import。是否立即重启？`,
        okText: '立即重启',
        cancelText: '稍后手动重启',
        onOk: () => invoke('relaunch_app'),
      });
    } catch (err: any) {
      message.error(`导入失败：${err?.message || '未知原因'}`);
    } finally {
      setBackupBusy(false);
    }
  };
  return (
    <>
      <PageHeader />
      <div className="flex items-start gap-6">
        <aside className="sticky top-4 w-36 shrink-0">
          <ul className="space-y-1">
            {SETTINGS_GROUPS.map((g) => (
              <li key={g.key}>
                <button
                  type="button"
                  onClick={() => setSettingsTab(g.key)}
                  className={clsx(
                    'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                    settingsTab === g.key
                      ? 'bg-ant-color-primary text-white'
                      : 'text-gray-600 hover:bg-gray-100',
                  )}
                >
                  {g.label}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="min-w-0 flex-1">
          <SettingsTabContext.Provider value={{ active: settingsTab, groupOf }}>
            <Section
              title="下载"
              name="download"
              titleIcon={<DownloadOutlined />}
            >
              <div data-tour="save-path">
                <Item
                  validator={(value) => {
                    return Joi.string()
                      .messages({
                        'string.empty': '请填写保存路径模板',
                      })
                      .validate(value).error?.message;
                  }}
                  label="保存路径"
                  settingKey="saveDirBase"
                >
                  <SavePathSelector required />
                </Item>
              </div>
              <Item
                validator={(value) => {
                  return Joi.string()
                    .pattern(
                      // eslint-disable-next-line
                      /^([^\\\/:\*\"<>\|]\\?)+$/,
                    )
                    .message(
                      '文件夹名有误，请检查文件夹名是否正确，文件夹名不能包含以下字符：? * / \\ < > : " |',
                    )
                    .$.pattern(/^\s+$/, { invert: true })
                    .message('文件夹名不能为纯空格！')
                    .allow('')
                    .validate(value).error?.message;
                }}
                label="文件夹模板"
                settingKey="dirTemplate"
                description="为空时下载的文件直接保存在上方的“保存路径”里面"
              >
                <FileNameTemplateInput />
              </Item>
              <Item
                settingKey="fileNameTemplate"
                label="文件名模板"
                validator={(value) => {
                  return Joi.string()
                    .pattern(
                      // eslint-disable-next-line
                      /^[^\\\/:\*\"<>\|]+$/,
                    )
                    .message(
                      '文件名有误，请检查文件名是否正确，文件名不能包含以下字符：? * / \\ < > : " |',
                    )
                    .$.pattern(/^\s+$/, { invert: true })
                    .message('文件名不能为纯空格！')
                    .messages({
                      'string.empty': '请填写保存文件名模板',
                    })
                    .validate(value).error?.message;
                }}
              >
                <FileNameTemplateInput />
              </Item>
              <Item
                settingKey="sameFileSkip"
                label="跳过相同文件"
                valuePropName="checked"
                description="存在同名文件时，是否跳过下载"
              >
                <Switch />
              </Item>
              <Item
                settingKey="gifToRealGif"
                label="GIF 转真实 gif"
                valuePropName="checked"
                description="开启后，下载的动图(GIF)会用系统 ffmpeg 自动转成真实 .gif 并替换原 mp4（需系统已安装 ffmpeg 且在 PATH 中；未安装则保留 mp4）"
              >
                <Switch />
              </Item>
            </Section>
            <Section title="侧栏" name="sidebar" titleIcon={<MenuOutlined />}>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <span>仅显示图标（侧栏更窄）</span>
                  <Switch
                    size="small"
                    checked={sidebarIconOnly}
                    onChange={(v) => updateOne('sidebar', 'iconOnly', v)}
                  />
                </label>
                <Button onClick={() => setSidebarModalOpen(true)}>
                  编辑侧边栏
                </Button>
              </div>
            </Section>
            <Section
              title="订阅与数据"
              name="dataBackup"
              titleIcon={<FolderOutlined />}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Button type="primary" onClick={onExport}>
                  导出订阅
                </Button>
                <Button onClick={onImport}>导入订阅</Button>
                <Button loading={backupBusy} onClick={onExportBackup}>
                  导出用户数据
                </Button>
                <Button loading={backupBusy} onClick={onImportBackup}>
                  导入用户数据
                </Button>
              </div>
              <p className="text-sm text-gray-400 mt-2">
                订阅导出为 JSON（导入为追加，已存在自动跳过）；用户数据导出为
                zip（设置 / 订阅 / 标签 / 收藏 /
                转贴等，不含下载历史与站点缓存）， 导入后
                <span className="text-gray-500">需重启应用生效</span>
                （原文件保留为 *.pre-import 备份）。
              </p>
            </Section>
            <Modal
              open={sidebarModalOpen}
              title="编辑侧边栏"
              footer={null}
              onCancel={() => setSidebarModalOpen(false)}
              destroyOnClose
            >
              <p className="text-sm text-gray-400 mb-3">
                用箭头调整页面顺序；开关控制显示/隐藏。可隐藏：X主页 / Pawchive
                / 本地库 / 统计 / fig-memo / moeyo / pixiv；其余页面（时间流 /
                订阅 / 下载管理 / 设置 / 关于）常显，不可隐藏。
              </p>
              <ul className="space-y-1">
                {orderedRoutes.map((r, i) => {
                  const hideable = SIDEBAR_HIDEABLE_IDS.includes(r.id);
                  const isHidden = sidebarHidden.includes(r.id);
                  return (
                    <li key={r.id} className="flex items-center gap-2 text-sm">
                      <span className="text-ant-color-primary">{r.icon}</span>
                      <span className="w-24 shrink-0">{r.name}</span>
                      <Button
                        size="small"
                        icon={<ArrowUpOutlined />}
                        aria-label={`上移 ${r.name}`}
                        disabled={i === 0}
                        onClick={() => moveSidebarRoute(i, -1)}
                      />
                      <Button
                        size="small"
                        icon={<ArrowDownOutlined />}
                        aria-label={`下移 ${r.name}`}
                        disabled={i === orderedRoutes.length - 1}
                        onClick={() => moveSidebarRoute(i, 1)}
                      />
                      <Switch
                        size="small"
                        checked={!isHidden}
                        disabled={!hideable}
                        onChange={(checked) => setSidebarHidden(r.id, checked)}
                      />
                      <span className="text-xs text-gray-400 w-16">
                        {hideable ? (isHidden ? '已隐藏' : '显示') : '常显'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Modal>
            <Section
              title="本地库"
              name="library"
              titleIcon={<FolderOutlined />}
            >
              <div className="flex items-center flex-wrap gap-3">
                <Button
                  danger
                  onClick={async () => {
                    try {
                      await clearThumbCache();
                      message.success('缩略图缓存已清除');
                      refreshCacheStats();
                    } catch (err: any) {
                      message.error(`清除失败：${err?.message || '未知原因'}`);
                    }
                  }}
                >
                  清除缩略图缓存
                </Button>
                <Button
                  loading={thumbCache.running}
                  onClick={() =>
                    thumbCache.running
                      ? thumbCache.cancel()
                      : thumbCache.start()
                  }
                >
                  {thumbCache.running ? '取消生成' : '一键生成缩略图缓存'}
                </Button>
                <span className="text-sm text-gray-500 shrink-0 whitespace-nowrap">
                  当前缓存：
                  {cacheStats
                    ? `${formatBytes(cacheStats.totalBytes)}（${cacheStats.fileCount} 个文件）`
                    : '计算中…'}
                </span>
              </div>
              <p className="text-sm text-gray-400 mt-2">{thumbStatusText}</p>
              <p className="text-sm text-gray-400 mt-1">
                本地库浏览时会为图片生成缩略图缓存（存于应用数据目录
                thumb-cache）。可一键为现有图片预生成，之后浏览不再有初次载入卡顿；清除后下次浏览会重新生成，不影响原始文件。
              </p>
              <div className="mt-4 pt-4 border-t-[1px] border-gray-100">
                <div className="flex items-center gap-3">
                  <Button
                    type="primary"
                    loading={trace.running}
                    onClick={() =>
                      trace.running ? trace.cancel() : trace.start()
                    }
                  >
                    {trace.running ? '取消溯源' : '重新溯源本地库（联网）'}
                  </Button>
                  <span className="text-sm text-gray-500">
                    {traceStatusText}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Button
                    loading={videoCover.running}
                    onClick={() =>
                      videoCover.running
                        ? videoCover.cancel()
                        : videoCover.start()
                    }
                  >
                    {videoCover.running ? '取消' : '批量生成视频封面'}
                  </Button>
                  <span className="text-sm text-gray-500">
                    {videoCoverStatusText}
                  </span>
                </div>
                <p className="text-sm text-gray-400 mt-2">
                  视频封面用系统 ffmpeg 取首帧（约 0.15 秒/个，需已安装 ffmpeg
                  并在 PATH 中）；没 ffmpeg
                  时回退在线封面。浏览时命中缓存即秒开，
                  也可用上面的按钮批量预生成。
                </p>
              </div>
            </Section>
            <Section
              title="图片切割"
              name="split"
              titleIcon={<ScissorOutlined />}
            >
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                <label className="flex items-center gap-2">
                  <span className="text-gray-500">切割方向</span>
                  <Segmented
                    size="small"
                    value={splitCfg.direction}
                    onChange={(v) => updateOne('split', 'direction', v)}
                    options={[
                      { label: '左右切（竖条）', value: 'horizontal' },
                      { label: '上下切（横条）', value: 'vertical' },
                    ]}
                  />
                </label>
                <label
                  className="flex items-center gap-2"
                  title="本地库 / fig-memo / 时间流 右键图片「复制切割图像」时按此预设切割；结果以文件形式进剪贴板（粘贴即 N 张图）"
                >
                  <span className="text-gray-500">切割条数</span>
                  <InputNumber
                    size="small"
                    min={2}
                    max={20}
                    value={splitCfg.parts}
                    onChange={(v) => updateOne('split', 'parts', v ?? 4)}
                  />
                </label>
                <label
                  className="flex items-center gap-2"
                  title="开启后除图片外，还会把「作者ID / 原文链接」以文本形式一并写入剪贴板"
                >
                  <span className="text-gray-500">附带作者 / 原帖信息</span>
                  <Switch
                    size="small"
                    checked={splitCfg.appendSourceInfo === true}
                    onChange={(v) => updateOne('split', 'appendSourceInfo', v)}
                  />
                </label>
              </div>
            </Section>
            <Section
              title="时间流"
              name="timeline"
              titleIcon={<ClockCircleOutlined />}
            >
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                <label
                  className="flex items-center gap-2"
                  title="时间流每条正文超过此字数即折叠"
                >
                  <span className="text-gray-500">正文最大字数</span>
                  <InputNumber
                    size="small"
                    min={20}
                    max={5000}
                    value={timelineCfg.maxTextLen}
                    onChange={(v) =>
                      updateOne('timeline', 'maxTextLen', v ?? 200)
                    }
                  />
                </label>
                <label
                  className="flex items-center gap-2"
                  title="时间流每条最多展示的图片数，超出折叠"
                >
                  <span className="text-gray-500">单条最大图片数</span>
                  <InputNumber
                    size="small"
                    min={1}
                    max={50}
                    value={timelineCfg.maxImages}
                    onChange={(v) => updateOne('timeline', 'maxImages', v ?? 6)}
                  />
                </label>
                <label
                  className="flex items-center gap-2"
                  title="时间流展示最近多少天的内容（1~30，默认 7）"
                >
                  <span className="text-gray-500">保留天数</span>
                  <InputNumber
                    size="small"
                    min={1}
                    max={30}
                    value={timelineCfg.rangeDays ?? 7}
                    onChange={(v) => updateOne('timeline', 'rangeDays', v ?? 7)}
                  />
                </label>
              </div>
            </Section>
            <Section
              title="以图搜图"
              name="imageSearch"
              titleIcon={<SearchOutlined />}
            >
              <p className="text-sm text-gray-500 mb-3">
                搜索引擎：<strong>Google Lens</strong>
                （右键图片 →「以图搜图」；本地图会先上传取公开地址再打开结果）
              </p>
              <div className="flex items-center flex-wrap gap-3">
                <span className="font-medium">资源管理器右键</span>
                <Switch
                  checked={imageSearchCfg.explorerMenu === true}
                  onChange={onToggleExplorer}
                />
                <Button
                  size="small"
                  danger
                  disabled={imageSearchCfg.explorerMenu === false}
                  onClick={() => onToggleExplorer(false)}
                >
                  去除右键菜单
                </Button>
                <span className="text-sm text-gray-400">
                  在资源管理器里右键图片文件，添加「用 P-Spider
                  以图搜图」（Win11
                  在「显示更多选项」里）；点「去除」后今后启动**不再自动注册**，需手动再开
                </span>
              </div>
            </Section>
            <Section title="代理" name="proxy" titleIcon={<GlobalOutlined />}>
              <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                <label className="flex items-center gap-2">
                  <span>启用代理</span>
                  <Switch
                    size="small"
                    checked={proxyCfg.enable}
                    onChange={(v) => updateOne('proxy', 'enable', v)}
                  />
                </label>
                <label
                  className="flex items-center gap-2"
                  title="自动使用系统代理；若代理未生效，可能是代理软件没设置系统代理，此时请手动填代理地址"
                >
                  <span>使用系统代理</span>
                  <Switch
                    size="small"
                    checked={proxyCfg.useSystem}
                    onChange={(v) => updateOne('proxy', 'useSystem', v)}
                  />
                </label>
              </div>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-sm text-gray-500">代理地址</span>
                <Input
                  style={{ maxWidth: 380 }}
                  value={proxyUrlDraft}
                  placeholder="http://127.0.0.1:7890"
                  onChange={(e) => setProxyUrlDraft(e.target.value)}
                  onBlur={() => {
                    const val = proxyUrlDraft.trim();
                    if (val && !/^http:\/\/.+/i.test(val)) {
                      message.error(
                        '代理地址格式不正确，示例：http://127.0.0.1:7890',
                      );
                      setProxyUrlDraft(proxyCfg.url);
                      return;
                    }
                    updateOne('proxy', 'url', val);
                  }}
                />
              </div>
            </Section>
            <Section title="应用" name="app">
              <div className="mb-3 flex items-center gap-2 text-sm">
                <span>超级旁观者模式</span>
                <Switch
                  size="small"
                  checked={appCfg.spectator === true}
                  onChange={(v) => updateOne('app', 'spectator', v)}
                />
                <span className="text-xs text-gray-400">
                  开启后不自动下载（订阅/追新只更新列表与时间流），主色变粉提醒
                </span>
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-500">关闭窗口时</span>
                <Radio.Group
                  size="small"
                  value={appCfg.closeAction}
                  onChange={(e) =>
                    updateOne('app', 'closeAction', e.target.value)
                  }
                  options={[
                    { label: '最小化到托盘', value: 'minimize' },
                    { label: '退出', value: 'exit' },
                    { label: '每次询问', value: 'ask' },
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                <label
                  className="flex items-center gap-2"
                  title="开机自动启动，方便订阅自动检查"
                >
                  <span>开机自启动</span>
                  <Switch
                    size="small"
                    checked={appCfg.autoStart}
                    onChange={(v) => {
                      updateOne('app', 'autoStart', v);
                      invoke('set_auto_start', { enabled: v }).catch((err) =>
                        log.error('Set autostart failed', err),
                      );
                    }}
                  />
                </label>
                <label
                  className="flex items-center gap-2"
                  title="开启：按「关闭窗口时」直接执行不再询问；关闭：每次点 X 都弹询问框"
                >
                  <span>记住关闭选择</span>
                  <Switch
                    size="small"
                    checked={appCfg.rememberCloseChoice}
                    onChange={(v) => updateOne('app', 'rememberCloseChoice', v)}
                  />
                </label>
                <label
                  className="flex items-center gap-2"
                  title="日志体积可能较大，出问题时再开；开启后需重启"
                >
                  <span>记录日志文件</span>
                  <Switch
                    size="small"
                    checked={appCfg.writeLogs}
                    onChange={(v) => updateOne('app', 'writeLogs', v)}
                  />
                </label>
                <Button
                  size="small"
                  onClick={async () => {
                    await showInFolder(await path.appLogDir());
                  }}
                >
                  打开日志文件夹
                </Button>
              </div>
            </Section>
            <Section title="pixiv" name="pixiv">
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-sm font-bold">
                    浏览器登录（推荐）
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="primary" onClick={onPixivOpenLogin}>
                      打开 pixiv 登录页
                    </Button>
                    <Input
                      style={{ width: 420 }}
                      value={pixivCode}
                      onChange={(e) => setPixivCode(e.target.value)}
                      onPressEnter={onPixivComplete}
                      placeholder="登录后地址栏的 pixiv://account/login?code=…（整段粘贴即可）"
                      autoComplete="off"
                    />
                    <Button
                      loading={pixivLoginBusy}
                      disabled={!pixivCode}
                      onClick={onPixivComplete}
                    >
                      完成登录
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    点「打开 pixiv 登录页」→
                    在浏览器里登录（验证码/两步验证都在浏览器完成）。
                    <b>登录完成后一般会自动回到 P-Spider 并完成登录</b>
                    ；若浏览器停在 accounts.pixiv.net/post-redirect 或提示「打开
                    pixiv?」，点「打开」等它跳完。 实在不行时，把地址栏以
                    pixiv://account/login?code=…
                    结尾的整段粘到右侧点「完成登录」（code 约 30 秒有效）。
                  </p>
                </div>

                <Divider className="!my-2">高级 / 兜底</Divider>

                <div>
                  <div className="mb-1 text-sm font-bold">
                    refresh_token（可选，长期有效）
                  </div>
                  <Input.Password
                    value={pixivToken}
                    onChange={(e) => setPixivToken(e.target.value)}
                    placeholder="粘贴 pixiv 的 refresh_token"
                    autoComplete="off"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button loading={pixivBusy} onClick={savePixiv}>
                    保存并校验 refresh_token
                  </Button>
                  <Button danger onClick={clearPixiv}>
                    清除登录
                  </Button>
                  {pixivCfg.userId ? (
                    <span className="flex items-center gap-1 text-sm text-gray-500">
                      <Avatar size={20} src={pixivSelfAvatar} />
                      已登录：{pixivCfg.userName}（@{pixivCfg.userAccount} · ID{' '}
                      {pixivCfg.userId}）
                    </span>
                  ) : (
                    <span className="text-sm text-gray-400">未登录</span>
                  )}
                </div>
              </div>
            </Section>
            <Section
              title="fig-memo"
              name="parukamun"
              dataTour="figmemo-section"
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="font-medium">启用 fig-memo 功能</span>
                <Switch
                  checked={figmemo.featureEnabled}
                  onChange={(v) => figmemo.setFeatureEnabled(v)}
                />
                <span className="text-sm text-gray-400">
                  开启后左侧显示「fig-memo」选项卡
                </span>
              </div>
              <div className="flex items-center flex-wrap gap-3">
                <span className="font-medium">fig-memo</span>
                <Button
                  onClick={() =>
                    figmemo.build({
                      fromYear: buildYears?.[0]?.year(),
                      toYear: buildYears?.[1]?.year(),
                    })
                  }
                  loading={
                    figmemo.running && figmemo.progress?.phase === 'building'
                  }
                  disabled={figmemo.running}
                >
                  建库
                </Button>
                <DatePicker.RangePicker
                  picker="year"
                  allowEmpty={[true, true]}
                  value={buildYears as any}
                  onChange={(v) => setBuildYears(v as [Dayjs, Dayjs] | null)}
                  placeholder={['起始年', '结束年']}
                />
                <Button
                  onClick={() => figmemo.checkNow()}
                  loading={
                    figmemo.running && figmemo.progress?.phase === 'checking'
                  }
                  disabled={figmemo.running}
                >
                  刷新
                </Button>
                <span className="text-sm text-gray-500">
                  {figmemoStatusText}
                </span>
              </div>
              <div className="mt-3">
                <div className="text-sm text-gray-500 mb-1">
                  分类订阅（开关 = 接收该类新文章；「建库」只建已开启的分类）
                </div>
                {figmemoCategories.length === 0 ? (
                  <p className="text-xs text-gray-300">读取分类中…</p>
                ) : (
                  <ul className="space-y-1">
                    {figmemoCategories.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Switch
                          size="small"
                          checked={figmemo.enabledCategories.includes(c.id)}
                          onChange={(checked) =>
                            figmemo.setCategoryEnabled(c.id, checked)
                          }
                        />
                        <span>{c.name}</span>
                        <span className="text-xs text-gray-400">
                          （{c.count} 篇）
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="text-sm text-gray-400 mt-2">
                个人自用：订阅 fig-memo（fig-memo-r18.site）。开启分类后每 24
                小时自动检查新文章；「刷新」立即检查；「建库」按已开启分类+年份范围下载现存文章（⚠️
                量大）。标签（分类/厂商/年份/姿势·发型·体型）由站点数据**自动生成**，覆盖全部文章（含未下载），打开
                fig-memo 选项卡时即会刷新。
              </p>
              <div className="mt-3 pt-3 border-t-[1px] border-gray-100">
                <Button
                  loading={rebuildingTags}
                  onClick={() => {
                    modal.confirm({
                      title: '重建标签树',
                      content:
                        '会按当前站点数据重算「厂商」等自动标签（清空后重挂），并删除不再使用的自动标签。用户手动标签不受影响。是否继续？',
                      okText: '开始重建',
                      cancelText: '取消',
                      onOk: async () => {
                        setRebuildingTags(true);
                        try {
                          const removed = await rebuildFigmemoMakerTags();
                          message.success(
                            `重建完成，清理了 ${removed} 个冗余标签`,
                          );
                        } catch (err: any) {
                          message.error(
                            `重建失败：${err?.message || '未知原因'}`,
                          );
                        } finally {
                          setRebuildingTags(false);
                        }
                      },
                    });
                  }}
                >
                  重建标签树
                </Button>
                <span className="ml-2 text-sm text-gray-400">
                  升级/标签错乱时可用（重算自动标签、清理冗余）
                </span>
              </div>
            </Section>
            <Section
              title="moeyo（手办资讯）"
              name="moeyo"
              dataTour="moeyo-section"
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="font-medium">启用 moeyo 功能</span>
                <Switch
                  checked={moeyo.featureEnabled}
                  onChange={(v) => moeyo.setFeatureEnabled(v)}
                />
                <span className="text-sm text-gray-400">
                  开启后左侧显示「moeyo」选项卡
                </span>
              </div>
              <div className="flex items-center flex-wrap gap-3">
                <span className="font-medium">moeyo</span>
                <Button
                  onClick={() =>
                    moeyo.build({
                      fromYear: moeyoBuildYears?.[0]?.year(),
                      toYear: moeyoBuildYears?.[1]?.year(),
                    })
                  }
                  loading={
                    moeyo.running && moeyo.progress?.phase === 'building'
                  }
                  disabled={moeyo.running}
                >
                  建库
                </Button>
                <DatePicker.RangePicker
                  picker="year"
                  allowEmpty={[true, true]}
                  value={moeyoBuildYears as any}
                  onChange={(v) =>
                    setMoeyoBuildYears(v as [Dayjs, Dayjs] | null)
                  }
                  placeholder={['起始年', '结束年']}
                />
                <Button
                  onClick={() => moeyo.checkNow()}
                  loading={
                    moeyo.running && moeyo.progress?.phase === 'checking'
                  }
                  disabled={moeyo.running}
                >
                  刷新
                </Button>
                <span className="text-sm text-gray-500">{moeyoStatusText}</span>
              </div>
              <div className="mt-3">
                <div className="text-sm text-gray-500 mb-1">
                  分类订阅（开关 = 接收该类新文章；「建库」只建已开启的分类）
                </div>
                {moeyoCategories.length === 0 ? (
                  <p className="text-xs text-gray-300">读取分类中…</p>
                ) : (
                  <ul className="space-y-1">
                    {moeyoCategories.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Switch
                          size="small"
                          checked={moeyo.enabledCategories.includes(c.id)}
                          onChange={(checked) =>
                            moeyo.setCategoryEnabled(c.id, checked)
                          }
                        />
                        <span>{c.name}</span>
                        <span className="text-xs text-gray-400">
                          （{c.count} 篇）
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-3">
                <div className="text-sm text-gray-500 mb-1">
                  进「时间流」的分类（不勾选的分类不会作为新记事出现在时间流；全部不勾
                  = 都不进）
                </div>
                {moeyoCategories.length === 0 ? (
                  <p className="text-xs text-gray-300">读取分类中…</p>
                ) : (
                  <Checkbox.Group
                    options={moeyoCategories.map((c) => ({
                      label: c.name,
                      value: c.id,
                    }))}
                    value={timelineCats}
                    onChange={(vals) =>
                      updateOne(
                        'timeline',
                        'moeyoCategoryIds',
                        vals as number[],
                      )
                    }
                  />
                )}
              </div>
              <p className="text-sm text-gray-400 mt-2">
                订阅 moeyo（moeyo.com）。开启分类后每 24
                小时自动检查新文章；「刷新」立即检查；「建库」按已开启分类下载现存文章（⚠️
                量大）。标签（分类/厂商/年份）由站点数据**自动生成**，覆盖全部文章（含未下载）。
              </p>
            </Section>
          </SettingsTabContext.Provider>
        </div>
      </div>
    </>
  );
};
