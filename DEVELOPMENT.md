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
- 缩略图：**本地优先（2026-09-25）**——照片且有 `filePath` 时用 `LocalThumb`（本地缩略图缓存，秒开）+ 本地预览；视频/GIF（本地是 mp4、无本地缩略图）仍走 `mediaUrl?format=jpg&name=thumb`（推特 CDN）
- 原图预览：本地照片用本地文件 asset URL；其余用 `mediaUrl` 原图
- ⚠️ `getMediaThumbUrl` 只有**推特**才加 `?format=jpg&name=thumb`（fig-memo/pawchive 的 `mediaUrl` 已是图本身，加参数会失效）
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

- **标签（多级树，xibao 逻辑）**：标签为**单父森林**（不限层级），**作用对象 = 任意文件夹**（一级 + 子文件夹，用相对 `saveDirBase` 的路径标识）。数据层**只存实际勾选**、不物化祖先链；展示时取「末端标签」并展开祖先链（`厂商 > GSC`）。左栏标签树可**新建根/子标签、重命名、删除、`⋯`→「移动到…」改父级**（用 TreeSelect 选新父级，含「顶层」）。未打任何标签即「未打标签」。**迁移**：`library.json` v1→v2，旧扁平标签提为顶层，成员关系保留
- **标签筛选**：左栏「**多标签**」按钮进入多选筛选（默认单选=点标签只显示该标签**含子孙**下的文件夹）；多选可勾多个，配「**交集/并集**」切换（默认交集），自动去同链冗余。**筛选只作用于一级网格**（文件夹自身或子孙命中）；进入文件夹后恢复正常的媒体浏览（不受筛选影响）。计数为**含子孙**的去重文件夹数（`utils/library/tags.ts`）
- **页面**「本地库」：左侧标签栏（全部/未打标签/自定义，可新建/改名/删除），右侧当前标签下的文件夹卡片网格（封面取文件夹内首图 + 名称 + 媒体数 + 标签数角标）
- **进入文件夹**：
  - 直接含媒体（X）→ 文件网格（图/视频）
  - 含子文件夹（Pawchive `创作者/帖子标题/`）→ 顶部切换 **平铺 / 按文件夹**：平铺=递归所有媒体文件网格；按文件夹=帖子文件夹列表 → 进入看文件（支持多级下钻 + 面包屑）
- **右键菜单（统一操作入口）**：一级文件夹右键 = 打开 / 在资源管理器中打开 / 标签（子菜单，逐项勾选切换，可多标签）/ 新建标签并添加 / 属性 / 恢复默认缩略图（仅设过自定义封面时）；子文件夹右键 = 打开 / 在资源管理器中打开 / 属性；文件右键 = 打开（系统默认程序）/ 在资源管理器中打开 / 打开原网页（有推文信息时）/ 设为文件夹缩略图（仅图片，作用于当前一级作者文件夹）/ 删除文件。⚠️ 卡片右上角 `⋯` 按钮已移除（统一走右键，避免与右键菜单重复）；不再有独立「移出分类」（改为标签子菜单里的勾选切换）
- **平台标记**：一级文件夹卡片**右下角**显示平台小图标（X / Pawchive，白底圆，黑色 X 标才看得见）。判定：下载历史/溯源里的 `platform` 字段优先，否则用**结构启发式**（含子文件夹≈Pawchive，直接含媒体≈X，`summarizeFolder` 里算）。图标为**内置静态资源**（`src/assets/platform-icons/x.png`、`pawchive.png`，取自各站 favicon，Vite 直接 import，**离线可用、不联网**），`components/library/PlatformBadge.tsx`
- **属性弹窗**（`FolderProperties`）：展示 名称 / 标签（末端标签展开祖先链，如 `厂商 > GSC`）/ 媒体数 / 全部文件数 / 占用空间 / 路径。占用空间由 Rust `get_folder_stats` 递归统计
- **原推文关联（本地库）**：图片走**自研轻量查看器**（`components/library/ImageViewer.tsx`，portal 覆盖层，2026-09-25 替代 antd 预览）：无底部操作栏，缩放/旋转/重置放进**右键菜单**（与文件操作合并）；滚轮缩放（**朝鼠标位置**、带 0.16s 缓动）、按住**自由拖动**（不回弹）；**点击空白或图片本身退出**（长图也好退）、`Esc` 关闭；按右侧信息条宽度 `rightInset` 让位使图片在剩余区域居中；左右箭头/方向键切换。视频仍弹窗播放；打开媒体时右侧**独立叠加**一条推文信息条（`components/library/TweetSidebar.tsx`，单独 portal 渲染，覆盖不挤占图像）：头像 · 昵称 · @ID · 正文 · 日期。交互：**点头像/@ID → 作者主页**；**点日期 → 原推文**；条内右上角关闭。文件右键另有「打开原网页」。文件 → 推文信息按优先级解析（`utils/library/trace.ts` 的 `resolveFileTweetInfo`）：
  1. **下载历史** `downloads.jsonl`（最准，含正文/头像）；记录新增 `postUrl`/`platform`/`avatar` 字段（2026-09 起写入，旧记录无 postUrl 时按 twitter 用 `用户名+推文ID` 拼链接）
  2. **联网溯源缓存** `library-trace.json`
  3. **文件名反解**（方向 A，离线）：把当前文件名模板转正则，抠出 `POST_ID`/`USER_SCREEN_NAME`/`POST_TIME`（模板须含这些占位符，且需与下载时一致），够显示作者/时间/链接，拿不到正文/头像（头像/昵称会按用户名 `getUser` 现拉一次并缓存）
- **信息条与查看器定位**：自研查看器通过 `rightInset` 与信息条联动（信息条展开时图片区右缩 320px、关闭/切换箭头与关闭按钮一并左移），不再有「挡住关闭按钮」问题。视频弹窗仍用 `body.library-tweet-bar-open` + `.library-video-wrap` 右内边距让位（保留）。信息条**左上角可折叠**（折叠后退到右边缘的小按钮）。头像来源优先级：下载历史/溯源记录 → **订阅里同用户名的头像** → 按用户名 `getUser` 现拉（内存缓存）；头像**经 Rust 后端按代理拉取**（`hooks/useRemoteImage.ts`，避免 WebView 直连被墙裂图，失败回退直连）。（曾试过「独立全屏窗口」方案，因新窗口黑屏闪屏不优雅而放弃。）
- **联网溯源（方向 B）**：设置页「重新溯源本地库（联网）」按钮（`services/library-trace.ts` + `stores/library-trace.ts`）。流程：扫各作者文件夹 → 文件名反解出推文 ID（筛出 X 作者）→ `getUser` 拿 userId → `getUserMedias` 逐页拉取 → 用**下载模板**算出期望本地路径并 `fs.exists` 校验 → 命中写入 `library-trace.json`（增量落盘、可取消、后台常驻）。⚠️ 仅 X；文件夹名须为用户名（screen name）；每作者最多 40 页；已删除推文无法找回；Pawchive 不适用；需要 Cookie
- **缩略图缓存**：图片不再直接加载原图，而是生成 **200×200 正方形居中裁剪**的 jpg 缩略图缓存到 `%APPDATA%\p-spider\thumb-cache\<hash>.jpg`（缓存 key 含尺寸，改尺寸自动失效重生成），命中即秒开（`utils/thumbnail.ts`）。**生成方式（2026-09-25 起）**：优先调用 **Rust 命令 `generate_thumbnail`**（`src-tauri/src/fsutil.rs`，`image` crate：先读头尺寸→拒绝超大图→decode→`resize_to_fill`→JPEG q82），**在 Rust 线程执行，不占用 WebView 主线程/内存**——彻底解决此前用 canvas 批量生成时把渲染进程压垮导致的白屏/卡死；浏览器预览（无 Tauri）回退原 canvas 实现。并发限 2 + 同路径去重；进入视口才生成（`LocalThumb` 组件 + 共享 IntersectionObserver）。设置页可**「一键生成缩略图缓存」**：扫描保存目录全部图片并预生成（已缓存跳过；后台任务、可取消、进度每 5 个推一次，`services/library-thumb-cache.ts` + `stores/library-thumb-cache.ts`），完成后刷新占用显示。⚠️ Rust 端不支持 avif/heic（这类图回退显示原图）；视频暂无缩略图（仍用 `<video>` 首帧 + 播放按钮）；文件被替换需手动清缓存（key 按路径+尺寸）；超大图（>12000px 或 >50MP）直接跳过。⚠️ fig-memo 引入大量媒体后，全量预生成体积可观（约 23KB/张 → 10w 张约 2.3GB），封面按需生成即可
- **卡片尺寸与缩略图匹配（1.3.1）**：缩略图降到 200×200 后，文件夹/文章卡片同步缩小并给网格列宽**封顶**（一级文件夹 `minmax(9rem,10rem)`、子文件夹 `minmax(9rem,10rem)`、fig-memo 文章 `minmax(10rem,11rem)`、文件/详情图 `minmax(8rem,9rem)`），使显示尺寸不超过缩略图，避免被放大发糊
- **删除文件**：文件右键「删除文件」→ `fs.removeFile` 永久删除 + 删除对应缩略图缓存，确认弹窗后执行，删完自动重扫当前目录
- **自定义缩略图**：文件右键「设为文件夹缩略图」（仅图片）可把某张图设为所属**一级作者文件夹**的封面，覆盖默认的「文件夹内首图」。存于 store 的 `folderCovers`（一级文件夹名 → 图片路径）；文件夹右键「恢复默认缩略图」可清除
- **排序**：一级文件夹支持「名称 A→Z / Z→A、日期 新→旧 / 旧→新、媒体数 多→少 / 少→多」（**默认 日期 新→旧**）；文件支持「名称 A→Z / Z→A、日期 新→旧 / 旧→新、类型（图片在前）」（**默认 名称 Z→A**）。排序选择为组件内 state（未持久化）。自然排序（`localeCompare` + `numeric`）
- **日期排序 + 文件名辅助**：文件按日期排序时**按「天」比较**，同一天再用文件名辅助（爬虫批量下载常同一天完成，秒级 mtime 差不代表内容先后；文件名含发布时间/序号）。文件夹仍按目录 mtime 精确比较（= 最近一次新增内容的时间）
- **日期来源**：Tauri v1 `fs` 无 stat/mtime API，故新增 Rust 命令 `get_path_mtimes(paths)`（`src-tauri/src/fsutil.rs`）批量取修改时间（毫秒）。文件夹取**目录自身 mtime**（新建文件会更新，近似「最近下载时间」），文件取文件 mtime
- **多选批量操作**：工具栏「多选」按钮（位于排序左侧）。一级文件夹：勾选多个 → 添加标签 / 移除标签 / 清空标签（仅一级，标签只作用于一级文件夹）；文件：勾选多张 → 批量删除。支持全选/取消全选、清空选择；多选下点击卡片=勾选（文件多选时禁用图片预览），选中项高亮描边。子文件夹不支持多选（未做批量归档）
- **文件预览**：图片走 antd `Image.PreviewGroup`（网格用小图，点开看原图），视频点击弹窗播放
- **数据**：标签树与自定义缩略图存 `%APPDATA%\p-spider\library.json`（zustand persist + `createTauriFileStorage`，**version 2**：`tags[{id,name,parentId,paths[],sortOrder}]` + `folderCovers`；v1→v2 迁移把旧扁平标签提为顶层、成员关系保留）；联网溯源结果存 `%APPDATA%\p-spider\library-trace.json`；下载历史 `downloads.jsonl` 记录新增 `postUrl`/`platform`/`avatar` 字段（2026-09 起写入，旧行无此字段）
- **UI 缩放适配**：工具栏 `flex-wrap`，计数/「排序」等文字 `shrink-0 whitespace-nowrap`（避免窗口变窄时「N 个文件夹」被挤成竖排）；网格 `repeat(auto-fill,minmax(...))` 自适应
- **代码落点**：
  - `utils/library/`（scan / sort / format / ipc / trace / tags + index barrel）：`listRootFolders`、`summarizeFolder(s)`、`scanDirectory`、`fetchMtimes`/`fetchFolderStats`、`formatBytes`、`sortFolders`/`sortFiles`、`resolveFileTweetInfo`/`parseFileName`/`readTraceMap`/`writeTraceMap`、`buildTagIndex`/`matchesFilter`/`terminalTagIds`/`toRelPath`（标签树工具）、媒体扩展名判断、`mapLimit`
  - `utils/asset.ts`：`toAssetUrl`（Tauri asset 协议，通用）
  - `services/library-actions.ts`：`deleteLibraryFiles`（删除文件 + 清缩略图，FileGrid 单删与 FolderDetail 批删共用）
  - `services/library-trace.ts`：`runLibraryTrace`（联网溯源批量任务）
  - `services/library-thumb-cache.ts`：`runThumbCache`（一键预生成缩略图缓存批量任务）
  - `stores/library-trace.ts`：溯源进度状态（后台常驻、可取消）
  - `stores/library-thumb-cache.ts`：缩略图缓存生成进度状态（后台常驻、可取消）
  - `hooks/useSelection.ts`：多选状态（FolderGrid / FolderDetail 共用）
  - `hooks/useRemoteImage.ts`：远程图片经 Rust（走代理）拉取转 blob（头像用）
  - `src/assets/platform-icons/`：平台标记图标（X / Pawchive，静态资源）
  - `src-tauri/src/fsutil.rs`：`get_path_mtimes`（批量取路径 mtime，供日期排序）、`get_folder_stats`（递归统计文件数与占用空间，供属性）、`generate_thumbnail`（Rust 端生成 200×200 缩略图，不占渲染线程）
  - `utils/thumbnail.ts`：缩略图缓存（获取/生成/单删/全清 + 并发控制）
  - `utils/shell.ts`：`showInFolder`（资源管理器定位）、`openPath`（系统默认程序打开）
  - `stores/library.ts`：标签 CRUD + 多标签 API + `folderCovers`/`setFolderCover`/`getFolderCover`（自定义缩略图）
  - `pages/Library.tsx` + `components/library/`（`CategorySidebar`（标签树）/ `FolderGrid` / `FolderDetail` / `FileGrid` / `FolderCover` / `LocalThumb` / `SortSelect` / `FolderProperties` / `TagAssignModal` / `TweetSidebar` / `PlatformBadge`）、路由 `library`
  - 设置页「本地库」区块：清除缩略图缓存按钮 + 当前缓存占用显示；「重新溯源本地库（联网）」按钮 + 进度/取消（`Settings.tsx`）
- **目录判定关键点**：Tauri v1 `fs.readDir(dir, {recursive:false})` 的条目 **无法区分文件/目录**（`children` 均为 null）。因此：列一级目录时用非递归 + 按媒体扩展名过滤非目录项；判断目录一律用 `readDir(recursive:true)` 后看 `Array.isArray(entry.children)`
- **本地图片显示**：用 `convertFileSrc`（Tauri v1 asset 协议，Windows 下 `https://asset.localhost/<编码路径>`）。`tauri.conf.json` 已加 `protocol.asset: true` + `assetScope: ["**"]`。⚠️ **浏览器预览（`pnpm dev`）下 `window.__TAURI__` 不存在，`toAssetUrl` 捕获异常返回空串 → 显示占位；需 `pnpm tauri dev` 桌面实测确认任意路径本地图能否显示**
- **性能**：一级文件夹封面扫描 `mapLimit` 并发 4，结果按路径缓存（`clearFolderSummaryCache()` 可清）；详情页一次递归 readDir 同时得到文件与子文件夹封面，无额外扫描
- **文件夹导航竞态修复（2026-09-25，1.3.1）**：`FolderDetail` 的 `load`（`scanDirectory` + `fetchMtimes`）无竞态保护，快速「打开→返回→再打开」时旧目录的异步结果会覆盖新目录、或点到旧目录残留的子文件夹 → 表现为「跳到别的文件夹 / 卡顿」。现加**请求序号**（`loadSeq`）丢弃过期结果，并在 `dir` 变化时**立即清空 `content`**（慢加载期间不再显示上一个目录的数据）
- **fig-memo 从本地库排除（1.3.1）**：fig-memo 下载在 `saveDirBase\fig-memo`，但本地库三入口（`pages/Library.tsx` 文件夹网格 / `services/library-thumb-cache.ts` 一键缩略图 / `services/library-trace.ts` 联网溯源）都走 `listRootFolders`，故在 `utils/library/scan.ts` 的 `listRootFolders` 内排除根目录 `fig-memo`（`EXCLUDED_ROOT_FOLDERS`）。fig-memo 有独立选项卡/标签树/收藏，不受影响
- **长列表性能（1.3.1）**：① 卡片加 `.lib-card-cv`（`css/base.css`：`content-visibility: auto` + `contain-intrinsic-size: auto 200px`），视口外卡片跳过布局/绘制 → 窗口拉伸与滚动更轻；② `LocalThumb` 的 IntersectionObserver 改为**全局共享一个**（原每图一个，长列表可达上千）；③ fig-memo 文章卡片参数对齐本地库（网格 `minmax(9rem,10rem)`、封面 `h-[9rem]`）。⚠️ 未做虚拟滚动（若仍卡再上）
- **统一图片右键菜单（1.3.1）**：`utils/image-menu.tsx` 提供 `imageMenuItems(ctx)` / `handleImageMenuKey(key, ctx, message)`，统一四项：**复制图像 / 复制切割图像 / 打开本地储存位置 / 打开原网页**（按可用性显示：无图源不显示前两项、无本地路径不显示「打开本地储存位置」、无原网页不显示「打开原网页」）。接入：本地库文件网格与查看器（`FileGrid`）、fig-memo 列表卡 + 详情图（本地/远程）、时间流每条图片。`ctx = { localPath?, remoteUrl?, postUrl? }`
- **图片切割（1.3.1）**：设置新增「图片切割」区块（`settings.split`，settings version 升到 3）：`direction`（`horizontal`=左右切竖条 / `vertical`=上下切横条）、`parts`（2–20，默认 4）。图片右键「**复制切割图像（N 条）**」按预设切成 N 条，**以「文件列表」写入系统剪贴板**（粘贴即得 N 张图）。实现：前端 `utils/split-image.ts` 读字节（本地 `fs` / 远程经 `ipc/network` 走代理）→ canvas 切片 → 写 `appCacheDir/split-cache/part_i.png`（每次清除重建，非保存目录）→ 调 Rust 命令 `copy_files_to_clipboard`（`src-tauri/src/fsutil.rs`，`clipboard-win` 的 `raw::set_file_list`，写 Windows CF_HDROP）。⚠️ 网页剪贴板不支持多图（多 ClipboardItem 在 WebView2 未实现），故走文件列表方案
- **参考**：用户旧项目 **xibao（本地旧项目）** 是成熟的标签树文件管理器，思路可借鉴。当前单级分类，架构预留升级空间


### fig-memo 自用订阅（parukamun）

> 个人自用功能，**不在通用订阅里暴露**，放设置里默认关闭，避免打扰不用的人。
> **fig-memo 已拆成独立选项卡**，与通用本地库数据分家（2026-09）。

- **位置**：设置 →「parukamun 自用订阅」→ fig-memo。含 **①「启用 fig-memo 功能」总开关**（控制左侧选项卡显隐）+ ②**分类订阅开关列表**（=订阅，**仅决定 24h 追新要自动下载哪些分类**，不影响列表显示）+ 「建库」+「刷新」+ 状态
- **独立选项卡**：路由 `figmemo`（`constants/routes.tsx`），左侧栏按 `useFigmemoStore(featureEnabled)` 决定是否显示；**功能开关与订阅开关解耦**（启用功能 ≠ 订阅）。组件 `pages/Figmemo.tsx` + `components/figmemo/CategorySidebar.tsx`
- **站点**：`fig-memo-r18.site`（WordPress，REST 全开放免登录）；API 根 `/wp-json/wp/v2`
- **分类订阅**：每个站点分类一个开关；首次开启记录基线（当前最新帖），**每 24h** 检查并下载基线之后的新帖（不回补历史）。**建库/订阅共用这批开关**。⚠️ **订阅与列表显示已解耦（2026-09-25）**：列表始终显示全站文章，开关只管追新/建库要下哪些分类
- **建库**：只下载**已开启分类**的现存文章（⚠️ 量大）；**不计入统计**
- **存储**：`保存目录\fig-memo\<日期 标题>\<日期 原文件名>`（日期=文章发布日期 `YYYY-MM-DD`，文件/文件夹都带）；标题截断 60 字。取图：优先 `/wpapi/v2/media?parent=<id>`（附件原图）；**附件为空的老帖回退解析正文 HTML 取原图**
- **元数据**：`%APPDATA%\p-spider\figmemo.jsonl`（每帖一行：postId/标题/分类/日期/链接/图片数；`articleTags` 见下）
- **状态**：`%APPDATA%\p-spider\figmemo-state.json`（enabled/基线/上次检查/每日统计/累计），**不进 subscriptions.json**
- **列表（含未下载）**：拉**站点全站文章** + 本地下载状态合并，未下载也显示（非仅本地）。**列表始终显示全站文章**（2026-09-25 起与订阅分类解耦，订阅不再过滤显示）；封面用站点**特色图 URL**，缺特色图/解析失败的用**正文首图**兜底（未下载也有缩略图）。点未下载文章也能看详情、可「保存该文章」
- **标签树（独立数据）**：fig-memo 标签树独立存 `%APPDATA%\p-spider\figmemo-tags.json`（store `stores/figmemo-tags.ts`，`useFigmemoTagsStore`，version 2）；通用本地库 `library.json` 回退为**扁平分类**（version 1）。**标签由站点数据自动生成**（`syncSiteTags`，打开选项卡/建库/追新即触发，无需手动）：站点分类挂根 `fig-memo`、厂商（标题第一个 `「` 前缀）挂根 `厂商`、发布年份挂根 `年份`；**覆盖全站含未下载**
- **文章级标签（姿势/发型/体型…）**：详情页**右下角圆形按钮**（带已选数角标）→ 点开**竖向浮窗**，**所有分类一次性列出**、各自独立 `Select mode="tags"`（可搜索、多选、输入回车新建、`maxTagCount="responsive"` 折叠防溢出），无需「点一个卡一个」。候选项 = **标签树里该分类根的子标签**（历史自定义值如 `跪姿` 自动复用）+ `TAG_GROUPS` 预设；底部可**「新建分类」**（=建一个根标签，系统保留名 `fig-memo/厂商/年份` 不可用）。选中即：组名作根标签、取值作子标签，把该文章路径挂上去，并写入 `figmemo.jsonl` 的 `articleTags`（未下载也补建记录）。组配置 `TAG_GROUPS`（`pages/Figmemo.tsx`）仅作预设，分类列表由标签树动态生成。按钮/浮窗带交互动画（hover 放大、图标旋转、浮窗淡入滑入、角标 `figmemo-pop` 弹入，`css/base.css` 定义 `@keyframes figmemo-pop`）
- **收藏**：详情页右下角**心形按钮**（标签按钮下方，收藏后 `figmemo-pop` 弹入动画）收藏/取消该文章；存 `%APPDATA%\p-spider\figmemo-favorites.json`（store `stores/figmemo-favorites.ts`，postId 集合）。左侧标签栏「全部 / 未打标签」后新增**「收藏」筛选项**（带数量，可与标签/未打标签叠加）
- **「未打标签」不计数这三类**：`fig-memo`（分类）/`厂商`/`年份` 为自动生成，**不算"已打标签"**（`utils/library/tags.ts: NON_COUNTING_TAG_ROOTS`）；方便找还需手动标注（体型/发型等）的文章。「未打标签」可与标签筛选**叠加**（先点 `评测(R18)` 再点「未打标签」= 该类下无手动标签的文章）
- **缓存 / 加载优化**：站点数据缓存 `%APPDATA%\p-spider\figmemo-site.json`（`{fetchedAt, posts, categories, featured, postCovers}`）。**首次启用/首开做一次全量快照**，之后打开：先用缓存**秒开**（`loadCachedSitePosts`），再后台**增量刷新**（`refreshSitePosts` + `fetchNewPosts` 只拉到第 1 篇已缓存文章为止，通常 1 个请求）；特色图 URL 与正文首图缓存，只为新文章解析；已下载判断用**一次目录枚举**（`listDownloadedFolderNames`）；封面**本地优先**（已下载取本地首图，走缩略图缓存），未下载才用站点封面 URL
- **切换选项卡秒开（2026-09-25）**：fig-memo 页组件离开路由会卸载、每次切回都重建整页。现加**会话级内存缓存**（`Figmemo.tsx` 模块变量 `itemsCache`，`useEffect([items])` 同步）：3 分钟内切回直接用内存列表，仅按 5 分钟间隔后台静默刷新；首次加载 `buildItems` 会跑两遍（缓存 + 刷新），本地封面扫描加**会话缓存** `firstImageInCached`。另：`stores/figmemo-tags.ts` 的 `setFolderTags`/`addFolderTags`/`applyFolderTags`/`removeFolderTags` 改为**无变化不 `set`**——`syncSiteTags` 每次打开都跑，此前即便无变化也会触发 1MB `figmemo-tags.json` 写盘
- **详情**：「保存该文章」按钮 = 手动下载该帖（不计统计、不自动打标）；图片网格支持右键 **复制到剪贴板 / 复制图片链接 / 在浏览器打开原图**（`utils/clipboard.ts` 经 Rust 取字节→PNG→剪贴板）；正文来自 WP `content.rendered` 并清洗 script/style/figure/a/img
- **图片数 / 保存修正（2026-09-25）**：① `fetchPostImages` 请求 `_fields` 加 `media_details`，取 `medium` 档作 `thumbUrl`，详情图网格用小图秒开（预览仍原图）；② 详情头部图片数改用实际拉到的 `images.length`（原用 `selected.imageCount`，未下载/旧记录恒为 0）；③ `saveFigmemoPost` 改为 **upsert** `imageCount`（原仅「无记录时」才写，已打过标签的帖子因 `setArticleTags` 已补建 `imageCount:0` 记录而被跳过 → 保存后仍显示 0 张）；④ `savePost` 后同步 `selected`；⑤ 打开**已下载**文章时若图片数与记录不符，自动修正元数据 + 列表计数（自愈）
- **本地优先（2026-09-25）**：只要文章已下载（本地目录存在），**列表封面**与**详情图片**都优先读本地、不再联网。① 列表封面：`buildItems` 先取本地首图（`coverPath`），走缩略图缓存（`LocalThumb`）秒开，没有才回退站点 `coverUrl`（原逻辑相反：有站点封面就跳过本地）；② 详情图：`openPost` 先 `scanDirectory(folderPath)` 取本地图片，有则用 `LocalThumb` 渲染（本地缩略图缓存 + 本地预览），**跳过站点媒体接口**；本地无图才走 `fetchPostImages`；③ 本地图右键菜单改为「复制图片到剪贴板（`copyLocalImageToClipboard`，不联网）/ 在资源管理器中打开」，远程图仍为「复制到剪贴板 / 复制链接 / 浏览器打开原图」
- **性能（2026-09-25 修复点便签卡顿）**：`pages/Figmemo.tsx` 的 `counts`/`filtered` 原来写在详情页 `if (selected) return` 之前，**每次点便签都全量重算**（1688 篇 × 326 标签，其中「未打标签」还要对每篇扫全部标签的 paths，≈千万次 `normalizeRel`），主线程阻塞 → 卡顿。现：① 详情页用 `hasSelected` 早退，跳过列表统计/筛选；② 新增 `computeTagCounts(index, relPaths)`（`utils/library/tags.ts`），一次遍历算出「含子孙覆盖数 + 未打手动标签数」，复杂度从 O(标签×路径) 降到近似线性（已随机对拍 2 万例与旧算法一致）。
- **计入统计**：`Statistics` 页把 figmemo 作为**独立项**；**只计「追新」下载**（任务带 `subscriptionId=figmemo-feed`），建库/手动保存不计入
- **进时间流**：复用下载历史（`downloads.jsonl`，platform=figmemo、postUrl=帖子链接）
- **复用下载管线**：`batchCreateDownloadTask`（source=`figmemo`）；`aria2DownloadOptions` Referer 按源取
- **代码落点**：`services/figmemo.ts`（抓取/建库/追新/元数据/`syncSiteTags`/`setArticleTags`/`loadCachedSitePosts`/`refreshSitePosts`）、`stores/figmemo.ts`（状态 + 24h 调度 + 统计监听）、`stores/figmemo-tags.ts`（标签树，含批量 `addTagsBatch`/`applyFolderTags`/`removeFolderTags`）、`pages/Figmemo.tsx`、`components/figmemo/CategorySidebar.tsx`、`utils/library/tags.ts`（`folderManualTagIds`/`NON_COUNTING_TAG_ROOTS`）；`PlatformSource` 加 `figmemo`、`PlatformBadge` 加图标
- ⚠️ 注意：站点改版可能影响解析（都在 `services/figmemo.ts` 内）；R18 内容自行把握
- ⚠️ 待清理：`download.ts` 里仍有 `if (source === 'figmemo')` 的命名分支（计划抽成「按源命名钩子」）



### 回滚点（1.1.3）

- git 分支 `backup-1.1.3` → commit `19894a2`（本地；因 github 连接失败暂未 push 远端）
- 物理源码备份：`x-spider-backup-1.1.3.zip`
- 回滚：`git checkout backup-1.1.3` 或解压 zip

### 回滚点（1.2.2，标签树改造前）

- git 分支 `backup-1.2.2` → commit `c3fd23c`（本地；未 push 远端）
- 物理源码备份：`x-spider-backup-1.2.2.zip`（`git archive HEAD`，仅跟踪文件）
- 回滚：`git checkout backup-1.2.2` 或解压 zip
- 说明：本地库「多级标签树」改造前的稳定点（含平台标记、一键缩略图缓存、fig-memo 之前）

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
4. **asset 协议本地图片**：时间流曾尝试 `convertFileSrc` 加载本地文件（任意盘符下），Tauri v1 的 asset scope 默认不含任意路径，改用推特 CDN 缩略图规避。本地库已配 `protocol.asset: true` + `assetScope: ["**"]`，**待 `pnpm tauri dev` 桌面实测**本地图能否显示；若被拦需查 asset scope 匹配规则
5. **aria2 状态批量查询**：任务量大时可能漏项（见上），如需优化应分批创建任务
6. **Cookie 存储**：明文存在 `app-state.json`，仅本机使用可接受
7. **订阅 store 职责偏重**：`subscription.ts` 同时依赖抓推文、aria2、下载、cookie 多模块。当前规模可接受，扩展前评估是否需要拆分调度/抓取/下载
8. **本地库性能**：一级文件夹封面扫描会递归读取整个子目录树，媒体极多时首次加载偏慢（已并发 4 + 缓存）；缩略图已磁盘缓存（首次生成后秒开）。如需进一步优化可做「浅层找封面」或持久化文件夹汇总缓存
9. **含空格路径打开资源管理器**：`utils/shell.ts` 原用 `path.split(' ')` 拼 explorer 参数，带空格路径会失效；已改为整段路径作为单个参数（Rust `Command::args` 会自行加引号）
10. **本地库删除为永久删除**：文件右键删除走 `fs.removeFile`，不进回收站；已加确认弹窗
11. **本地 fork 继承的历史 tag 清理（待办）**：仓库本地残留 x-spider 时代的历史 tag（v1.0.3~v2.2.2 等，指向旧 commit，未 push 远端），不影响使用但较乱。清理：`git tag | ForEach-Object { git tag -d $_ }`（注意保留自己打的 release tag）。⚠️ 发布新版本前若本地存在同名旧 tag（如 v1.1.0 曾指向旧 commit），必须 `git tag -d v<ver>` 删除，否则 `gh release create` 报 "tag exists but not pushed"
12. **fig-memo 待办（1.3.0 未发版）**：
    - `download.ts` 里 `if (source === 'figmemo')` 命名分支去泄漏 → 抽「按源命名钩子」
    - fig-memo 列表进一步性能：长列表虚拟滚动 / 封面 IntersectionObserver 懒加载（当前一次性渲染 + 浏览器 lazy）
    - 「只生成文件夹封面缓存」独立按钮（若需要）
    - 站点改版兜底：解析逻辑集中 `services/figmemo.ts`，失败只影响本功能
13. **部署/验证环境备忘**：本机 `git push` 需带代理 `git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin master`；`gh` 前设 `$env:HTTPS_PROXY='http://127.0.0.1:7897'`；测试产物目录 `<测试目录>`（`P-Spider.exe` 与 `aria2c.exe` 必须同目录）。⚠️ 用 PowerShell 读写源码会破坏 UTF-8，请用 `[IO.File]::ReadAllText/WriteAllText(..., UTF8Encoding($false))`，git 取文件用 `cmd /c "git show <ref>:<path> > <out>"`

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
> **平台标记（1.3.0，未发版）**：本地库一级文件夹卡片右下角显示 X / Pawchive 图标；判定=历史/溯源 `platform` 优先、否则结构启发式；图标为内置静态资源 `src/assets/platform-icons/`（取自各站 favicon，离线可用）。
> **本地库多级标签树（1.3.0，未发版；回滚点 backup-1.2.2）**：标签改为**单父森林 + 任意文件夹**（`library.json` v2）；左栏标签树（新建/重命名/删除/「移动到…」改父级）；打标签用树形多选弹窗；展示取末端标签展开祖先链；筛选（单选默认 / 「多标签」多选 + 交集并集，含子树计数）——对齐 xibao 逻辑。
> **fig-memo 自用订阅（1.3.0，未发版）**：设置→「parukamun 自用订阅」→ fig-memo（默认关）；开关每 24h 追新、建库按钮下现存全部；存 `保存目录\fig-memo\<标题>\`；元数据 `figmemo.jsonl`、状态 `figmemo-state.json`；分类自动落成标签；计入统计（独立项）+ 时间流。落点 `services/figmemo.ts` + `stores/figmemo.ts`。
> **fig-memo 独立选项卡 + 标签/缓存改造（1.3.0，未发版，2026-09-25）**：
> - 拆**独立选项卡**（`pages/Figmemo.tsx` + `components/figmemo/CategorySidebar.tsx`，路由 `figmemo`）；设置加「启用 fig-memo 功能」开关（`featureEnabled`）控制显隐，与订阅解耦。
> - 标签树数据分家：`figmemo-tags.json`（`stores/figmemo-tags.ts` v2）；通用 `library.json` 回退扁平 v1。
> - 列表改**站点全站文章（含未下载）** + 本地合并；封面用特色图 URL，缺图用**正文首图**兜底（`postCovers`）；特色图批量解析失败改**二分重试**；点开未下载可看详情 + 「保存该文章」。
> - 标签由站点数据**自动生成**（分类/厂商/年份，覆盖含未下载）；详情右下角**悬浮按钮窗**加**文章级标签**（姿势/发型/体型 + 自定义），组→根标签、取值→子标签，写入 `articleTags`。
> - 「未打标签」**不计** `fig-memo`/`厂商`/`年份`，且可与标签筛选**叠加**（`NON_COUNTING_TAG_ROOTS`、`folderManualTagIds`）。
> - 性能：`figmemo-site.json` 缓存（首次全量快照 → 之后**增量拉新**、缓存秒开）；已下载用一次目录枚举；新增 store 批量 `addTagsBatch`/`applyFolderTags`/`removeFolderTags`。
> **原生右键菜单屏蔽（1.2.1）**：`main.tsx` 启动时全局拦截 `contextmenu` 并 `preventDefault`（输入框/`contenteditable` 除外，保留右键粘贴），去掉 WebView 自带的「后退/刷新/另存图片」菜单；自定义菜单用 antd Dropdown 的 `contextMenu` 触发，不受影响。**例外**：antd 放大预览图 `.ant-image-preview-img` 放行原生菜单，便于「复制图片 / 图片另存为」（2026-09-25）。

## 如何发布新版

1. 改 `package.json` version，**同步改 `src-tauri/Cargo.toml` version**（exe 内嵌版本与安装包名需一致；tauri.conf.json 的 version 引用 package.json）
2. 跑 `pnpm typeCheck` + `npx eslint ./src` + `pnpm build`
3. `pnpm tauri build` 生成 exe + NSIS。注意：exe 被占用（正在运行的 P-Spider）会失败，需先退出；NSIS 偶发文件锁可重试
4. 产物：`src-tauri/target/release/P-Spider.exe` + `aria2c.exe` + `bundle/nsis/P-Spider_<ver>_x64-setup.exe`
5. 提交代码：`git add -A` + commit + `git push`
6. 发布 GitHub Release（`gh` 已装并登录 mdo730）：
   - 若本地存在同名旧 tag（fork 继承的历史 tag 指向旧 commit），先 `git tag -d v<ver>`
   - `gh release create v<ver> --title "P-Spider <ver>" --notes-file <notes.md> <P-Spider.exe> <aria2c.exe> <setup.exe>`
7. 可选：更新 README / GitHub Description / Topics（`gh api` 或 PUT `/repos/.../topics`）
8. 若改图标：先 `pnpm tauri icon <源图>` 再打包，并清 Windows 图标缓存（重启 explorer）

> ⚠️ **本机推送/发布需走代理**（直连 github 常被重置）：git 未配代理，用一次性代理
> `git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin master`；
> `gh` 前先设环境变量 `$env:HTTPS_PROXY='http://127.0.0.1:7897'`（端口随代理软件，Clash 常见 7897/7890）。