# P-Spider 1.6.0 开发计划（已定稿）

> 本文件记录 1.6.0 全部功能的**最终方案**（会话讨论定案），实现时按此执行。
> 相关：`HANDOFF.md`（会话交接）、`DEVELOPMENT.md`（架构地图）。

## 版本范围

1.6.0 一次性包含四项：② 侧栏、③ 超级旁观者、④ 时间流 v2、① pixiv（L2+L3）。

---

## ② 侧栏（已完成）

- 设置 →「侧栏」区块：可隐藏项 = `X主页(home) / Pawchive(archiver) / 本地库(library) / 统计(statistics) / fig-memo / moeyo / pixiv`；
  其余（`时间流 / 订阅 / 下载管理 / 设置 / 关于`）**常显不可藏**。
- **全列可排序**（设置里上下箭头，无拖拽）；未列出的按默认顺序排在其后。
- 侧栏**紧凑化**（`py-2` / `space-y-1` / `pt-4`）+ 导航区 `overflow-y-auto` 兜底。
- 隐藏的正是当前页 → 自动跳回**时间流**。
- 存储：`settings.sidebar = { hidden: string[]; order: string[]; iconOnly: boolean }`；settings 版本 **4→5**（后随 pixiv 升到 6，含迁移）。
- **侧栏图标用各站 favicon**（fig-memo / moeyo / pixiv 不再是同一个通用图标）。
- **「仅显示图标」（侧栏更窄）**：设置 → 侧栏开关 `sidebar.iconOnly`；开启后侧栏 `w-52→w-14`、条目只剩图标（悬停出名称），主内容左边距同步 `pl-52→pl-14`。
- 可隐藏白名单常量：`src/constants/routes.tsx` 的 `SIDEBAR_HIDEABLE_IDS`；排序工具 `applySidebarOrder()`。

## ③ 超级旁观者（已完成）

- 设置 →「应用」开关：`settings.app.spectator`（默认 false，持久化）。
- 语义：**只拦「自动」下载**——`X/Pawchive/pixiv` 订阅检查、`fig-memo/moeyo` 追新一律不落盘（仍更新基线 / 元数据 / 缓存，供时间流用）；
  **手动保存文章、手动「建库」照常下载**。
  - 判定：订阅/追新的「检测刷新」（含手动刷新按钮触发的那次检查）都算自动 → 不下载。
- 开启时**全局主色切 `#D76998`**（走 antd cssVar，`App.tsx` 里按 `app.spectator` 切 `colorPrimary`）。
- 实现：`src/utils/spectator.ts` 的 `isSpectatorOn()`；拦截点 `stores/subscription.ts`（twitter/archiver）、`services/figmemo.ts` / `services/moeyo.ts` 的 `processPost`（`isFeed && spectator` 时只写元数据不下载）。

---

## ④ 时间流 v2（已完成，2026-09-29）

### 目标
时间流数据源从「下载记录 `downloads.jsonl`」改为「**订阅刷新结果 feed 缓存**」，不再有滞后（下不下载都能即时看到）。
`downloads.jsonl` **保留**（本地库「溯源」仍用），只是不再作为时间流数据源。

### 数据来源
- **X / Pawchive / pixiv**：新建 **feed 缓存**（如 `%APPDATA%\p-spider\timeline-feed.jsonl`），由**现有订阅刷新逻辑**在拉取时顺带写入（**不新增轮询**；沿用现有刷新节奏/页数，Pawchive 同）。
  - 缓存字段：`id / source / url / time(ISO) / text / username / displayName / avatar / medias[{type,url,videoUrl?,thumbUrl?}]`。
  - 去重按 post id；保留天数跟设置；只存「拉到的最新一页」，按保留天数裁剪。
- **fig-memo / moeyo**：沿用现有 `getRecentSiteNotes(days)` + 站点缓存。
- **转贴**：沿用现有 `retweets.jsonl`（`getRecentRetweetNotes`）。

### 标注（在作者 ID 下方）
- **X / Pawchive / pixiv**：按**本地库标签**（`library.json` 的 tag，作用在保存目录下的作者文件夹）标 `[标签]`，**最多显示最靠前 3 个**，无标签不标。
- **fig-memo / moeyo**：标站点 `[分类]`。
- **转贴**：标 `[转贴]`。

### 配色
- fig-memo / moeyo 的**每个站点分类**分配一个**低饱和度固定色**（按分类名 hash 到一组预设低饱和色板）。
- 该色**同时用于**：时间流的分类标注 + fig-memo/moeyo 标签页侧栏的分类标签。

### 筛选（右下角浮窗）
- 位置：右下角圆形按钮组，**回到顶部 ↔ 刷新 之间**加一个「标签」按钮。
- 点击展开 **约 1/4 屏的浮窗**，里面标签以**胶囊**形式排列；默认 `[全部]`。
- 点任意胶囊 → `[全部]` 取消激活，开始过滤；点 `[全部]` → 清空其余，恢复默认。
- **多选 = 并集(OR)**；父标签**含子孙**；**没命中的条目隐藏**。
- 胶囊维度：**本地库标签** + `[转贴]` + `[fig-memo]` + `[moeyo]`（fig-memo/moeyo 的**分类暂不进筛选**）。

### 影响文件（实际落地）
- 新增：`src/services/feed.ts`（feed 缓存）、`src/utils/tag-color.ts`（低饱和固定色板）。
- 改：`stores/subscription.ts`（订阅刷新时顺带写 feed）、`pages/Timeline.tsx`（数据源改 feed + 标注 + 筛选浮窗）、
  `stores/download-history.ts`（`TimelineGroup` 加 `libraryTags`/`filterTokens`）、
  `services/user-folders.ts`（加只读查询 `getUserFolderMap`）、
  `components/figmemo|moeyo/CategorySidebar.tsx`（分类标签上色）。

### 实现说明 / 与计划的差异
- **保留天数跟随设置**：feed 缓存按 `timeline.rangeDays`（1~30）裁剪；时间流同口径载入（设 30 天就载 30 天，设 7 天就载 7 天）。
- **不含首启种子**：feed 完全由订阅刷新产生，不回溯 `downloads.jsonl`。
  → 升级后需一次订阅刷新（点时间流「刷新」或等订阅到点）才会有 X/Pawchive 内容；之后随每次刷新自然积累到保留窗口。
- **「父含子孙」**：当前本地库标签是**扁平**的（`library.json` v1 `categories`，无层级），故筛选为精确匹配；
  已按通用写法实现，将来库标签若升级为树可直接扩展。
- 发布说明：本次为纯前端改动，无 Rust 改动、无 settings 版本变化。

---

## ① pixiv（L2 + L3 均已完成 2026-09-29）

### 登录（定稿：浏览器 PKCE 授权码登录；refresh_token 手动兜底）
- **pixiv 已关闭 password grant**（实测 `oauth.secure` 返回 `The grant type is unauthorized for this client_id`），账号密码直登不可行。
- 设置 →「pixiv」区块，**「打开 pixiv 登录页」**（PKCE S256，浏览器打开 `app-api.pixiv.net/web/v1/login?...client=pixiv-android`）→ 在浏览器登录（captcha/2FA 都在浏览器完成）→ 回跳 `pixiv://account/login?code=…`，把地址栏整段粘回 →「完成登录」用 `authorization_code` 换 `refresh_token`（gppt 同款：`redirect_uri=…/users/auth/pixiv/callback`，iOS 头）。**只保存 refresh_token**。
- **兜底**：也可手动粘贴 `refresh_token`「保存并校验」；Cookie 字段可填但不依赖。
- 服务端轮换时自动保存新的 refresh_token。

### 浏览（仿 X 主页手感）
- 顶部输入框：**贴链接或数字 ID 自动识别**（画师主页 / 作品链接均可）。
- 下方：画师信息 + 作品网格 + **媒体类型筛选** + **时间范围筛选**（复用 X 那套）。**暂不做订阅按钮**（订阅走设置/单独入口）。

### 下载
- 沿用设置里的**下载目录 / 文件名模板**（占位符映射：`USER_SCREEN_NAME`=画师、`USER_NAME`=昵称、`POST_ID`=作品ID、`POST_TIME`=投稿时间、`MEDIA_INDEX`=页码）。
- 多图全下；**ugoira 动图跟 X 一致**：默认存 **mp4**，勾选「GIF 转真实 gif」时存 gif。
- 图片请求带 `Referer: https://www.pixiv.net/` + Cookie。
- **R18 支持**（需账号开启「R-18 表示」）。
- 新平台来源 `pixiv`（平台图标）；**做画师→文件夹名绑定**（同 X 的 `user-folders.json`），让时间流的本地库标签对得上。

### 订阅（L3，已完成）
- **自建订阅列表**（同 X，不依赖 pixiv「关注」）：pixiv 页画师卡上「订阅该画师」+ 间隔选择；`username` 存画师数字 id。
- 定时拉画师最新一页作品（`/v1/user/illusts?type=illust`）→ 与 `lastTweetId`（复用字段）基线对比 → 新的下载；首次订阅只建基线不下载。
- **限速**：复用订阅调度的并发闸门（`CHECK_CONCURRENCY=4` + 每单 200ms 间隔），多画师轮询不叠加。
- 订阅结果写入 **feed 缓存** → 进**时间流 v2**（和 X/Pawchive 同类，标本地库标签；因 `resolveFeedLibraryTags` 用 `pixiv:un:<account>` 绑定）。
- ⚠️ 只订阅「插画」（含动图，动图走 zip→mp4/gif）；漫画暂不含；超级旁观者开启时不下载但仍更新基线与 feed。

### 实现说明（L2 已落地）
- 新增：`services/pixiv.ts`（OAuth 换 token + app-api 客户端 + 输入解析）、`services/pixiv-download.ts`（多图/ugoira 下载）、
  `stores/pixiv.ts`（浏览状态）、`pages/Pixiv.tsx`、`platforms/pixiv.ts`（适配器）、`assets/platform-icons/pixiv.svg`；
  Rust 新增命令 `download_and_convert_ugoira`（下载 ugoira zip → `zip` 解压帧 → 系统 ffmpeg 合成 mp4/gif）。
- 改：`platforms/types.ts`（`PlatformSource` 加 `pixiv`）、`platforms/index.ts`、`stores/download.ts`（pixiv 走文件名模板 + Referer/Cookie）、
  `components/library/PlatformBadge.tsx`、`interfaces/Settings.ts` + `constants/settings.ts`（版本 5→6）+ `stores/settings.ts`（迁移）、
  `pages/Settings.tsx`（pixiv 区块）、`constants/routes.tsx`（路由/侧栏）。
- 作品类型：列表同时拉 `type=illust`（含 ugoira）与 `type=manga`；筛选/时间范围在前端完成。
- **批量「开始下载全部」走适配器**：仅 `illust`（含 ugoira 会跳过），manga 暂不进批量（后续可补）；ugoira 请在网格单独下载（走 zip→mp4/gif）。

---

## 建议实现顺序

②③（已完成）→ ④ 时间流 v2（底层数据流，pixiv 要接入其 source 契约）→ ① pixiv L2 → ① pixiv L3。
