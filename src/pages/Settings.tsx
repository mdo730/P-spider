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
} from '@ant-design/icons';
import Joi from 'joi';
import { SavePathSelector } from '../components/settings/SavePathSelector';
import { App, Button, Input, Radio, Switch } from 'antd';
import { FileNameTemplateInput } from '../components/settings/FileNameTemplateInput';
import { showInFolder } from '../utils/shell';
import { path } from '@tauri-apps/api';
import { useSubscriptionStore } from '../stores/subscription';
import { clearThumbCache, getThumbCacheStats } from '../utils/thumbnail';
import { LibraryFolderStats, formatBytes } from '../utils/library';
import { useLibraryTraceStore } from '../stores/library-trace';

export const Settings: React.FC = () => {
  const { message } = App.useApp();
  const { exportSubscriptions, importSubscriptions } = useSubscriptionStore();
  const [cacheStats, setCacheStats] = useState<LibraryFolderStats | null>(null);
  const trace = useLibraryTraceStore();

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
        <div className="flex items-center gap-3">
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
          <span className="text-sm text-gray-500">
            当前缓存：
            {cacheStats
              ? `${formatBytes(cacheStats.totalBytes)}（${cacheStats.fileCount} 个文件）`
              : '计算中…'}
          </span>
        </div>
        <p className="text-sm text-gray-400 mt-2">
          本地库浏览时会为图片生成缩略图缓存（存于应用数据目录
          thumb-cache）。清除后下次浏览会重新生成，不影响原始文件。
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
    </>
  );
};
