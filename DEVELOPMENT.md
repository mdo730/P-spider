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
    Library.tsx         本地库（分类 + 文件夹/文件浏览）
    Subscription.tsx    订阅管理
    Statistics.tsx      统计（柱状图 + 排行）
    Timeline.tsx        时间流（近7天下载记录）
    DownloadManagement.tsx 下载管理
    Settings.tsx        设置
    About.tsx           关于
  components/       通用组件
    homepage/DownloadController.tsx  主页下载/订阅按钮
    archiver/           Pawchive 页组件（网格/批量下载）
    library/            本地库组件（分类栏/文件夹网格/详情/文件网格）
    download-management/  下载列表
    settings/           设置项组件
  stores/           状态管理（Zustand + persist）
    subscription.ts      订阅 store + 调度循环（每1秒扫一次，到点检查）
    download.ts          下载任务 store + aria2 状态同步
    download-history.ts  下载历史（jsonl 文件）
    library.ts           本地库分类（library.json）
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
    library.ts          本地库扫描（一级目录/封面/递归媒体/媒体类型判断）
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

### 本地库（已实现，2026-09）

> 需求：在 p-spider 内浏览本地已下载文件并按标签管理（如"真人cos"标签下挂 `PoppaChan 🍑`、`白栎Shirly` 等作者文件夹）。

- **标签**：单级标签（标签名 → 一级文件夹名列表），**一个文件夹可打多个标签**。管理对象 = `saveDirBase` 下的**一级文件夹**（X 是作者名，Pawchive 是创作者名）；未打任何标签即「未打标签」
- **页面**「本地库」：左侧标签栏（全部/未打标签/自定义，可新建/改名/删除），右侧当前标签下的文件夹卡片网格（封面取文件夹内首图 + 名称 + 媒体数 + 标签数角标）
- **进入文件夹**：
  - 直接含媒体（X）→ 文件网格（图/视频）
  - 含子文件夹（Pawchive `创作者/帖子标题/`）→ 顶部切换 **平铺 / 按文件夹**：平铺=递归所有媒体文件网格；按文件夹=帖子文件夹列表 → 进入看文件（支持多级下钻 + 面包屑）
- **右键菜单（统一操作入口）**：一级文件夹右键 = 打开 / 在资源管理器中打开 / 标签（子菜单，逐项勾选切换，可多标签）/ 新建标签并添加 / 属性 / 恢复默认缩略图（仅设过自定义封面时）；子文件夹右键 = 打开 / 在资源管理器中打开 / 属性；文件右键 = 打开（系统默认程序）/ 在资源管理器中打开 / 打开原网页（有推文信息时）/ 设为文件夹缩略图（仅图片，作用于当前一级作者文件夹）/ 删除文件。⚠️ 卡片右上角 `⋯` 按钮已移除（统一走右键，避免与右键菜单重复）；不再有独立「移出分类」（改为标签子菜单里的勾选切换）
- **属性弹窗**（`FolderProperties`）：展示 名称 / 标签 / 媒体数 / 全部文件数 / 占用空间 / 路径。占用空间由 Rust `get_folder_stats` 递归统计
- **原推文关联（本地库）**：图片走 antd **原生全屏预览**（不改变窗口、不新开窗口），视频弹窗播放；打开媒体时右侧**独立叠加**一条推文信息条（`components/library/TweetSidebar.tsx`，单独 portal 渲染，覆盖不挤占图像）：头像 · 昵称 · @ID · 正文 · 日期。交互：**点头像/@ID → 作者主页**；**点日期 → 原推文**；条内右上角关闭。文件右键另有「打开原网页」。文件 → 推文信息按优先级解析（`utils/library/trace.ts` 的 `resolveFileTweetInfo`）：
  1. **下载历史** `downloads.jsonl`（最准，含正文/头像）；记录新增 `postUrl`/`platform`/`avatar` 字段（2026-09 起写入，旧记录无 postUrl 时按 twitter 用 `用户名+推文ID` 拼链接）
  2. **联网溯源缓存** `library-trace.json`
  3. **文件名反解**（方向 A，离线）：把当前文件名模板转正则，抠出 `POST_ID`/`USER_SCREEN_NAME`/`POST_TIME`（模板须含这些占位符，且需与下载时一致），够显示作者/时间/链接，拿不到正文/头像（头像/昵称会按用户名 `getUser` 现拉一次并缓存）
- **信息条与关闭按钮**：信息条会挡住 antd 预览自带的右上角关闭按钮与**右切换箭头**，故用 `body.library-tweet-bar-open` + CSS 隐藏关闭按钮、并把右切换箭头挪到信息条左侧、给**视频弹窗**（`.library-video-wrap`）加右内边距（**均保留可用**，关闭统一走信息条右上角）。信息条**左上角可折叠**（折叠后退到右边缘的小按钮）。头像来源优先级：下载历史/溯源记录 → **订阅里同用户名的头像** → 按用户名 `getUser` 现拉（内存缓存）；头像**经 Rust 后端按代理拉取**（`hooks/useRemoteImage.ts`，避免 WebView 直连被墙裂图，失败回退直连）。（曾试过「独立全屏窗口」方案，因新窗口黑屏闪屏不优雅而放弃。）
- **联网溯源（方向 B）**：设置页「重新溯源本地库（联网）」按钮（`services/library-trace.ts` + `stores/library-trace.ts`）。流程：扫各作者文件夹 → 文件名反解出推文 ID（筛出 X 作者）→ `getUser` 拿 userId → `getUserMedias` 逐页拉取 → 用**下载模板**算出期望本地路径并 `fs.exists` 校验 → 命中写入 `library-trace.json`（增量落盘、可取消、后台常驻）。⚠️ 仅 X；文件夹名须为用户名（screen name）；每作者最多 40 页；已删除推文无法找回；Pawchive 不适用；需要 Cookie
- **缩略图缓存**：图片不再直接加载原图，而是生成最长边 400px 的 jpg 缩略图缓存到 `%APPDATA%\p-spider\thumb-cache\<hash>.jpg`，命中即秒开（`utils/thumbnail.ts`）。生成方式：`fs.readBinaryFile` 读字节 → `createImageBitmap` 解码 → canvas 缩放 → `toBlob` → `fs.writeBinaryFile`（**避开 asset 跨源 canvas 污染**）。并发限 2 + 同路径去重；进入视口才生成（`LocalThumb` 组件 + IntersectionObserver）。⚠️ 视频暂无缩略图（仍用 `<video>` 首帧 + 播放按钮）；缓存 key 仅按路径，文件被替换需手动清缓存
- **删除文件**：文件右键「删除文件」→ `fs.removeFile` 永久删除 + 删除对应缩略图缓存，确认弹窗后执行，删完自动重扫当前目录
- **自定义缩略图**：文件右键「设为文件夹缩略图」（仅图片）可把某张图设为所属**一级作者文件夹**的封面，覆盖默认的「文件夹内首图」。存于 store 的 `folderCovers`（一级文件夹名 → 图片路径）；文件夹右键「恢复默认缩略图」可清除
- **排序**：一级文件夹支持「名称 A→Z / Z→A、日期 新→旧 / 旧→新、媒体数 多→少 / 少→多」（**默认 日期 新→旧**）；文件支持「名称 A→Z / Z→A、日期 新→旧 / 旧→新、类型（图片在前）」（**默认 名称 Z→A**）。排序选择为组件内 state（未持久化）。自然排序（`localeCompare` + `numeric`）
- **日期排序 + 文件名辅助**：文件按日期排序时**按「天」比较**，同一天再用文件名辅助（爬虫批量下载常同一天完成，秒级 mtime 差不代表内容先后；文件名含发布时间/序号）。文件夹仍按目录 mtime 精确比较（= 最近一次新增内容的时间）
- **日期来源**：Tauri v1 `fs` 无 stat/mtime API，故新增 Rust 命令 `get_path_mtimes(paths)`（`src-tauri/src/fsutil.rs`）批量取修改时间（毫秒）。文件夹取**目录自身 mtime**（新建文件会更新，近似「最近下载时间」），文件取文件 mtime
- **多选批量操作**：工具栏「多选」按钮（位于排序左侧）。一级文件夹：勾选多个 → 添加标签 / 移除标签 / 清空标签（仅一级，标签只作用于一级文件夹）；文件：勾选多张 → 批量删除。支持全选/取消全选、清空选择；多选下点击卡片=勾选（文件多选时禁用图片预览），选中项高亮描边。子文件夹不支持多选（未做批量归档）
- **文件预览**：图片走 antd `Image.PreviewGroup`（网格用小图，点开看原图），视频点击弹窗播放
- **数据**：标签与自定义缩略图存 `%APPDATA%\p-spider\library.json`（zustand persist + `createTauriFileStorage`，version 1；多标签仍是「标签→folders[]」结构，`folderCovers` 为新增字段，旧数据无需迁移）；联网溯源结果存 `%APPDATA%\p-spider\library-trace.json`；下载历史 `downloads.jsonl` 记录新增 `postUrl`/`platform`/`avatar` 字段（2026-09 起写入，旧行无此字段）
- **UI 缩放适配**：工具栏 `flex-wrap`，计数/「排序」等文字 `shrink-0 whitespace-nowrap`（避免窗口变窄时「N 个文件夹」被挤成竖排）；网格 `repeat(auto-fill,minmax(...))` 自适应
- **代码落点**：
  - `utils/library/`（scan / sort / format / ipc / trace + index barrel）：`listRootFolders`、`summarizeFolder(s)`（递归统计媒体数+取封面，带缓存）、`scanDirectory`、`fetchMtimes`/`fetchFolderStats`（调 Rust）、`formatBytes`、`sortFolders`/`sortFiles`、`resolveFileTweetInfo`/`parseFileName`/`readTraceMap`/`writeTraceMap`、媒体扩展名判断、`mapLimit`
  - `utils/asset.ts`：`toAssetUrl`（Tauri asset 协议，通用）
  - `services/library-actions.ts`：`deleteLibraryFiles`（删除文件 + 清缩略图，FileGrid 单删与 FolderDetail 批删共用）
  - `services/library-trace.ts`：`runLibraryTrace`（联网溯源批量任务）
  - `stores/library-trace.ts`：溯源进度状态（后台常驻、可取消）
  - `hooks/useSelection.ts`：多选状态（FolderGrid / FolderDetail 共用）
  - `src-tauri/src/fsutil.rs`：`get_path_mtimes`（批量取路径 mtime，供日期排序）、`get_folder_stats`（递归统计文件数与占用空间，供属性）
  - `utils/thumbnail.ts`：缩略图缓存（获取/生成/单删/全清 + 并发控制）
  - `utils/shell.ts`：`showInFolder`（资源管理器定位）、`openPath`（系统默认程序打开）
  - `stores/library.ts`：标签 CRUD + 多标签 API + `folderCovers`/`setFolderCover`/`getFolderCover`（自定义缩略图）
  - `pages/Library.tsx` + `components/library/`（`CategorySidebar` / `FolderGrid` / `FolderDetail` / `FileGrid` / `FolderCover` / `LocalThumb` / `SortSelect` / `FolderProperties` / `TweetSidebar`）、路由 `library`
  - 设置页「本地库」区块：清除缩略图缓存按钮 + 当前缓存占用显示；「重新溯源本地库（联网）」按钮 + 进度/取消（`Settings.tsx`）
- **目录判定关键点**：Tauri v1 `fs.readDir(dir, {recursive:false})` 的条目 **无法区分文件/目录**（`children` 均为 null）。因此：列一级目录时用非递归 + 按媒体扩展名过滤非目录项；判断目录一律用 `readDir(recursive:true)` 后看 `Array.isArray(entry.children)`
- **本地图片显示**：用 `convertFileSrc`（Tauri v1 asset 协议，Windows 下 `https://asset.localhost/<编码路径>`）。`tauri.conf.json` 已加 `protocol.asset: true` + `assetScope: ["**"]`。⚠️ **浏览器预览（`pnpm dev`）下 `window.__TAURI__` 不存在，`toAssetUrl` 捕获异常返回空串 → 显示占位；需 `pnpm tauri dev` 桌面实测确认任意路径本地图能否显示**
- **性能**：一级文件夹封面扫描 `mapLimit` 并发 4，结果按路径缓存（`clearFolderSummaryCache()` 可清）；详情页一次递归 readDir 同时得到文件与子文件夹封面，无额外扫描
- **参考**：用户旧项目 **xibao（`E:\AIproject`）** 是成熟的标签树文件管理器，思路可借鉴。当前单级分类，架构预留升级空间


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
4. **asset 协议本地图片**：时间流曾尝试 `convertFileSrc` 加载本地文件（F:\ 下），Tauri v1 的 asset scope 默认不含任意路径，改用推特 CDN 缩略图规避。本地库已配 `protocol.asset: true` + `assetScope: ["**"]`，**待 `pnpm tauri dev` 桌面实测**本地图能否显示；若被拦需查 asset scope 匹配规则
5. **aria2 状态批量查询**：任务量大时可能漏项（见上），如需优化应分批创建任务
6. **Cookie 存储**：明文存在 `app-state.json`，仅本机使用可接受
7. **订阅 store 职责偏重**：`subscription.ts` 同时依赖抓推文、aria2、下载、cookie 多模块。当前规模可接受，扩展前评估是否需要拆分调度/抓取/下载
8. **本地库性能**：一级文件夹封面扫描会递归读取整个子目录树，媒体极多时首次加载偏慢（已并发 4 + 缓存）；缩略图已磁盘缓存（首次生成后秒开）。如需进一步优化可做「浅层找封面」或持久化文件夹汇总缓存
9. **含空格路径打开资源管理器**：`utils/shell.ts` 原用 `path.split(' ')` 拼 explorer 参数，带空格路径会失效；已改为整段路径作为单个参数（Rust `Command::args` 会自行加引号）
10. **本地库删除为永久删除**：文件右键删除走 `fs.removeFile`，不进回收站；已加确认弹窗
11. **本地 fork 继承的历史 tag 清理（待办）**：仓库本地残留 x-spider 时代的历史 tag（v1.0.3~v2.2.2 等，指向旧 commit，未 push 远端），不影响使用但较乱。清理：`git tag | ForEach-Object { git tag -d $_ }`（注意保留自己打的 release tag）。⚠️ 发布新版本前若本地存在同名旧 tag（如 v1.1.0 曾指向旧 commit），必须 `git tag -d v<ver>` 删除，否则 `gh release create` 报 "tag exists but not pushed"

> 说明：更新检查已恢复（`src/github/api.ts` + `src/hooks/useCheckUpdate.ts`），指向 `mdo730/P-spider` 的 releases，按 `tag_name`（须带 `v` 前缀）与当前版本比较。
> 已发布：**v1.1.0**（2026-08-28，Pawchive 平台 + 下载速度 + 多项修复），GitHub Description/Topics/README 已同步。
> **1.1.1 地基修复（2026-09-01）**：
> - `runCreationTask` 死循环防护：本页帖子全无发布时间时强制结束（不再卡 `now.isAfter(since)`）
> - Pawchive 检索竞态保护：请求序号，快速连搜时慢响应不覆盖新结果
> - creator 填充统一：`platforms/archiver.ts` 导出 `withCreator`，三处消费方统一调用（目录命名不再依赖手写 map）
> - aria2 并发控制：`--max-concurrent-downloads=8 --max-connection-per-server=4`，缓解批量下载触发 Cloudflare 掐断（429 / Download aborted）
> - 已知待改（建筑层，下轮）：errorCode 16 退避、缩略图/大文件下载体验细节
> **v1.2.0（2026-09-24，本地库）**：新增「本地库」页（多标签管理 + 本地文件夹/文件浏览），落点 `stores/library.ts`、`utils/library.ts`、`utils/thumbnail.ts`、`components/library/`、`pages/Library.tsx`、路由 `library`、Rust `src-tauri/src/fsutil.rs`；含右键菜单统一操作、**多标签**、属性弹窗（文件数/占用空间）、缩略图磁盘缓存（设置页可查看占用并清除）、文件删除、排序（名称/日期/媒体数）、多选批量加/减标签与删除；顺带修复 `utils/shell.ts` 含空格路径定位。⚠️ asset 协议显示本地图建议桌面实测
> **待办（下轮）**：下载层 errorCode 16 退避、缩略图/大文件下载体验细节
> **本地库体验优化（2026-09，1.2.1）**：默认排序（一级=日期新→旧、文件夹内=名称Z→A）、文件日期排序按天+文件名辅助、文件右键「设为文件夹缩略图」（`folderCovers`）、移除卡片右上角 `⋯` 与多选按钮图标、工具栏窄窗适配、**原推文关联**（窗口内 antd 预览 + 右侧独立叠加信息条：头像/昵称/@ID/正文/日期，点头像→主页、点日期→原推文；来源：下载历史 → 联网溯源 `library-trace.json` → 文件名反解）、**设置页「重新溯源本地库（联网）」**
> **窗口自适应（1.2.1）**：启动时 `useBootstrap` 的 `window` 流程按**当前显示器工作区**计算尺寸（宽 `min(1280, 92%)`、高 `min(920, 85%)`）并居中，解决高 DPI/多屏下默认 1280x920 超出可用高度、底部被任务栏遮挡；`tauri.conf.json` 窗口另加 `center: true`。
> **原生右键菜单屏蔽（1.2.1）**：`main.tsx` 启动时全局拦截 `contextmenu` 并 `preventDefault`（输入框/`contenteditable` 除外，保留右键粘贴），去掉 WebView 自带的「后退/刷新/另存图片」菜单；自定义菜单用 antd Dropdown 的 `contextMenu` 触发，不受影响。

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

> ⚠️ **本机推送/发布需走代理**（直连 github 常被重置）：git 未配代理，用一次性代理
> `git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin master`；
> `gh` 前先设环境变量 `$env:HTTPS_PROXY='http://127.0.0.1:7897'`（端口随代理软件，Clash 常见 7897/7890）。