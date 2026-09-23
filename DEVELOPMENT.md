# P-Spider 开发文档

## 技术栈

- **框架**：Tauri v1（Rust 后端 + WebView 前端）
- **前端**：React 18 + TypeScript + Vite + Tailwind + antd 5 + Zustand（状态管理）+ ramda
- **Rust**：reqwest（网络代理）、winreg（读系统代理/自启动注册表）
- **下载引擎**：aria2c（sidecar，RPC 走 WebSocket，端口 6802）

## 架构地图

### 前端数据流

```
页面 (src/pages) → Store (src/stores) → Twitter API (src/twitter/api.ts) → IPC (src/ipc/network.ts) → Rust (src-tauri/src/network.rs) → x.com
                                                      ↓
                                        aria2 (src/utils/aria2.ts) ←→ 下载引擎
```

### 目录结构

```
src/
  pages/            页面组件
    Homepage.tsx        主页（X 检索 + 下载配置）
    Archiver.tsx        Pawchive 检索页
    Subscription.tsx    订阅管理
    Statistics.tsx      统计（柱状图 + 排行）
    Timeline.tsx        时间流（近7天下载记录）
    DownloadManagement.tsx 下载管理
    Settings.tsx        设置
    About.tsx           关于
  components/       通用组件
    homepage/DownloadController.tsx  主页下载/订阅按钮
    archiver/           Pawchive 页组件（网格/批量下载）
    download-management/  下载列表
    settings/           设置项组件
  stores/           状态管理（Zustand + persist）
    subscription.ts      订阅 store + 调度循环（每1秒扫一次，到点检查）
    download.ts          下载任务 store + aria2 状态同步
    download-history.ts  下载历史（jsonl 文件）
    archiver-browse.ts   多源合并浏览 store
    settings.ts / app-state.ts / route.ts / homepage.ts
  twitter/
    api.ts             Twitter GraphQL 调用（getUser/getUserMedias/getUserTweets）
    url.ts / utils.ts  推文/媒体 URL 工具
  platforms/        平台抽象层（X / Pawchive）
    types.ts           统一模型（PlatformCreator/Post/Media/Adapter）
    archiver.ts        归档站通用适配器工厂
    twitter.ts         X 适配器（包装 twitter/api）
    pawchive.ts        Pawchive 适配器
    index.ts           适配器注册表 getAdapter(source)
  ipc/network.ts     调用 Rust 网络命令
  utils/
    aria2.ts            aria2 RPC 客户端（WebSocket）
    log.ts              日志
src-tauri/
  src/main.rs         Tauri 入口，注册命令
  src/network.rs      Rust 命令：network_fetch（代理请求）、get_system_proxy_url、set/get_auto_start
  tauri.conf.json     Tauri 配置
```

## 功能说明

### 订阅（核心新增功能）

- **原理**：`subscription.ts` 里 `scheduleSubscriptions()` 每 1 秒循环，检查各订阅是否到点（`now - lastCheckedAt >= interval`），到点调 `checkSubscription`
- **checkSubscription 流程**：`getUser`（解析用户名）→ `getUserMedias`（拉最新一页）→ 对比 `lastTweetId` 筛新推文 → `batchCreateDownloadTask` 自动下载 → 更新 `lastTweetId`/`lastCheckedAt`/`dailyStats`
- **间隔机制**：相对时间，从该订阅**最后一次成功检查**起算（非整点）。`intervalMin` 单位分钟
- **去重**：`lastTweetId` 记录基线，新推文用 `R.takeWhile(p.id !== lastTweetId)` 截取
- **首次订阅**：立即后台检查建立基线，不下载历史，只追新
- **已订阅状态**：主页 `DownloadController` 对比 username 显示"已订阅"

### 统计

- `dailyStats` 记录每日 `{ count, bytes }`，count 在发现新推文时累加，bytes 在下载完成时累加
- 字节数来源：`onTaskCompleted` 事件（download.ts 在任务首次 complete 时 emit，携带 aria2 实际 totalSize）
- 柱状图按数量渲染，y 轴刻度自适应（`getNiceTicks`，放大 1.2 倍取 nice 步长）

### 时间流

- 数据源：`downloads.jsonl`（每条下载记录一行 JSON）
- 记录字段：postId、tweetTime（推文时间，非下载时间）、fullText、用户名、媒体类型、mediaUrl、filePath、source（subscription/manual）
- 展示：近 7 天，按推文分组（同推文多图合并），首屏 25 条推文，滚动 +5
- 缩略图：`mediaUrl?format=jpg&name=thumb`（推特 CDN，不依赖本地文件）
- 原图预览：`preview.src` 用 `mediaUrl` 原图
- **注意**：只记录功能上线后新下载的内容，旧历史不会回溯

### 自启动

- Rust `set_auto_start(enabled)` 写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 的 `P-Spider` 键
- 设置项 `app.autoStart`，默认 true，应用启动时同步注册表

### Pawchive 检索页

- 页面：`pages/Archiver.tsx` + `stores/archiver-browse.ts` + `components/archiver/`
- 只检索 pawchive（2026-08 定案，kemono 已移除）。输入纯数字创作者 ID（如 `3316400`）或 `service/数字ID`（如 `patreon/3295915`）
- 纯数字 ID 自动探测 service（pawchive 仅支持 fanbox/patreon/discord，逐 service `resolveCreator` 命中即定）
- `resolveCreator` + 拉第一页；某 service 解析失败自动降级；结果按 post id 去重、按发布时间倒序；滚动分页（强制 50 步进）
- 每帖带 `source`（`PlatformPost.source`），单附件下载走 pawchive CDN
- 批量下载：创建一个爬虫任务（`CreationTask` 泛化支持 source），下载到 `保存目录/创作者名/帖子标题`
- 归档站批量/订阅共用同一套 `runCreationTask`（按 source 分发拉取，twitter 走 api、pawchive 走适配器）

### 下载任务

- `download.ts`：`createCreationTask`（爬虫任务，带 dateRange/媒体类型过滤）→ `batchCreateDownloadTask`（批量 addUri + tellStatus）
- 已知边界：大批量任务时 aria2 RPC 批量状态查询可能漏项，`statusMap[gid]` 缺失时兜底为 Active（防崩溃，但状态可能短暂不准）

### 本地库（规划中，未实现）

> 需求：在 p-spider 内浏览本地已下载文件并按分类管理（如"真人cos"分类下挂 `PoppaChan 🍑`、`白栎Shirly` 等作者文件夹）。

- **分类**：单级分类（分类名 → 一级文件夹列表）。管理对象 = `saveDirBase` 下的**一级文件夹**（X 是作者名，Pawchive 是创作者名）
- **页面**「本地库」：左侧分类栏（全部/未分类/自定义，可新建/改名/删除），右侧当前分类下的文件夹卡片网格（封面取文件夹内首图 + 名称 + 归类操作）
- **进入文件夹**：
  - 直接含媒体（X）→ 文件网格（图/视频）
  - 含子文件夹（Pawchive `创作者/帖子标题/`）→ 顶部切换 **平铺 / 按文件夹**：平铺=递归所有媒体文件网格；按文件夹=帖子文件夹列表 → 进入看文件
- **文件**：网格预览 + 系统资源管理器打开
- **数据**：分类存 `%APPDATA%\p-spider\library.json`（zustand persist + createTauriFileStorage）
- **代码落点**：`stores/library.ts`（分类 CRUD + 扫描）、`utils/library.ts`（扫描 saveDirBase/媒体类型判断/找封面）、`pages/Library.tsx` + `components/library/`、路由注册
- **关键依赖**：本地图片显示用 `convertFileSrc`（Tauri v1 asset 协议）。`tauri.conf.json` 已加 `protocol.asset: true` + `assetScope: ["**"]`（**待验证**能否显示任意路径本地图）
- **参考**：用户旧项目 **xibao（`E:\AIproject`）** 是成熟的标签树文件管理器（Python/Flask + 原生 JS，稳定文件 ID、无限级标签）。思路可借鉴，技术栈不同不直接复用。当前版本先做单级分类，架构预留升级空间

### 回滚点（1.1.3）

- git 分支 `backup-1.1.3` → commit `19894a2`（本地；因 github 连接失败暂未 push 远端）
- 物理源码备份：`E:\OPENCODE\x-spider-backup-1.1.3.zip`
- 回滚：`git checkout backup-1.1.3` 或解压 zip

## 待办 / 已知问题 / 维护注意

1. **架构解耦：下载历史改事件驱动**（✅ 已完成）
   - 现状：`download.ts` 不再依赖任何历史/统计模块，职责纯化，只在任务首次 complete 时 `emit onTaskCompleted`
   - `download-history.ts` 模块顶层注册 `onTaskCompleted.listen` 自写历史，与订阅的字节统计模式统一
   - ⚠️ 维护注意：该监听依赖模块**常驻加载**。`main.tsx` 已加副作用 `import './stores/download-history'`，若移除该 import，后台订阅下载完成时将不再写入历史（时间流会丢记录）

2. **平台抽象层重构（X / Pawchive）**（✅ 已完成）
   - 背景：`subscription.ts`→`twitter/api`、`download.ts`→`TwitterPost/TwitterMedia` 硬编码 X，为多平台抽象
   - 目标架构（已落地）：
     ```
     通用层（平台无关）
     ├── stores/ subscription / download / download-history / archiver-browse
     ├── platforms/
     │   ├── types.ts   统一模型（PlatformCreator/Post/Media/Adapter）
     │   ├── archiver.ts 归档站通用适配器工厂
     │   ├── twitter.ts X 适配器（包装现有 twitter/api）
     │   ├── pawchive.ts Pawchive 适配器
     │   └── index.ts   适配器注册表 getAdapter(source)
     └── pages/         只和抽象模型交互
     ```
   - 统一模型：`PlatformCreator{id,name,username,avatar,profileUrl}`、`PlatformPost{id,creator,publishedAt,text,medias,tags,links,postUrl,source}`、`PlatformMedia{id,type,url,thumbUrl,downloadUrl,fileName,videoInfo}`、`PlatformAdapter{fetchPosts,resolveCreator,source}`
   - **Pawchive 适配器**（2026-08 实测）：API 根 `https://pawchive.pw/api/v1`，公开免登录；帖子列表 `?o=` **强制 50 步进**；创作者按数字 id 走 `/profile`（无 slug 端点，订阅/检索 username 存 `service/数字id` 如 `patreon/3295915`）；媒体原图 `file.pawchive.pw/data{path}`、缩略图 `img.pawchive.pw/thumbnail/data{path}`
   - **媒体 URL 规则（archiver 工厂）**：API 的 `path` 为 `/xx/yy/hash.ext`（**不含 /data**），完整 URL 需补 `/data`：原图 `{fileRoot}/data{path}`、缩略图 `{thumbRoot}/thumbnail/data{path}`。⚠️ 曾漏 `/data` 导致下载 404，已修复
   - **DownloadTask 泛化**：`DownloadTask.post/media` 存 `PlatformPost/PlatformMedia`，加 `source`；`prepareDownloadTask` 按 source 分支目录/文件名（twitter 模板机制、pawchive 固定两级目录 `保存目录/创作者名/帖子标题/` + 附件原文件名）
   - **外链处理**：pawchive 帖 embed/正文(content) 有外部链接（网盘等）时：① 文件夹内生成 `链接清单.txt`；② 帖子标题目录名加 `[needDL]` 后缀。纯外链帖（无附件）也单独建目录写清单
   - **UI**：订阅表单平台选择（X/Pawchive）；`Pawchive` 页（数字 ID 检索，自动探测 service）单附件/批量下载；下载管理项按 `postUrl/thumbUrl` 展示
   - **persist migrate**：订阅 version 现为 **v5**（v4 补 `source:'twitter'`；v5 `source:'kemono'`→`'pawchive'`）
   - **Kemono 已移除（2026-08 定案）**：数据停滞在 2026-01 且原图 CDN 节点 `n1-n4.kemono.cr` 连不上（HTTP 000），下载不可用；pawchive 基于 kemono 数据基本覆盖。删除 `platforms/kemono.ts`，`PlatformSource` 仅 `twitter | pawchive`，旧 kemono 订阅 migrate 为 pawchive（同 service/id 通用）
   - 关键难点（已解决）：`DownloadTask` 改存 `PlatformPost`/`PlatformMedia`；新增平台只需实现 `PlatformAdapter`（可复用 archiver 工厂）+ 注册 `getAdapter`

3. **HomeTimeline（真首页动态）未实现**：GraphQL hash 硬编码在 X 混淆 JS 里，频繁变化，第三方库维护的 hash 也易失效（实测 403）。如需实现需引入无头浏览器动态抓取 hash，工程量大且不稳定，已放弃
4. **asset 协议本地图片**：时间流曾尝试 `convertFileSrc` 加载本地文件（F:\ 下），Tauri v1 的 asset scope 默认不含任意路径，改用推特 CDN 缩略图规避
5. **aria2 状态批量查询**：任务量大时可能漏项（见上），如需优化应分批创建任务
6. **Cookie 存储**：明文存在 `app-state.json`，仅本机使用可接受
7. **订阅 store 职责偏重**：`subscription.ts` 同时依赖抓推文、aria2、下载、cookie 多模块。当前规模可接受，扩展前评估是否需要拆分调度/抓取/下载
8. **本地 fork 继承的历史 tag 清理（待办）**：仓库本地残留 x-spider 时代的历史 tag（v1.0.3~v2.2.2 等，指向旧 commit，未 push 远端），不影响使用但较乱。清理：`git tag | ForEach-Object { git tag -d $_ }`（注意保留自己打的 release tag）。⚠️ 发布新版本前若本地存在同名旧 tag（如 v1.1.0 曾指向旧 commit），必须 `git tag -d v<ver>` 删除，否则 `gh release create` 报 "tag exists but not pushed"

> 说明：更新检查已恢复（`src/github/api.ts` + `src/hooks/useCheckUpdate.ts`），指向 `mdo730/P-spider` 的 releases，按 `tag_name`（须带 `v` 前缀）与当前版本比较。
> 已发布：**v1.1.0**（2026-08-28，Pawchive 平台 + 下载速度 + 多项修复），GitHub Description/Topics/README 已同步。
> **1.1.1 地基修复（2026-09-01）**：
> - `runCreationTask` 死循环防护：本页帖子全无发布时间时强制结束（不再卡 `now.isAfter(since)`）
> - Pawchive 检索竞态保护：请求序号，快速连搜时慢响应不覆盖新结果
> - creator 填充统一：`platforms/archiver.ts` 导出 `withCreator`，三处消费方统一调用（目录命名不再依赖手写 map）
> - aria2 并发控制：`--max-concurrent-downloads=8 --max-connection-per-server=4`，缓解批量下载触发 Cloudflare 掐断（429 / Download aborted）
> - 已知待改（建筑层，下轮）：errorCode 16 退避、缩略图/大文件下载体验细节

## 如何发布新版

1. 改 `package.json` version，**同步改 `src-tauri/Cargo.toml` version**（exe 内嵌版本与安装包名需一致；tauri.conf.json 的 version 引用 package.json）
2. 跑 `pnpm typeCheck` + `npx eslint ./src` + `pnpm build`
3. `pnpm tauri build` 生成 exe + NSIS。注意：exe 被占用（正在运行的 P-Spider）会失败，需先退出；NSIS 偶发文件锁可重试
4. 产物：`src-tauri/target/release/P-Spider.exe` + `aria2c.exe` + `bundle/nsis/P-Spider_<ver>_x64-setup.exe`
5. 提交代码：`git add -A` + commit + `git push`
6. 发布 GitHub Release（`gh` 已装于 `C:\Program Files\GitHub CLI\gh.exe`，已登录 mdo730）：
   - 若本地存在同名旧 tag（fork 继承的历史 tag 指向旧 commit），先 `git tag -d v<ver>`
   - `gh release create v<ver> --title "P-Spider <ver>" --notes-file <notes.md> <P-Spider.exe> <aria2c.exe> <setup.exe>`
7. 可选：更新 README / GitHub Description / Topics（`gh api` 或 PUT `/repos/.../topics`）
8. 若改图标：先 `pnpm tauri icon <源图>` 再打包，并清 Windows 图标缓存（重启 explorer）