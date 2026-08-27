/* eslint-disable react/prop-types */
import { Avatar, Button, Input, Space, App } from 'antd';
import React from 'react';
import { PageHeader } from '../components/PageHeader';
import { ArchiverGrid } from '../components/archiver/ArchiverGrid';
import { ArchiverDownloadController } from '../components/archiver/ArchiverDownloadController';
import { useAppStateStore } from '../stores/app-state';
import { useArchiverBrowseStore } from '../stores/archiver-browse';

/** Pawchive：数字创作者 ID 检索归档内容，支持单附件/批量下载 */
export const Archiver: React.FC = () => {
  const { message } = App.useApp();
  const { keyword, setKeyword, creator, loading, creatorError, load } =
    useArchiverBrowseStore();
  const { searchHistory, addSearchHistory, clearSearchHistory } =
    useAppStateStore((s) => ({
      searchHistory: s.searchHistory,
      addSearchHistory: s.addSearchHistory,
      clearSearchHistory: s.clearSearchHistory,
    }));

  const startSearch = async (kw: string) => {
    if (!kw) return;
    kw = kw.trim();
    setKeyword(kw);
    try {
      await load(kw);
      addSearchHistory(kw);
    } catch (err: any) {
      log.error(err);
      message.error(err?.message || '加载失败，请检查 ID 格式');
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <div>
        <PageHeader />
        <div className="shrink-0">
          <section aria-label="检索创作者">
            <Space.Compact block>
              <Input
                type="search"
                autoComplete="search"
                disabled={loading}
                onPressEnter={() => startSearch(keyword)}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="创作者链接/ID，如 https://pawchive.pw/fanbox/user/3316400 或 3316400"
                className="text-center"
              />
              <Button
                disabled={!keyword}
                loading={loading}
                onClick={() => startSearch(keyword)}
                type="primary"
              >
                检索
              </Button>
            </Space.Compact>
            {searchHistory.length > 0 && (
              <section
                aria-label="搜索历史"
                className="text-sm mt-2"
                tabIndex={0}
              >
                <span>
                  搜索历史（
                  <Button
                    type="link"
                    size="small"
                    onClick={clearSearchHistory}
                    className="!p-0"
                  >
                    清空
                  </Button>
                  ） ：
                </span>
                <ul className="inline">
                  {searchHistory.map((sn) => (
                    <li key={sn} className="inline">
                      <Button
                        disabled={loading}
                        type="link"
                        size="small"
                        onClick={() => {
                          setKeyword(sn);
                          startSearch(sn);
                        }}
                      >
                        {sn}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {creatorError && (
              <p className="text-ant-color-error mt-2 text-sm" role="alert">
                {creatorError}
              </p>
            )}
          </section>
          {creator && (
            <>
              <ArchiverDownloadController />
              <section
                aria-label="创作者信息"
                className="bg-white border-[1px] border-gray-300 rounded-md mt-4"
              >
                <a
                  title="跳转到创作者主页"
                  className="flex items-center p-4"
                  href={creator.profileUrl || 'javascript:void(0);'}
                  target="_blank"
                  rel="noreferrer"
                >
                  <div>
                    <Avatar src={creator.avatar} size={50} alt="头像" />
                  </div>
                  <div className="ml-2">
                    <p>{creator.name || '未知创作者'}</p>
                    <p className="text-ant-color-text-secondary text-sm mt-1">
                      {creator.username}
                    </p>
                  </div>
                </a>
              </section>
            </>
          )}
        </div>
      </div>
      {creator && (
        <section
          className="relative grow mt-4 pb-4 overflow-hidden h-full min-h-[50vh]"
          aria-label="帖子预览"
        >
          <ArchiverGrid />
        </section>
      )}
    </div>
  );
};
