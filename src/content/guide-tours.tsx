/* eslint-disable react/prop-types */
import React from 'react';
import { MockCard, MockFrame, MockRow, Spot } from '../components/guide/MockUI';
import pixivR18Img from '../assets/guide/pixiv-r18.png';
import { USER_GUIDE } from './user-guide';

/**
 * 分章「假界面」引导的步骤定义。
 * key = 《使用指南》章节 id（见 content/user-guide.ts）；未配置的章节不显示播放按钮。
 */
export interface GuideStep {
  id: string;
  title: string;
  desc: string;
  render: () => React.ReactNode;
}

const welcomeCard = (
  <div className="flex h-full flex-col items-center justify-center text-center">
    <div className="text-lg font-bold text-gray-800">P-Spider</div>
    <div className="mt-2 max-w-[340px] text-xs leading-relaxed text-gray-500">
      X / Pawchive / pixiv 媒体下载器 · 订阅作者自动追新 · 时间流汇总 ·
      本地图库管理
    </div>
    <div className="mt-4 rounded-md bg-ant-color-primary px-4 py-1.5 text-xs text-white">
      开始了解
    </div>
  </div>
);

/** 1. 快速上手 / 欢迎章节的引导 */
const startTour: GuideStep[] = [
  {
    id: 'welcome',
    title: '欢迎使用 P-Spider',
    desc: '这是一个桌面媒体下载器：支持 X（推特）、Pawchive、pixiv，能订阅作者自动追新、用「时间流」汇总新内容、并管理本地图库。下面几屏是示意界面，帮你快速认路（随时可跳过）。',
    render: () => <MockFrame content={welcomeCard} />,
  },
  {
    id: 'save-path',
    title: '先设保存路径',
    desc: '所有下载都会放到这个目录。X / pixiv 会再按「文件夹模板 / 文件名模板」建作者文件夹与命名；fig-memo / moeyo 会在其下各自建子目录。请先选好保存目录，否则下载无法开始。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="下载"
        content={
          <MockCard title="下载">
            <MockRow label="保存路径" value="F:\\twitterdownload" highlight />
            <MockRow label="文件夹模板" value="%USER_NAME%" />
            <MockRow
              label="文件名模板"
              value="%POST_TIME% %USER_SCREEN_NAME% %POST_ID%-%MEDIA_INDEX%%EXT%"
            />
          </MockCard>
        }
      />
    ),
  },
  {
    id: 'figmemo',
    title: 'fig-memo 默认关闭',
    desc: 'fig-memo 默认是不开启的，需要在这个区块里手动「启用」后，左侧栏才会出现它的入口。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="站点"
        content={
          <MockCard title="站点">
            <MockRow
              label="fig-memo"
              value="启用开关（需手动打开）"
              highlight
            />
            <MockRow label="moeyo" value="启用开关" />
          </MockCard>
        }
      />
    ),
  },
  {
    id: 'moeyo',
    title: 'moeyo 默认关闭',
    desc: 'moeyo 同理，默认关闭，需要在这里手动开启后才会出现在左侧栏。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="站点"
        content={
          <MockCard title="站点">
            <MockRow label="fig-memo" value="启用开关" />
            <MockRow label="moeyo" value="启用开关（需手动打开）" highlight />
          </MockCard>
        }
      />
    ),
  },
  {
    id: 'sidebar',
    title: '左侧栏：所有功能入口',
    desc: '时间流 / X主页 / Pawchive / 本地库 / 订阅 / 统计 / 下载管理 / 设置 / 关于 都在这里；刚开启的 fig-memo / moeyo 也会出现在这。可在「设置 → 常规 → 侧栏」里自定义显示、排序，或改成「仅显示图标」。',
    render: () => (
      <MockFrame
        highlight="sidebar"
        content={
          <MockCard title="内容区">
            <div className="text-[11px] leading-relaxed text-gray-400">
              这里是各页面的内容，随左侧栏切换。
            </div>
          </MockCard>
        }
      />
    ),
  },
  {
    id: 'account',
    title: '在这里登录 X',
    desc: '点左侧栏最上面的头像，填入 auth_token 和 ct0 即可登录 X；pixiv 的登录在「设置 → 平台 → pixiv」。',
    render: () => (
      <MockFrame
        highlight="account"
        content={
          <MockCard title="内容区">
            <div className="text-[11px] leading-relaxed text-gray-400">
              登录后就能浏览、下载、订阅 X 内容。
            </div>
          </MockCard>
        }
      />
    ),
  },
  {
    id: 'help',
    title: '想深入了解，就看这本手册',
    desc: '每个栏目具体怎么用（下载、订阅、时间流、pixiv、站点功能…）都写在右上角这本《使用指南》里，随时点开查看；也能在这里重新播放本引导。好了，开始用吧！',
    render: () => (
      <MockFrame
        highlight="help"
        content={
          <MockCard title="使用指南">
            <div className="text-[11px] leading-relaxed text-gray-400">
              点右上角「?」打开手册，按章节查看每个功能怎么用。
            </div>
          </MockCard>
        }
      />
    ),
  },
];

/** 2. 账号登录章节的引导 */
const loginTour: GuideStep[] = [
  {
    id: 'x-login',
    title: '登录 X',
    desc: '点左侧栏最上面的头像，填入 auth_token 和 ct0 即可登录 X（弹窗里有「寻找 CookieString 的方法」）。登录后才能浏览、下载、订阅 X 内容。',
    render: () => (
      <MockFrame
        highlight="account"
        content={
          <div className="flex h-full items-center justify-center">
            <div className="w-[300px]">
              <MockCard title="设置 Twitter 的 Cookie">
                <MockRow label="auth_token" value="粘贴 auth_token 的值" />
                <MockRow label="ct0" value="粘贴 ct0 的值" />
                <div className="rounded bg-ant-color-primary px-2 py-1 text-center text-[11px] text-white">
                  登录
                </div>
              </MockCard>
            </div>
          </div>
        }
      />
    ),
  },
  {
    id: 'pixiv-login',
    title: '登录 pixiv',
    desc: '登录 pixiv：设置 →「平台」→ pixiv，点「打开 pixiv 登录页」，在浏览器里登录后一般会自动回跳完成；不行就把地址栏整段粘回点「完成登录」。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="平台"
        content={
          <MockCard title="pixiv">
            <MockRow
              label="浏览器登录"
              value="打开 pixiv 登录页 → 完成登录"
              highlight
            />
            <MockRow label="兜底" value="手动粘贴 refresh_token → 保存并校验" />
          </MockCard>
        }
      />
    ),
  },
  {
    id: 'pixiv-r18',
    title: 'pixiv 的 R18 内容',
    desc: '要在 pixiv 里看 R18 作品，需要先在你的 pixiv 账号设置里开启「R-18 表示」，否则搜不到 / 看不到。下图是 pixiv 设置里的样子：',
    render: () => (
      <div className="flex w-full justify-center">
        <img
          src={pixivR18Img}
          alt="pixiv「R-18 表示」设置"
          className="max-h-[360px] w-auto max-w-full rounded-lg border border-gray-200"
        />
      </div>
    ),
  },
];

const spot = (node: React.ReactNode, on?: boolean) =>
  on ? <Spot>{node}</Spot> : node;

/** 假「X主页」页（浏览 + 下载配置 + 订阅按钮） */
const XHomeMock: React.FC<{
  target?: 'search' | 'start' | 'subscribe';
}> = ({ target }) => (
  <div className="flex h-full flex-col gap-2">
    <div className="flex items-center gap-1.5">
      {spot(
        <div className="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-400">
          用户名 / 主页链接 / 推文链接
        </div>,
        target === 'search',
      )}
      <div className="rounded bg-ant-color-primary px-2 py-1 text-[11px] text-white">
        加载
      </div>
    </div>
    <div className="flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1.5">
      <div className="h-7 w-7 rounded-full bg-gray-200" />
      <div className="text-[11px] text-gray-500">作者昵称 @name</div>
    </div>
    <div className="rounded border border-gray-200 bg-white p-2">
      <div className="mb-1.5 text-[11px] font-medium text-gray-600">
        下载配置
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5 text-[10px] text-gray-400">
        <span className="rounded border px-1.5 py-0.5">照片</span>
        <span className="rounded border px-1.5 py-0.5">视频</span>
        <span className="rounded border px-1.5 py-0.5">GIF</span>
        <span className="rounded border px-1.5 py-0.5">日期范围</span>
      </div>
      <div className="flex gap-1.5">
        {spot(
          <div className="rounded bg-ant-color-primary px-2 py-1 text-[11px] text-white">
            开始下载
          </div>,
          target === 'start',
        )}
        {spot(
          <div className="rounded border border-ant-color-primary px-2 py-1 text-[11px] text-ant-color-primary">
            订阅
          </div>,
          target === 'subscribe',
        )}
      </div>
    </div>
    <div className="grid flex-1 grid-cols-6 gap-1 overflow-hidden">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="rounded bg-gray-200/70" />
      ))}
    </div>
  </div>
);

/** 假「订阅」管理页 */
const SubscriptionMock: React.FC<{ target?: 'list' | 'refresh' }> = ({
  target,
}) => (
  <div className="flex h-full flex-col gap-2">
    <div className="flex items-center justify-between">
      <div className="text-[11px] font-medium text-gray-600">订阅列表</div>
      {spot(
        <div className="rounded bg-ant-color-primary px-2 py-1 text-[11px] text-white">
          一键刷新
        </div>,
        target === 'refresh',
      )}
    </div>
    <div className="flex-1 overflow-hidden">
      {spot(
        <div className="space-y-1.5">
          {['@作者A', '@作者B', '@作者C', '@作者D'].map((r) => (
            <div
              key={r}
              className="flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1.5"
            >
              <div className="h-6 w-6 rounded-full bg-gray-200" />
              <div className="text-[11px] text-gray-500">{r}</div>
              <div className="ml-auto rounded border px-1.5 py-0.5 text-[10px] text-gray-400">
                开启
              </div>
            </div>
          ))}
        </div>,
        target === 'list',
      )}
    </div>
  </div>
);

/** 3. 浏览、下载与订阅章节的引导 */
const browseTour: GuideStep[] = [
  {
    id: 'browse-search',
    title: '怎么找作者',
    desc: 'X主页：输入用户名 / 主页链接 / 推文链接（如 shiratamacaron）；Pawchive：输入数字创作者 ID 或 service/数字ID；pixiv：输入画师主页链接 / 作品链接 / 数字 ID。回车「加载」即可看到该作者的内容。',
    render: () => (
      <MockFrame
        activeSidebar="X主页"
        content={<XHomeMock target="search" />}
      />
    ),
  },
  {
    id: 'download',
    title: '下载内容',
    desc: '选好「媒体类型 / 日期范围」后点「开始下载」。pixiv 另有「作品类型 / 时间范围」筛选和「开始下载全部」；多图作品会全部下载；ugoira 动图默认存 mp4（设置里勾「GIF 转真 gif」则存 gif）。',
    render: () => (
      <MockFrame activeSidebar="X主页" content={<XHomeMock target="start" />} />
    ),
  },
  {
    id: 'subscribe',
    title: '订阅作者',
    desc: '在作者页点「订阅」/「订阅该画师」，选好检查间隔与媒体类型 → 之后会自动追新并下载新内容。',
    render: () => (
      <MockFrame
        activeSidebar="X主页"
        content={<XHomeMock target="subscribe" />}
      />
    ),
  },
  {
    id: 'manage',
    title: '管理订阅',
    desc: '左侧栏「订阅」页统一开关 / 编辑 / 删除订阅。X / Pawchive / pixiv 三平台各自并行检查、各自限速。X 还可设「含转贴 / 仅转推」——转贴只进时间流、不下载。订阅可导出 / 导入备份（设置 →「工具与数据」）。',
    render: () => (
      <MockFrame
        activeSidebar="订阅"
        content={<SubscriptionMock target="list" />}
      />
    ),
  },
  {
    id: 'refresh',
    title: '刷新订阅',
    desc: '点「一键刷新」立即检查全部订阅、抓取最新内容；平时订阅也会按各自设定的间隔自动检查。',
    render: () => (
      <MockFrame
        activeSidebar="订阅"
        content={<SubscriptionMock target="refresh" />}
      />
    ),
  },
];

/** 假「时间流」页（内容卡 + 右下角按钮） */
const TimelineMock: React.FC<{ target?: 'filter' | 'refresh' }> = ({
  target,
}) => (
  <div className="relative flex h-full flex-col gap-1.5">
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        className="flex gap-2 rounded border border-gray-200 bg-white p-2"
      >
        <div className="h-7 w-7 shrink-0 rounded-full bg-gray-200" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 h-2 w-24 rounded bg-gray-200" />
          <div className="mb-1.5 h-2 w-full rounded bg-gray-100" />
          <div className="flex gap-1">
            <div className="h-10 w-10 rounded bg-gray-200/70" />
            <div className="h-10 w-10 rounded bg-gray-200/70" />
          </div>
        </div>
      </div>
    ))}
    <div className="absolute bottom-1 right-1 flex flex-col items-center gap-1.5">
      {spot(
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-[9px] text-gray-500">
          标签
        </div>,
        target === 'filter',
      )}
      {spot(
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-[9px] text-gray-500">
          刷新
        </div>,
        target === 'refresh',
      )}
      <div className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-[11px] text-gray-500">
        ↑
      </div>
    </div>
  </div>
);

/** 假「下载管理」页 */
const DownloadMgmtMock: React.FC = () => (
  <div className="flex h-full flex-col gap-2">
    <div className="flex gap-1.5 text-[10px]">
      <span className="rounded bg-ant-color-primary px-2 py-0.5 text-white">
        下载中
      </span>
      <span className="rounded border px-2 py-0.5 text-gray-400">错误</span>
      <span className="rounded border px-2 py-0.5 text-gray-400">已完成</span>
    </div>
    <div className="space-y-1.5">
      {['file-001.jpg', 'file-002.mp4', 'file-003.png'].map((f) => (
        <div
          key={f}
          className="flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1.5"
        >
          <div className="h-8 w-8 rounded bg-gray-200" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] text-gray-600">{f}</div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-gray-100">
              <div className="h-1.5 w-1/2 rounded bg-ant-color-primary" />
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

/** 假「文章列表」（fig-memo / moeyo） */
const ArticleGridMock: React.FC = () => (
  <div className="grid grid-cols-5 gap-1.5">
    {Array.from({ length: 10 }).map((_, i) => (
      <div
        key={i}
        className="overflow-hidden rounded border border-gray-200 bg-white"
      >
        <div className="aspect-square bg-gray-200/70" />
        <div className="truncate p-1 text-[9px] text-gray-500">文章标题…</div>
      </div>
    ))}
  </div>
);

/** 假「文章详情」（右下角标签 / 收藏按钮） */
const ArticleDetailMock: React.FC<{ target?: 'tags' }> = ({ target }) => (
  <div className="relative flex h-full gap-2">
    <div className="h-full w-24 shrink-0 rounded bg-gray-200/70" />
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="h-2.5 w-3/4 rounded bg-gray-200" />
      <div className="h-2 w-full rounded bg-gray-100" />
      <div className="h-2 w-5/6 rounded bg-gray-100" />
      <div className="grid grid-cols-3 gap-1 pt-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-square rounded bg-gray-200/70" />
        ))}
      </div>
    </div>
    <div className="absolute bottom-1 right-1 flex flex-col items-center gap-1.5">
      {spot(
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-ant-color-primary text-[9px] text-white">
          标签
        </div>,
        target === 'tags',
      )}
      <div className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-[11px] text-rose-400">
        ♥
      </div>
    </div>
  </div>
);

/** 假「文章详情」右侧 hpoi 面板 + 同词条跳转按钮 */
const MoeyoDetailMock: React.FC<{ target?: 'jump' }> = ({ target }) => (
  <div className="relative flex h-full gap-2">
    <div className="h-full w-24 shrink-0 rounded bg-gray-200/70" />
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="h-2.5 w-3/4 rounded bg-gray-200" />
      <div className="h-2 w-full rounded bg-gray-100" />
      <div className="grid grid-cols-3 gap-1 pt-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-square rounded bg-gray-200/70" />
        ))}
      </div>
    </div>
    <div className="absolute right-1 top-1 w-28 rounded border border-gray-200 bg-white p-1.5">
      <div className="mb-1 text-[9px] font-medium text-gray-500">hpoi 关联</div>
      <div className="mb-1 h-2 w-full rounded bg-gray-100" />
      <div className="mb-1.5 h-2 w-3/4 rounded bg-gray-100" />
      {spot(
        <div className="rounded bg-ant-color-primary px-1.5 py-0.5 text-center text-[9px] text-white">
          在 fig-memo 查看
        </div>,
        target === 'jump',
      )}
    </div>
  </div>
);

/** 假 fig-memo 页（左侧标签树 + 文章网格） */
const FigmemoWithTreeMock: React.FC<{ target?: 'tree' }> = ({ target }) => (
  <div className="flex h-full gap-2">
    {spot(
      <div className="w-24 shrink-0 space-y-1 rounded border border-gray-200 bg-white p-1.5">
        <div className="rounded bg-ant-color-primary px-1.5 py-0.5 text-[10px] text-white">
          全部
        </div>
        {['未打标签', '收藏', '分类', '厂商', '年份', '姿势…'].map((t) => (
          <div
            key={t}
            className="truncate rounded px-1.5 py-0.5 text-[10px] text-gray-500"
          >
            {t}
          </div>
        ))}
      </div>,
      target === 'tree',
    )}
    <div className="min-w-0 flex-1">
      <ArticleGridMock />
    </div>
  </div>
);

/** 4. 时间流章节 */
const timelineTour: GuideStep[] = [
  {
    id: 'content',
    title: '时间流里有什么',
    desc: '把 X / Pawchive / pixiv 的最新内容、fig-memo / moeyo 的新文章、以及转贴，按时间混排在一起，是打开软件看到的首页。',
    render: () => (
      <MockFrame activeSidebar="时间流" content={<TimelineMock />} />
    ),
  },
  {
    id: 'filter',
    title: '标签筛选',
    desc: '右下角「标签」按钮 → 胶囊浮窗：按本地库标签 / 转贴 / 站点筛选，多选为并集、没命中的隐藏。旁边的日期刻度条可按时间快速定位。',
    render: () => (
      <MockFrame
        activeSidebar="时间流"
        content={<TimelineMock target="filter" />}
      />
    ),
  },
  {
    id: 'refresh',
    title: '刷新',
    desc: '右下角「刷新」会立即检查所有订阅并更新内容；fig-memo / moeyo 的站点列表约每 20 分钟自动刷新。',
    render: () => (
      <MockFrame
        activeSidebar="时间流"
        content={<TimelineMock target="refresh" />}
      />
    ),
  },
];

/** 5. 下载与本地库章节 */
const downloadTour: GuideStep[] = [
  {
    id: 'naming',
    title: '保存与命名',
    desc: '设置 →「下载」：保存路径、文件夹模板 / 文件名模板（变量在输入框里选）、跳过相同文件、GIF 转真实 gif。X / pixiv 按模板建目录；Pawchive 固定「创作者名 / 帖子标题」；fig-memo / moeyo 按站点名建目录。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="下载"
        content={
          <MockCard title="下载">
            <MockRow label="保存路径" value="F:\\twitterdownload" />
            <MockRow
              label="文件名模板"
              value="%POST_TIME% %USER_SCREEN_NAME% %POST_ID%-%MEDIA_INDEX%%EXT%"
              highlight
            />
            <MockRow label="跳过相同文件" value="开关" />
          </MockCard>
        }
      />
    ),
  },
  {
    id: 'split',
    title: '图片切割',
    desc: '设置 →「下载」→ 图片切割：设方向（左右切竖条 / 上下切横条）、条数，以及是否附带作者信息；之后在图片上右键「复制切割图像」。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="下载"
        content={
          <MockCard title="图片切割">
            <MockRow label="切割方向" value="左右切（竖条）" />
            <MockRow label="切割条数" value="4" highlight />
            <MockRow label="附带作者信息" value="开关" />
          </MockCard>
        }
      />
    ),
  },
  {
    id: 'manage',
    title: '下载管理',
    desc: '左侧栏「下载管理」分「下载中 / 错误 / 已完成」三栏，可看进度、重试、打开所在文件夹。',
    render: () => (
      <MockFrame activeSidebar="下载管理" content={<DownloadMgmtMock />} />
    ),
  },
  {
    id: 'library',
    title: '本地库',
    desc: '设置 →「工具与数据」→ 本地库：一键生成 / 清除缩略图缓存；「重新溯源本地库（联网）」在源推文被删时按文件名找回作者 / 链接；「批量生成视频封面」用系统 ffmpeg 取首帧。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="工具与数据"
        content={
          <MockCard title="本地库">
            <MockRow label="缩略图缓存" value="一键生成 / 清除" highlight />
            <MockRow label="重新溯源" value="联网找回作者 / 链接" />
            <MockRow label="视频封面" value="批量生成（ffmpeg）" />
          </MockCard>
        }
      />
    ),
  },
];

/** 6. fig-memo 章节 */
const figmemoTour: GuideStep[] = [
  {
    id: 'enable',
    title: '开启 fig-memo',
    desc: '设置 →「站点」→ fig-memo：打开「启用 fig-memo 功能」，左侧栏才会出现入口；勾选分类后按间隔自动追新 / 建库。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="站点"
        content={
          <MockCard title="站点">
            <MockRow label="fig-memo" value="启用 + 分类订阅" highlight />
            <MockRow label="moeyo" value="启用 + 分类订阅" />
          </MockCard>
        }
      />
    ),
  },
  {
    id: 'list',
    title: '文章列表',
    desc: '列表显示全站文章（含未下载），点开文章可看详情、图片与正文。',
    render: () => (
      <MockFrame activeSidebar="fig-memo" content={<ArticleGridMock />} />
    ),
  },
  {
    id: 'tag-tree',
    title: '左侧标签树',
    desc: '左侧标签树用来筛选文章：分类 / 厂商 / 年份由站点数据自动生成，还有你手动打的文章标签（姿势 / 发型 / 体型…）。点某标签只显示含其子孙标签的文章；还能新建 / 改名 / 移动标签。「未打标签」用来找还没标过的文章。',
    render: () => (
      <MockFrame
        activeSidebar="fig-memo"
        content={<FigmemoWithTreeMock target="tree" />}
      />
    ),
  },
  {
    id: 'detail',
    title: '打标签 / 收藏',
    desc: '打开文章详情，右下角圆形按钮给这篇文章打标签（姿势 / 发型 / 体型…，可新建），心形收藏；右上角浮窗可做 hpoi 关联。打的标签会进入左侧标签树，之后就能按它筛选。',
    render: () => (
      <MockFrame
        activeSidebar="fig-memo"
        content={<ArticleDetailMock target="tags" />}
      />
    ),
  },
];

/** 7. moeyo 章节 */
const moeyoTour: GuideStep[] = [
  {
    id: 'enable',
    title: '开启 moeyo',
    desc: '设置 →「站点」→ moeyo：同样需要手动启用；勾选分类后自动追新。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="站点"
        content={
          <MockCard title="站点">
            <MockRow label="fig-memo" value="启用 + 分类订阅" />
            <MockRow label="moeyo" value="启用 + 分类订阅" highlight />
          </MockCard>
        }
      />
    ),
  },
  {
    id: 'list',
    title: '列表与详情',
    desc: '用法和 fig-memo 基本一致：全站文章列表、详情、图片、收藏都能用。',
    render: () => (
      <MockFrame activeSidebar="moeyo" content={<ArticleGridMock />} />
    ),
  },
  {
    id: 'jump',
    title: '同词条跳转',
    desc: 'moeyo 文章若关联了 hpoi 词条，而 fig-memo 里也有同一词条的文章，详情会出现「在 fig-memo 查看」——一键跳到同款手办的 fig-memo 文章。',
    render: () => (
      <MockFrame
        activeSidebar="moeyo"
        content={<MoeyoDetailMock target="jump" />}
      />
    ),
  },
];

/** 8. 侧栏与界面章节 */
const sidebarTour: GuideStep[] = [
  {
    id: 'edit',
    title: '编辑侧边栏',
    desc: '设置 →「常规」→ 侧栏：点「编辑侧边栏」可调整各入口顺序、显示 / 隐藏（时间流等关键入口常显不可隐藏）。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="常规"
        content={
          <MockCard title="侧栏">
            <MockRow label="仅显示图标" value="开关" />
            <MockRow label="编辑侧边栏" value="调整顺序 / 显示隐藏" highlight />
          </MockCard>
        }
      />
    ),
  },
  {
    id: 'icon-only',
    title: '仅显示图标',
    desc: '开启「仅显示图标」后侧栏变窄、只留图标，鼠标悬停显示名称，能把内容区让得更宽。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="常规"
        content={
          <MockCard title="侧栏">
            <MockRow label="仅显示图标" value="开关" highlight />
            <MockRow label="编辑侧边栏" value="调整顺序 / 显示隐藏" />
          </MockCard>
        }
      />
    ),
  },
  {
    id: 'settings-nav',
    title: '设置的分组',
    desc: '设置页左侧是二级分组：常规 / 下载 / 平台 / 站点 / 工具与数据，点左边切换右侧内容。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="常规"
        highlight="settingsNav"
        content={
          <MockCard title="应用">
            <MockRow label="超级旁观者模式" value="开关" />
            <MockRow label="开机自启动" value="开关" />
          </MockCard>
        }
      />
    ),
  },
];

/** 9. 超级旁观者模式章节 */
const spectatorTour: GuideStep[] = [
  {
    id: 'switch',
    title: '超级旁观者模式',
    desc: '设置 →「常规」→ 应用：开启后不进行任何「自动」下载——订阅检查、fig-memo / moeyo 追新只更新列表与时间流，不存到本地（主色变粉提醒）；手动保存文章、手动建库仍可下载。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="常规"
        content={
          <MockCard title="应用">
            <MockRow
              label="超级旁观者模式"
              value="开启：不自动下载"
              highlight
            />
            <MockRow label="开机自启动" value="开关" />
            <MockRow label="关闭窗口时" value="最小化 / 退出 / 询问" />
          </MockCard>
        }
      />
    ),
  },
];

/** 10. 数据与备份章节 */
const dataTour: GuideStep[] = [
  {
    id: 'backup',
    title: '备份与恢复',
    desc: '设置 →「工具与数据」：「导出 / 导入订阅」（JSON，追加式）；「用户数据备份」导出 zip（设置 / 订阅 / 标签 / 收藏 / 转贴等），换机 / 重装后导入即可恢复（需重启，原文件备份为 *.pre-import）。',
    render: () => (
      <MockFrame
        activeSidebar="设置"
        settingsNav="工具与数据"
        content={
          <MockCard title="订阅与数据">
            {spot(
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded bg-ant-color-primary px-2 py-1 text-[10px] text-white">
                  导出订阅
                </span>
                <span className="rounded border px-2 py-1 text-[10px] text-gray-600">
                  导入订阅
                </span>
                <span className="rounded bg-ant-color-primary px-2 py-1 text-[10px] text-white">
                  导出用户数据
                </span>
                <span className="rounded border px-2 py-1 text-[10px] text-gray-600">
                  导入用户数据
                </span>
              </div>,
              true,
            )}
          </MockCard>
        }
      />
    ),
  },
];

/** 章节 id → 引导步骤（未配置的章节没有播放按钮） */
export const GUIDE_TOURS: Record<string, GuideStep[]> = {
  start: startTour,
  login: loginTour,
  browse: browseTour,
  timeline: timelineTour,
  download: downloadTour,
  figmemo: figmemoTour,
  moeyo: moeyoTour,
  sidebar: sidebarTour,
  spectator: spectatorTour,
  data: dataTour,
};

export interface GuideChapter {
  id: string;
  title: string;
  steps: GuideStep[];
}

/** 有引导动画的章节（按《使用指南》顺序），供「连续播放全部」用 */
export const GUIDE_CHAPTERS: GuideChapter[] = USER_GUIDE.filter(
  (s) => (GUIDE_TOURS[s.id]?.length ?? 0) > 0,
).map((s) => ({ id: s.id, title: s.title, steps: GUIDE_TOURS[s.id] }));
