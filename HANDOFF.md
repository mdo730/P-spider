# P-Spider 会话交接（HANDOFF）

> 用途：开新会话时把本项目状态快速交接给 AI。最后更新：2026-09-25

## 一句话现状

P-Spider（fork 自 x-spider）**v1.3.1 已发布（2026-09-25，GitHub Release `v1.3.1`）**，fig-memo 自用订阅 + 本地库标签改造。本轮（1.3.1）已完成：列表与订阅解耦（文章全显示、订阅只管追新）、本地库文件夹导航竞态修复、fig-memo 本地优先（封面/详情图）、标签浮窗现代化 + 收藏、图片数/保存修正、放大图右键、点标签卡顿修复、自研图片查看器、统一图片右键菜单 + 图片切割、切换秒开。

## 项目关键信息

- 路径：本仓库（git 仓库，分支 `master`）
- 技术栈：Tauri v1 + React18 + TS + Vite + Tailwind + antd5 + Zustand
- 版本：`1.3.1`（`package.json` 与 `src-tauri/Cargo.toml` 同步）
- 文档：`DEVELOPMENT.md`（架构地图 + 功能 + 待办 + 发布流程），**改动后同步更新**
- 回滚点：分支 `backup-1.2.2`（commit `c3fd23c`）、zip `x-spider-backup-1.2.2.zip`

## 环境 / 操作约定（重要）

- 验证：`pnpm typeCheck` → `npx eslint ./src` → `pnpm build`
- 打包：**用户明确说"打包"才** `pnpm tauri build`（产物含 `publisher exe + aria2c.exe + NSIS`）
- 测试产物目录：`<测试目录>`（`P-Spider.exe` 与 `aria2c.exe` **必须同目录**）；exe 在运行时拷贝会被占用，需先退出
- `git push` 需代理：`git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin master`；`gh` 前设 `$env:HTTPS_PROXY='http://127.0.0.1:7897'`
- ⚠️ **禁止用 PowerShell 读写源码**（破坏 UTF-8）；用 `[IO.File]::ReadAllText/WriteAllText(..., UTF8Encoding($false))`，从 git 取文件用 `cmd /c "git show <ref>:<path> > <out>"`
- 终端中文：`[Console]::OutputEncoding=[System.Text.Encoding]::UTF8`

## 数据文件（`%APPDATA%\p-spider\`）

- `settings.json`（含 `download.saveDirBase`，用户为 `<保存目录>`）
- `library.json`（通用本地库，回退为扁平分类 version 1）
- `figmemo-tags.json`（fig-memo 标签树，version 2）
- `figmemo.jsonl`（fig-memo 每帖元数据，含 `articleTags`）
- `figmemo-site.json`（站点缓存：posts/categories/featured/postCovers）
- `figmemo-state.json`（订阅基线/统计）、`figmemo-favorites.json`（收藏 postId）、`downloads.jsonl`、`subscriptions.json`、`library-trace.json`

## 本轮已完成（2026-09-25）

1. **fig-memo 独立选项卡**：路由 `figmemo`；设置里「启用 fig-memo 功能」开关（`featureEnabled`）控制显隐，与分类订阅解耦。标签树数据分家（`figmemo-tags.json`）。
2. **列表含未下载文章**：拉站点全站文章 + 本地状态合并；**列表始终显示全站文章**（1.3.1 起与订阅分类解耦）；未下载也有封面缩略图、可看详情、「保存该文章」。
3. **标签自动生成**：`syncSiteTags` 由站点数据生成 分类（根 `fig-memo`）/ 厂商（根 `厂商`）/ 年份（根 `年份`），覆盖含未下载；打开选项卡即刷新，**取消手动「补标签」**。
4. **文章级标签**：详情右下角圆形按钮 → 竖向浮窗，**所有分类一次勾选**（每类 `Select mode="tags"`：搜索/多选/输入新建/`maxTagCount` 防溢出），候选=标签树子标签（历史自定义值自动复用）+ 预设；底部可**新建分类**。选中写 `figmemo.jsonl` 的 `articleTags` 并落标签树。
5. **未打标签规则**：`fig-memo`/`厂商`/`年份` 不计入「已打标签」；「未打标签」可与标签筛选叠加。
6. **加载优化**：`figmemo-site.json` 缓存，首次全量快照 → 之后增量拉新 + 缓存秒开；已下载用一次目录枚举；store 批量写盘。
7. **封面兜底**：特色图批量解析失败改二分重试；无特色图用正文首图（`postCovers`）。已离线把缓存里 1130 篇缺封面全部补齐（2018 年 139/139 有图）。
8. **放大图片右键放行**：`main.tsx` 全局拦截 `contextmenu` 时例外放行 `.ant-image-preview-img`，恢复 WebView 原生菜单，可「复制图片 / 图片另存为」。
9. **fig-memo 点便签卡顿修复**：`Figmemo.tsx` 的 `counts`/`filtered` 详情页早退（不再重算列表）；新增 `computeTagCounts`（`utils/library/tags.ts`）线性统计，替换原先 O(标签×路径) 的全量过滤（已随机对拍 2 万例一致）。
10. **标签浮窗现代化 + 收藏**：右下角改用梯度圆按钮（hover 放大/图标旋转/浮窗淡入滑入/角标弹入，`@keyframes figmemo-pop`）；标签按钮下方加**心形收藏按钮**（`stores/figmemo-favorites.ts` → `figmemo-favorites.json`）；左侧标签栏「未打标签」后加**「收藏」筛选**（可与标签叠加，带数量）。`LibraryFilter` 增 `favoritesOnly`。
11. **fig-memo 图片数 / 保存修正**：详情图网格改用 WP `medium` 缩略图（`media_details`）秒开、预览仍原图；头部图片数改用实际 `images.length`；`saveFigmemoPost` 改 **upsert** `imageCount`（原仅无记录时写，已打标签的帖子保存后仍显示 0 张）；打开已下载文章时自动自愈计数。
12. **fig-memo 本地优先**：文章已下载则**列表封面**与**详情图**都优先本地（`LocalThumb` 缩略图缓存），不再联网；详情 `openPost` 本地有图时跳过站点媒体接口；本地图右键=复制到剪贴板（本地，不联网）/资源管理器打开。`buildItems` 封面改本地优先（原为站点封面优先）。
13. **列表与订阅解耦（1.3.1）**：`Figmemo.tsx` 的 `load` 不再传 `enabledCategories`，列表始终全显示；订阅开关只决定后台 24h 追新/建库下载哪些分类。
14. **本地库文件夹导航竞态修复（1.3.1）**：`FolderDetail` 加载加请求序号 + 切目录清空 `content`，修「点文件夹跳到别的文件夹 / 高频点击卡顿」。
15. **缩略图改 200×200（1.3.1 试验）**：`utils/thumbnail.ts` 由「最长边 400 保持比例」改为 **200×200 正方形居中裁剪**，缓存 key 含尺寸（旧 400 缓存自动失效，旧文件仍在 `thumb-cache` 需手动清）。测量参考：旧约 22.9KB/张；全量 10w 张约 2.3GB，故建议封面按需生成。
16. **卡片尺寸匹配缩略图（1.3.1）**：卡片/网格同步缩小并列宽封顶（一级 `minmax(9rem,10rem)`、子文件夹同、fig-memo 文章 `minmax(10rem,11rem)`、文件/详情图 `minmax(8rem,9rem)`），避免 200px 缩略图被放大发糊。
17. **fig-memo 移出本地库（1.3.1）**：`utils/library/scan.ts` 的 `listRootFolders` 排除根目录 `fig-memo`（`EXCLUDED_ROOT_FOLDERS`），本地库网格 / 一键缩略图 / 联网溯源三入口同时生效；fig-memo 独立选项卡不受影响。
18. **长列表性能（1.3.1）**：卡片加 `.lib-card-cv`（`content-visibility:auto` + `contain-intrinsic-size:auto 200px`）；`LocalThumb` 的 IntersectionObserver 全局共享一个（原每图一个）；fig-memo 卡片参数对齐本地库（`minmax(9rem,10rem)`/封面 `h-[9rem]`）。虚拟滚动仍未做。
19. **时间流本地优先（1.3.1）**：`Timeline.tsx` 照片有 `filePath` 时用 `LocalThumb`（本地缩略图缓存 + 本地预览），视频/GIF 仍走 CDN；`getMediaThumbUrl` 只有推特才加 `?format=jpg&name=thumb`。另确认：`一键生成缩略图` 因 `listRootFolders` 排除 fig-memo 而**不再扫 fig-memo**（按需生成为主）。
20. **缩略图改 Rust 端生成（1.3.1，修白屏）**：批量生成缩略图用 canvas 把 WebView 渲染进程压垮（日志骤停、白屏）。新增 Rust 命令 `generate_thumbnail`（`image` crate，`src-tauri/src/fsutil.rs`，Cargo 加 `image` 依赖）：读头尺寸拒绝超大图（>12000px/>50MP）→ decode → `resize_to_fill` 200×200 → JPEG q82，**在 Rust 线程跑，不占 WebView 主线程/内存**；前端 `utils/thumbnail.ts` 有 Tauri 时优先调用、浏览器回退 canvas。另：`listRootFolders` 过滤非目录扩展名（stray `p-spider-subscriptions.json` 不再被当文件夹扫）；批量进度每 5 个推一次。⚠️ avif/heic 不支持 → 回退原图。
21. **本地库图片查看器自研（1.3.1）**：新增 `components/library/ImageViewer.tsx` 替代 antd 预览——无底部操作栏（缩放/旋转/重置进右键菜单）、滚轮缩放、**自由拖动不回弹**、**点击空白或图本身退出**（长图好退）、`Esc`、按右侧信息条 `rightInset` 让位居中、左右切换。`FileGrid.tsx` 抽出共用 `menuFor`、`LocalThumb` 网格不再挂 antd 预览。
22. **fig-memo 切换秒开（1.3.1）**：`Figmemo.tsx` 加会话级内存缓存 `itemsCache`（**仅在列表非空时写入**，避免初始 `[]` 被当缓存导致首次进一直「暂无文章」；3 分钟内切回直接用，5 分钟间隔后台静默刷新）；`buildItems` 本地封面扫描加会话缓存 `firstImageInCached`；`stores/figmemo-tags.ts` 批量标签方法改**无变化不写盘**（`syncSiteTags` 此前每次打开都触发 1MB 写）。
23. **图片切割 + 统一图片右键菜单（1.3.1）**：设置加「图片切割」区块（`settings.split`，settings version→3：方向 horizontal/vertical、条数 2–20 默认 4）。新增 `utils/image-menu.tsx` 统一四项菜单（复制图像 / 复制切割图像 / 打开本地储存位置 / 打开原网页，按可用性显示），接入本地库（网格+查看器）、fig-memo（列表卡+详情图）、时间流。切割走 `utils/split-image.ts`（本地/远程读字节 → canvas 切片 → 写 `appCacheDir/split-cache` 临时）→ Rust `copy_files_to_clipboard`（`clipboard-win` set_file_list / CF_HDROP）写文件列表，粘贴得 N 张图。⚠️ 网页剪贴板不支持多 ClipboardItem。

## 待办（下一步候选，按优先级）

1. `download.ts` 的 `if (source === 'figmemo')` 命名分支 → 抽「按源命名钩子」去泄漏
2. fig-memo 长列表虚拟滚动 / 封面 IntersectionObserver 懒加载（点标签卡顿已修：counts 线性化 + 详情页早退）
3. 站点改版风险：解析逻辑都在 `services/figmemo.ts`，失败只影响本功能
4. （历史遗留）下载层 errorCode 16 退避、缩略图/大文件体验、asset 桌面实测

## 关键文件

- `src/services/figmemo.ts`：抓取 / 建库 / 追新 / 元数据 / `syncSiteTags` / `setArticleTags` / `loadCachedSitePosts` / `refreshSitePosts` / 封面兜底
- `src/stores/figmemo.ts`：状态 + 24h 调度 + 统计监听（`main.tsx` 副作用常驻）
- `src/stores/figmemo-tags.ts`：标签树（含批量 `addTagsBatch`/`applyFolderTags`/`removeFolderTags`）
- `src/pages/Figmemo.tsx` + `src/components/figmemo/CategorySidebar.tsx`
- `src/utils/library/tags.ts`（`NON_COUNTING_TAG_ROOTS` / `folderManualTagIds`）、`src/utils/clipboard.ts`
- `src/pages/Settings.tsx`（fig-memo 区块）、`src/constants/routes.tsx`、`src/components/SideBar.tsx`

---

## 下个会话启动提示词（复制此段）

```
我在开发 P-Spider（fork 自 x-spider 的桌面下载器），仓库在 <项目路径>，
Tauri v1 + React18 + TS + Vite + Tailwind + antd5 + Zustand，当前版本 1.3.1（未发版）。
请先读 项目根目录的 DEVELOPMENT.md 和 HANDOFF.md 了解现状，再开始。

约定：
- 改完跑 pnpm typeCheck + npx eslint ./src（必要时 pnpm build）；除非我说“打包”，否则别 pnpm tauri build。
- 打包后把 P-Spider.exe / aria2c.exe / test-P-Spider_1.3.1_x64-setup.exe 拷到 <测试目录>（app 开着会被占用，需先退出）。
- git push 要走代理：git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin master。
- 别用 PowerShell 直接读写源码（破坏 UTF-8中文）；用 .NET [IO.File] + UTF8Encoding($false)。

当前进度见 HANDOFF.md「本轮已完成 / 待办」。我这轮要处理的问题是：<在这里写你的需求>
```
