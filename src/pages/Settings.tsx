/* eslint-disable react/prop-types */
import React, { useEffect, useState } from 'react';
import { invoke, dialog, fs } from '@tauri-apps/api';
import { PageHeader } from '../components/PageHeader';
import { Section } from '../components/settings/Section';
import { Item } from '../components/settings/Item';
import {
  DownloadOutlined,
  FolderOutlined,
  GlobalOutlined,
  ScissorOutlined,
} from '@ant-design/icons';
import Joi from 'joi';
import { SavePathSelector } from '../components/settings/SavePathSelector';
import {
  App,
  Button,
  DatePicker,
  Input,
  InputNumber,
  Radio,
  Segmented,
  Switch,
} from 'antd';
import { FileNameTemplateInput } from '../components/settings/FileNameTemplateInput';
import { showInFolder } from '../utils/shell';
import { path } from '@tauri-apps/api';
import { useSubscriptionStore } from '../stores/subscription';
import { clearThumbCache, getThumbCacheStats } from '../utils/thumbnail';
import { LibraryFolderStats, formatBytes } from '../utils/library';
import { useLibraryTraceStore } from '../stores/library-trace';
import { useThumbCacheStore } from '../stores/library-thumb-cache';
import { useFigmemoStore } from '../stores/figmemo';
import { FigmemoCategory, fetchCategories } from '../services/figmemo';
import dayjs, { Dayjs } from 'dayjs';

export const Settings: React.FC = () => {
  const { message } = App.useApp();
  const { exportSubscriptions, importSubscriptions } = useSubscriptionStore();
  const [cacheStats, setCacheStats] = useState<LibraryFolderStats | null>(null);
  const trace = useLibraryTraceStore();
  const thumbCache = useThumbCacheStore();
  const figmemo = useFigmemoStore();
  const [figmemoCategories, setFigmemoCategories] = useState<FigmemoCategory[]>(
    [],
  );
  const [buildYears, setBuildYears] = useState<[Dayjs, Dayjs] | null>(null);

  useEffect(() => {
    fetchCategories()
      .then((map) => setFigmemoCategories([...map.values()]))
      .catch((err) => log.warn('读取 fig-memo 分类失败', err));
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
  return (
    <>
      <PageHeader />
      <Section title="订阅管理" name="subscription">
        <div className="flex items-center space-x-2">
          <Button type="primary" onClick={onExport}>
            导出订阅
          </Button>
          <Button onClick={onImport}>导入订阅</Button>
        </div>
        <p className="text-sm text-gray-400 mt-2">
          导出为 JSON 文件；导入为追加模式，已存在的订阅会自动跳过，不会覆盖。
        </p>
      </Section>
      <Section title="下载" name="download" titleIcon={<DownloadOutlined />}>
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
      </Section>
      <Section title="本地库" name="library" titleIcon={<FolderOutlined />}>
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
              thumbCache.running ? thumbCache.cancel() : thumbCache.start()
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
              onClick={() => (trace.running ? trace.cancel() : trace.start())}
            >
              {trace.running ? '取消溯源' : '重新溯源本地库（联网）'}
            </Button>
            <span className="text-sm text-gray-500">{traceStatusText}</span>
          </div>
        </div>
      </Section>
      <Section title="图片切割" name="split" titleIcon={<ScissorOutlined />}>
        <Item
          settingKey="direction"
          label="切割方向"
          description="左右切得到竖条；上下切得到横条"
        >
          <Segmented
            options={[
              { label: '左右切（竖条）', value: 'horizontal' },
              { label: '上下切（横条）', value: 'vertical' },
            ]}
          />
        </Item>
        <Item
          settingKey="parts"
          label="切割条数"
          description="本地库 / fig-memo / 时间流 右键图片「复制切割图像」时按此预设切割；结果以文件形式进剪贴板（临时文件，粘贴即 N 张图）"
        >
          <InputNumber min={2} max={20} />
        </Item>
      </Section>
      <Section title="代理" name="proxy" titleIcon={<GlobalOutlined />}>
        <Item label="启用代理" settingKey="enable" valuePropName="checked">
          <Switch />
        </Item>
        <Item
          label="使用系统代理"
          settingKey="useSystem"
          valuePropName="checked"
          description="自动使用系统代理，如果代理未生效，可能是你的代理软件没有自动设置系统代理，此时请手动配置代理地址。"
        >
          <Switch />
        </Item>
        <Item
          label="代理地址"
          settingKey="url"
          validator={(val) => {
            return Joi.string()
              .uri({
                scheme: ['http'],
              })
              .message('代理地址格式不正确，示例：“http://127.0.0.1:7890”')
              .validate(val).error?.message;
          }}
        >
          <Input placeholder="代理地址，例如：“http://127.0.0.1:7890”" />
        </Item>
      </Section>
      <Section title="应用" name="app">
        <Item
          label="开机自启动"
          description="开机时自动启动本软件，方便订阅自动检查"
          settingKey="autoStart"
          valuePropName="checked"
          onValueChange={async (checked) => {
            try {
              await invoke('set_auto_start', { enabled: checked });
            } catch (err) {
              log.error('Set autostart failed', err);
            }
          }}
        >
          <Switch />
        </Item>
        <Item
          label="关闭窗口时"
          description="点击窗口右上角 X 时的行为；若记住选择则下次直接执行不再询问"
          settingKey="closeAction"
        >
          <Radio.Group
            options={[
              { label: '最小化到托盘', value: 'minimize' },
              { label: '退出', value: 'exit' },
              { label: '每次询问', value: 'ask' },
            ]}
          />
        </Item>
        <Item
          label="记录日志文件"
          description="日志文件可能体积较大，建议软件运行出问题需要上报时再开启，开启后请重启软件。"
          settingKey="writeLogs"
          valuePropName="checked"
        >
          <Switch />
        </Item>
        <Button
          onClick={async () => {
            await showInFolder(await path.appLogDir());
          }}
        >
          打开日志文件夹
        </Button>
      </Section>
      <Section title="parukamun 自用订阅" name="parukamun">
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
            loading={figmemo.running && figmemo.progress?.phase === 'building'}
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
            loading={figmemo.running && figmemo.progress?.phase === 'checking'}
            disabled={figmemo.running}
          >
            刷新
          </Button>
          <span className="text-sm text-gray-500">{figmemoStatusText}</span>
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
                <li key={c.id} className="flex items-center gap-2 text-sm">
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
      </Section>
    </>
  );
};
