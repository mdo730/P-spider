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
    Homepage.tsx        主页（检索 + 下载配置）
    Subscription.tsx    订阅管理
    Statistics.tsx      统计（柱状图 + 排行）
    Timeline.tsx        时间流（近7天下载记录）
    DownloadManagement.tsx 下载管理
    Settings.tsx        设置
    About.tsx           关于
  components/       通用组件
    homepage/DownloadController.tsx  主页下载/订阅按钮
    download-management/  下载列表
    settings/           设置项组件
  stores/           状态管理（Zustand + persist）
    subscription.ts      订阅 store + 调度循环（每1秒扫一次，到点检查）
    download.ts          下载任务 store + aria2 状态同步
    download-history.ts  下载历史（jsonl 文件）
    settings.ts / app-state.ts / route.ts / homepage.ts
  twitter/
    api.ts             Twitter GraphQL 调用（getUser/getUserMedias/getUserTweets）
    url.ts / utils.ts  推文/媒体 URL 工具
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

### 下载任务

- `download.ts`：`createCreationTask`（爬虫任务，带 dateRange/媒体类型过滤）→ `batchCreateDownloadTask`（批量 addUri + tellStatus）
- 已知边界：大批量任务时 aria2 RPC 批量状态查询可能漏项，`statusMap[gid]` 缺失时兜底为 Active（防崩溃，但状态可能短暂不准）

## 已知问题 / 维护注意

1. **HomeTimeline（真首页动态）未实现**：GraphQL hash 硬编码在 X 混淆 JS 里，频繁变化，第三方库维护的 hash 也易失效（实测 403）。如需实现需引入无头浏览器动态抓取 hash，工程量大且不稳定，已放弃
2. **asset 协议本地图片**：时间流曾尝试 `convertFileSrc` 加载本地文件（F:\ 下），Tauri v1 的 asset scope 默认不含任意路径，改用推特 CDN 缩略图规避
3. **aria2 状态批量查询**：任务量大时可能漏项（见上），如需优化应分批创建任务
4. **更新检查已移除**：github/api.ts 及 hooks 已删除（原更新走作者仓库，改名后无意义）
5. **Cookie 存储**：明文存在 `app-state.json`，仅本机使用可接受

## 如何发布新版

1. 改 `package.json` version
2. 改代码后跑 `pnpm typeCheck` + `npx eslint ./src` + `pnpm build`
3. `pnpm tauri build` 生成 exe + NSIS
4. 复制 `src-tauri/target/release/P-Spider.exe` 和 `aria2c.exe` 到发布目录（同目录）
5. 若改图标：先 `pnpm tauri icon <源图>` 再打包，并清 Windows 图标缓存（重启 explorer）