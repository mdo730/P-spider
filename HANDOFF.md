# P-Spider 会话交接（HANDOFF）

> 用途：开新会话时把本项目状态快速交接给 AI。最后更新：2026-09-27

## 一句话现状

P-Spider（fork 自 x-spider）**v1.4.1 已发布（2026-09-27，GitHub Release `v1.4.1`）**。**1.4.1 修复/新增：** 未下载转贴视频**边下边播**（Rust 本地流式代理 media_proxy，仅 127.0.0.1、透传 Range、走应用代理）、本地库「打开本地储存位置」改为**选中文件**、图片切割可**附带作者/原帖**（文本+HTML 多格式）、文章详情保存按钮移到底部圆形、正文/标题**可选中** + 选中文字右键菜单、moeyo 补「Hpoi」搜索按钮、图片单独「保存到本地」（含 moeyo 正文内嵌图）、moeyo 图片 `001.jpg`/`001s.jpg` 重复修复、**GIF「下载即转真 gif」**（系统 ffmpeg）+ 时间流 GIF 会动、**本地文件删除后兜底**（按推文 ID 反查直链 + 远程经代理）。**1.4.0 新增：** ① **moeyo 来源**（moeyo.com，克隆 fig-memo：订阅追新/建库/列表分页详情保存/自动标签树/收藏/时间流记事；分类整备为 8 项 + 别名归并 + 事件独占；**去掉厂商标签**）；② **时间流大改**——接入 moeyo 记事、**未下载转贴进时间流**（默认关闭的订阅开关、按原创/hpoi 去重、可跳 app 内 fig-memo 正文）、视频应用内播放 + 右键「保存到本地」、本地视频缓存缩略图、**置顶为默认页**（原主页改名「X主页」）、滚动位置会话保持 + 右下角刷新/回顶、分类标注 + 头像；③ **订阅修复**：失败不再每秒无限重试（此前整晚锤爆 X → 403 空体/非 JSON）、检查限流（并发 4/200ms）、转贴更新接入、「文件夹」按钮修复；④ **内置 moeyo 站点(31k)+hpoi(21.5k) 种子**（首启秒开）；⑤ 性能修复（moeyo 点年份标签卡死：标签覆盖集改为只预计算一次）。更早：1.3.2 hpoi 候选匹配 + 数据种子；1.3.1 自研查看器/统一切割菜单/缩略图 Rust 化。

## 项目关键信息

- 路径：本仓库（git 仓库，分支 `master`）
- 技术栈：Tauri v1 + React18 + TS + Vite + Tailwind + antd5 + Zustand
- 版本：`1.4.1`（**已发布 2026-09-27**；`package.json` 与 `src-tauri/Cargo.toml` 同步）
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

## 已完成（1.3.0 ~ 1.4.0，v1.4.0 已发布 2026-09-27）

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
24. **fig-memo 详情「上一篇/下一篇」按筛选列表跳转（本轮）**：详情页顶栏加「上一篇 / 下一篇」按钮 + `当前/总数` 进度。进入文章时**快照**当时的筛选列表（`navList`）用于导航——仍保留详情页 `filtered` 早退（不打标/切文章时重算全量筛选），仅在点击文章时把当前 `filtered` 传入 `openPost(item, list)`；打标时同步 `navList` 里该文章的 `articleTags`；切文章自动回到详情顶部。这样「未打标签 + 年份-2026」筛完后逐篇打标时，打过的文章即使不再命中筛选也仍在快照里，`下一篇` 继续沿原顺序走。
25. **fig-memo 快捷标签墙 + 空格下一篇（本轮）**：详情右下角标签浮窗里，原「每分类一个 `Select mode=tags`」改成**可点 chip 标签墙**——候选标签铺成一排、点一下即打/取消（不用点开下拉再选），已选高亮带每分类计数；末尾保留「＋自定义」小输入（回车新建，落标签树后自动进候选）。**空格键 = 下一篇**（`Figmemo.tsx` 的 keydown 监听；输入框/按钮内不触发，chip 点击后主动 blur 防空格二次激活），`下一篇` 按钮加 `title` 提示。
26. **修复：退出「多标签」后标签筛选未清（本轮）**：`components/figmemo/CategorySidebar.tsx` 的「多标签」开关原逻辑在退出时把多选**收敛成最后一个标签**继续筛选，用户以为已退出却「筛选依旧生效」。改为**退出时清空 `tagIds`（回到全部）**，未打标签/收藏等其它条件保留；进入多标签时仍保留当前已选标签。
27. **fig-memo 详情「Hpoi 搜索」按钮（本轮）**：正文/标题解析出「商品名 + 厂商」，详情页顶栏加带 hpoi 图标的按钮，点击用系统浏览器打开**预填关键词的 hpoi 搜索页**（`https://www.hpoi.net/search?keyword=…&category=100`）。关键词解析 `buildHpoiKeyword`：优先标题 `厂商「商品名」…`，正文 `メーカー：`/`商品名：` 兜底。图标 `src/assets/platform-icons/hpoi.png`（取自站点 favicon）。⚠️ 不做自动匹配（hpoi 无 API、本地化改名严重，纯日文名直搜不可靠）；实测 5/5 能人工/半自动找到词条，故先给「预填搜索」这个零风险入口。
28. **hpoi 自动匹配评估结论：暂不做（本轮决定）**：试跑 30 条得出——按商品名搜 hpoi 仅 **43%**；按厂商扫目录 + `alternateName` 比对可达 **66.7%（上限 ~76.7%）**，hpoi 实际收录率 **80%**，高置信精度 100%。但成本扛不住：hpoi 手办分类实际 **~78,600 条**（详情全量 ≈34 小时），按厂商扫每篇要 **~65 请求**（2633 篇 ≈74 小时）。且 hpoi 列表的**厂商筛选是 JS 动态加载**（`workers=`/`company=` 直抓拿不到条目）。fig-memo 共 **2,633 篇**。结论：爬全量不现实也不必要，若以后要做应「fig-memo 驱动 + 按需匹配 + 永久缓存」，并先把单篇请求数压到个位数。**用户决定暂不做，只保留跳转按钮。**
29. **【后续突破】反编译 hpoi APK 挖到官方 JSON 接口（重要）**：用户提供 `E:\Downloads\base.apk`（包名 `net.hpoi`，43MB）。dex 里直接有完整 REST 路径清单，base = `https://www.hpoi.net/api/...`，**免登录、免签名**。核心 `GET /api/search?keyword=<kw>&page=1&pageSize=50` 返回 50 条/次，字段含：`name`/`name_ja`/`name_en`/`nameCN`/`aliases`（日文原名）、`companyName`/`companyId`（厂商）、`scale`（比例）、`rating`/`ratingScore`/`commentCount`（评分/评论数）、`textTags`（标签：黑丝/坐姿/御姐/巨乳…）、`workerName`/`workerJob`（原型/原画）、`detail`（简介）、`cover`、`releaseDate`。实测完整日文名直搜：样本 205592→`111926` 第 2 位、205536→`117305` 第 1 位。→ **成本从「~65 请求/篇」降到 1 请求/篇**，之前「爬 HTML、成本爆炸」的判断作废。其它接口：`api/hobby/query-v2`(POST)、`api/company/v2/get`、`api/person/get`、`api/charactar/get`、`api/works/get`、`api/comment/get` 等（详情接口正确参数待摸；`search` 已够用）。⚠️ hpoi `robots.txt` 有 `Disallow: /api/`，属灰色地带，需限速+缓存、勿高频全量。试跑脚本在 `%TEMP%\opencode\hpoi_apk\`。**待用户决定是否用 API 重跑 30 条 pilot / 落地功能。**
30. **hpoi API pilot 结果（30 条，对照人工真值）**：机制——`GET /api/search?keyword=<厂商>` 拿到 `companyId`；`POST /api/hobby/query-v2` **必须 form-urlencoded**（JSON body 被忽略），参数 `workers`(厂商id)/`category`/`page`/`pageSize`/`order` 生效，可拉厂商全部条目（JSON 字段同上）。结果：厂商解析 **30/30**；厂商目录（每厂商 ≤4 页 400 条）**目标在目录内 18/24 = 75%**（6 个厂商被 400 截断，放开会更高）；**naive 打分配对选对 14/24 = 58%**；6 个 hpoi 未收录的全被误报（需阈值拒识）。成本 **~3 请求/篇（冷），厂商目录按厂商缓存，热≈0**。瓶颈=**本地化改名**（如 APEX 的 205592 目标在目录第 105 位，但 hpoi `name` 为中文、无日文别名 → 名称相似度选不中；另有厂商 id 解析错的如「Lovely→良笑」）。提升方向：目录翻页到底 + 打分加「比例/发售年月/别名/词元重合」+ 阈值拒识 + 厂商 id 纠错 + 半自动 top-3 人工确认。脚本 `%TEMP%\opencode\hpoi_api\`。
31. **fig-memo 详情「Hpoi 候选关联」（本轮，半自动第一步，已实现）**：用户方案——打标时顺手确认（「半确认」，最后去掉 UI 只留数据；新文以后只查近期窗口）。新增：
    - `src/services/hpoi.ts`：hpoi JSON API 客户端 + `parseFigmemoFields`(标题`厂商「商品名」`/正文`メーカー：`/`商品名：`/`スケール：`) + `resolveCompanyId`（`/api/search` 按公司名相似度取 companyId，内存缓存）+ `findHpoiCandidates`（`query-v2` form `workers+keyword`，空则回退全站 `/api/search`，打分为名称 dice×60 + 厂商别名×30 + 比例×10，取 top-3）。
    - `src/components/figmemo/HpoiMatchPanel.tsx`：详情页**右上角悬浮卡片**，列 top-3（封面/中文名/厂商/比例/评价），点一下关联；已关联显示快照（封面/名称/厂商/比例/评价/评论/`textTags` 标签）+「在 Hpoi 打开 / 解除关联」；含「重新查询」「收起」。
    - `services/figmemo.ts`：`FigmemoMeta`/`FigmemoListItem` 加 `hpoi?: HpoiMatch`；新增 `setHpoiMatch`（写/清 `figmemo.jsonl` 的 `hpoi` 字段）；`buildItems`/`listLocalPosts` 带上 `hpoi`。
    - `hooks/useRemoteImage.ts`：加可选 `{ bypassProxy, headers }`（hpoi 封面走直连 + `Referer: https://www.hpoi.net/` 破防盗链）。
    - `pages/Figmemo.tsx`：渲染面板 + `applyHpoiMatch`（确认/解除，同步 `selected`/`items`/`navList` 并落盘）。
    - 30 条实测**预期 top1 62% / top3 71%**（本地化改名、厂商 id 解析是主要失手点；未命中可用顶部「Hpoi」搜索按钮手动兜底）。⚠️ **需 `pnpm tauri dev` 桌面实测**（浏览器预览无 `window.__TAURI__`，IPC 与代理不可用）。
32. **Hpoi 手动校正 + 关键发现（本轮）**：① 面板底部加「**手动校正**」按钮（`重新查询` 右侧）→ 贴 hpoi 链接或 id → `parseHpoiId` 解析 → `fetchHpoiItemById` 拉取并关联；② **关键发现**：`/api/search`、`query-v2` 列表结果**不含 `alternateName`**（所以自动匹配对本地化条目选不中），但**详情页 HTML 的 JSON-LD `Product` 有 `alternateName`（含日文原名）+ 准确 `aggregateRating`**；且**必须用浏览器 UA** 抓页面（`hpoi/android` 会被降级成无 JSON-LD 的精简页，仅 45KB）。`fetchHpoiItemById` 用浏览器 UA 抓 `/hobby/<id>` → 解析 JSON-LD → nameCN/name(日文别名)/manufacturer/比例/评分(ratingValue)/评分人数(ratingCount)/封面/发售。确认候选时也改走它（拉详情取准确数据，失败回退列表数据）。→ **后续提升自动命中的方向**：对 top 候选再抓详情 JSON-LD 用 `alternateName` 复核。另：确认按钮不再用列表的 `rating`（那是评分总分，非均分），改显示 JSON-LD 的 `★评分 (人数评)`。
33. **hpoi 候选逻辑调优评估（用用户手动确认的 20 篇作真值）**：读 `%APPDATA%\p-spider\figmemo.jsonl` 得 20 条真值。结论——启发式已到**天花板**：列表打分（名称 dice×60 + 厂商别名×30 + 比例×10）**top1 9/20、top3 11/20、top5 12/20**；试过并**否决**：搜索排名当先验（更差）、详情 `alternateName` 重排前 8/前 20（top3 11→10，且抓 334 次详情无益）、纯搜索顺序、公司优先、厂商全目录（检索 15/20 但打分仍选不中）。根因：`query-v2`/`search` **列表数据无日文别名**，本地化（メアリー→梅里等）使名称相似度失效；厂商名搜索解析 companyId 也不可靠（Lovely→良笑、CAMELOT/VIOLET STUDIO/KURO GAMES 直解失败）。**已采纳的低成本改进**：① `findHpoiCandidates` **始终并入 `/api/search`**（检索 12→14/20，因 search 索引了 alternateName）；② **比例硬过滤**（用户提议）：fig-memo 与 hpoi 都有比例且不一致的直接剔除（0/缺失视为未知保留），列表更干净；③ **「2+1」候选**（用户定案）：每批 = **2 条 hpoi 网站搜索页**（`/search?keyword=<商品名 厂商>&category=100`，服务端渲染，**排序与浏览器一致**；注意它和 `/api/search` 是**两套不同排序**，API 常完全不对）+ **1 条自研匹配**（厂商目录+`/api/search` 打分 top1，比例硬过滤）；`searchHpoiWeb` 抓 HTML 解析 id/名称/封面/厂商。④「**重新查询**」= 排除当前已显示候选 id 再取下一批（网页 +2、自研 +1 各自前进）。⑤「**默认自动匹配第一条**」：文章首次打开、初始批次、且尚未关联时，面板**自动关联候选第一条**（省点击）；错了用「**重新检索**」（`autoRef=true` + `onClear`）再手动挑。用户手动挑，优先「目标可见」。**未采纳**：详情重排（净负收益）、权重调整/厂商硬过滤（无增益）。手动校正仍是可靠兜底。评估脚本 `%TEMP%\opencode\hpoi_api\pilot*.py`。
34. **离线批量匹配（本轮）**：用户要求「后台分批跑一遍」，无需逐篇打开。脚本 `%TEMP%\opencode\hpoi_api\batch_match.py`（可续跑，每 25 篇原子落盘，进度 `batch_progress.json`，日志 `batch.log`）。逻辑=应用内默认匹配的一致版本：`title` 解析 `厂商「商品名」` → 关键词 `商品名 厂商` → **hpoi 网站搜索页第一条**（空则 `/api/search` 第一条）→ 抓详情 JSON-LD 生成快照 → 写入 `figmemo.jsonl` 的 `hpoi`（**已有 hpoi 不覆盖**；无记录的站点文章补建记录）。**结果：2633 篇全部有 hpoi**（约 1 小时，回填 2592 篇，0 未命中），备份 `figmemo.jsonl.bak-batchmatch`。⚠️ 批量结果只是「网页第一条」，错误靠用户在应用内「重新检索」纠正。
35. **修复：比例解析取到分子（本轮）**：App `fetchHpoiItemById` 的 `比例` 正则 `([0-9]+...)` 会把 `1/6` 解析成 `1`（取分子）；改为 `(?:[0-9]+\s*[/／]\s*)?([0-9]+(?:\.[0-9]+)?)` 取分母，`parseScale` 同步兼容全角 `/／`。已用 `patch_scale.py` 回填此前 42 条错误 `scale=1` 的记录（备份 `figmemo.jsonl.bak-scalefix`）。
36. **fig-memo 列表排序 + 评分显示（本轮）**：列表工具栏加排序下拉（`Figmemo.tsx` 组件内 state，未持久化）：**日期 新→旧 / 旧→新、Hpoi 评分 高→低 / 低→高**（无评分的排最后；评分并列按日期倒序）。列表卡片 meta 行加 `★评分`（`item.hpoi.rating`）。数据来自批量写入的 `hpoi` 快照。
37. **hpoi 匹配只做白名单分类（本轮）**：`services/hpoi.ts` 加 `HPOI_MATCH_CATEGORY_IDS = [16,140,364]`（フィギュアレビュー / レビュー(R18) / 予約開始情報）；`Figmemo.tsx` 详情页**仅当文章分类命中白名单才渲染 hpoi 候选面板**（其余分类不自动匹配、不请求）。已用 `cleanup_cat.py` 移除其余分类（イベント/イベントR18/セール 共 65 篇）的 `hpoi` 字段（备份 `figmemo.jsonl.bak-catclean`），保留 2568 篇。
38. **评分语义修复 + hpoi 绑定数据内置进软件（本轮）**：① 「★305」问题——列表接口 `/api/search` 的 `rating` 是**评分总分/人数**（≠均分），应用内详情抓取失败走回退时把它存进了 `hpoi.rating`；修正 `toCandidate` 候选阶段不再带 `rating/commentCount`（确认时只用详情 JSON-LD 的真实均分），并回填 2 条脏数据（117305→4.3、134338→4.38，备份 `.bak-ratingfix`）。② **内置种子**：把 2568 条绑定导出为 `src/data/hpoi-matches.json`（733KB），`figmemo.ts` **读时注入**（`resolveHpoi`：本地 `hpoi` 优先 → 否则内置种子 → 除非记录有 `hpoiRemoved`）。用户「解除关联」会写 `hpoiRemoved:true`，**不会被种子复活**；新装/清数据后也能直接有匹配。代价：前端包 1.60MB→2.16MB（gzip 511→734KB）。
39. **修复 fig-memo 加载失败（XSERVER WAF，本轮）**：日志显示 `expected value at line 1 column 1`（收到非 JSON）反复重试——**XSERVER WAF 把 `/wp-json/` 路径 403 了**（首页 200、`/wp-json/` 全 403，与代理/节点/UA 无关；换 Clash 节点无效）。修复：`services/figmemo.ts` 把 API 前缀 `…/wp-json/wp/v2` 改为 **`…/?rest_route=/wp/v2`**（WordPress 的 rest_route 查询形式，WAF 不拦），UA 换成完整浏览器 UA。实测分类/详情/媒体三条路径经代理均 200。⚠️ 以后若站点再被 WAF 拦，优先想 `?rest_route=` 这类绕过。
40. **修复「未下载显示 0 图」（本轮）**：`figmemo.ts` 新增 `folderImageInfoCached`（一次 readDir 得本地首图+图片数，会话缓存），`buildItems`/`listLocalPosts` 对**已下载**用**本地实际图片数**；`Figmemo.tsx` 卡片**只在 `imageCount>0` 时显示「· N 图」**（未知不显示，不再误导）；`openPost` 对**未下载**文章拉取图片后也 `upsertMetaImageCount` 落库（逐步补全）。→ 未下载未打开过的文章仍无数字（可另跑离线批量补，见待办）。
41. **离线补图片数 + 文章数据内置进软件（本轮）**：① 脚本 `imgcount.py` 逐篇 `?rest_route=/wp/v2/media&parent=<id>&per_page=1` 读 `X-WP-Total` 得图片数（媒体接口不返回 `parent`，只能按 parent 查），补全 **806 篇**（`figmemo.jsonl` 备份 `.bak-imgcount`；现 2252 篇有 imageCount）。② 生成 `src/data/figmemo-meta-seed.json`（2252 条 / 555KB：title/date/link/categoryIds/imageCount/articleTags），`readMetaRecords` **合并种子**（补 imageCount/articleTags；本地缺失补建合成记录）——新装/清数据后文章列表与标签也在。加上 hpoi 种子，前端包约 2.16MB→2.7MB。
42. **fig-memo 卡片缩略图右下角三个小角标（本轮）**：同一行 `w-4 h-4` 圆点——**已下载**（sky 蓝 + 白勾 `CheckOutlined`）、**已收藏**（rose 红 + 白心 `HeartFilled`）、**已打标签**（slate 灰 + 白 `TagOutlined`，判定 `Object.keys(item.articleTags||{}).length>0`）。条件渲染、带 `title` 提示。
43. **站点数据内置、用户手标标签不内置（本轮）**：用户要求「可推导/共享」的随包走、**个人手标文章标签**不带。① 新增 `src/data/figmemo-site-seed.json`（整份站点缓存 854KB：posts/categories/featured/postCovers）；`readSiteCache` 本地无缓存时写入并返回 → **新用户首启秒开/离线可用**，厂商/分类/年份三类标签由 `syncSiteTags` 立即生成，随后照常增量刷新。② `figmemo-meta-seed.json` 改为**只含 imageCount**（2253 条/60KB，去掉 title/articleTags）；`readMetaRecords` 只合并 imageCount。用户手标标签仅存本地 `figmemo.jsonl`。种子共约 hpoi 733KB + site 854KB + meta 60KB ≈ 1.6MB。
44. **修复「非 JSON 响应」长时间退避卡顿（本轮）**：主页解析卡好久——日志见 X `UserByScreenName` 返回非 JSON（`error decoding response body: expected value at line 1 column 1`），`ipc/network.ts` 原逻辑**退避重试 16 次**（100ms→…→16s，累计 ~2.5 分钟）。现改为：**响应解码失败（非 JSON）立即抛出、不再重试**（网络类错误仍照常重试）。同会话 17:44 该接口还成功 455 次、18:22 起全失败 → 属外部条件变化（**登录态/Cookie 失效、被限流、或代理节点对 x.com API 失效**），建议重新登录刷新 Cookie / 换节点。⚠️ 之后若日志出现 `Response is not JSON, abort retry` 即是此类。
45. **时间流纳入「未下载新记事」（本轮）**：此前时间流只读 `downloads.jsonl`（未下载不进）。现：① `services/figmemo.ts` 导出 `getRecentSiteNotes(days)`（近 N 天站点文章，含未下载，带封面）；② `Timeline.tsx` 合并下载组 + 记事组（**仅当对应功能开关开启**；fig-memo 已接，moeyo 待接），记事 `kind:'note'` 显示来源/标题/封面；③ **「查看正文」按钮**：记事 **以及已下载的 fig-memo 条目**（`platform==='figmemo'`）都显示，点击 `openArticle(page,postId)` **跳转 app 内正文**（`stores/route.ts` 的 `pendingArticle`，`Figmemo.tsx` 消费）；④ 设置新增「**时间流**」区块（settings version→4）：**正文最大展示字数**（默认 200，超出折叠）、**单条最大展示图片数**（默认 6，超出折叠）。⚠️ 记事正文目前用标题（站点缓存无正文），后续可补 excerpt。
46. **fig-memo 列表分页 + 状态保持（本轮）**：① **分页**取代无限滚动：每页 `PAGE_SIZE=60`，底部 antd `Pagination`（`showQuickJumper` 可跳页），**检索结果同样分页**；筛选/搜索/排序变化回到第 1 页。② **返回保持**：进详情再返回，**保留所在页 + 滚动位置**（`listScrollRef` + `listUiCache.scrollTop`）。③ **切标签页保持**：`listUiCache`（模块级会话缓存）记住 `filter/keyword/sort/page/scrollTop`；另 `openArticleCache` 记住**正在看的文章**（item/detail/images/localImages/navList），切到设置再切回 **连文章一起原样恢复**（不重拉；「返回列表」或时间流跳转时清空/覆盖）。④ 资源：**未保留组件挂载**，只缓存标量 + 当前文章数据 → 额外内存可忽略（列表 `itemsCache` 本就常驻）。
47. **新增 moeyo 来源（1.4.0，本轮）**：以 fig-memo 为模板克隆出 **moeyo（moeyo.com，WordPress）**：`services/moeyo.ts`、`stores/moeyo.ts`、`stores/moeyo-tags.ts`、`stores/moeyo-favorites.ts`、`pages/Moeyo.tsx`、`components/moeyo/CategorySidebar.tsx`。**保留**：分类订阅（24h 追新）/建库/刷新、列表分页与状态保持、详情/图片（本地优先）/保存、自动标签树（**分类/厂商/年份**）、收藏、时间流新记事。**去掉**：文章级手动打标、Hpoi 匹配。API 同 fig-memo 用 `?rest_route=/wp/v2/...`（moeyo 的 `/wp-json/` 也被 XSERVER WAF 拦）。数据文件：`moeyo.jsonl`/`moeyo-state.json`/`moeyo-tags.json`/`moeyo-favorites.json`/`moeyo-site.json`。平台层 `PlatformSource` 加 `moeyo`（`PlatformBadge` 图标 `src/assets/platform-icons/moeyo.png`、下载命名/Referer 兼容）。设置页加「moeyo」区块；路由/侧栏按 `useMoeyoStore(featureEnabled)` 显隐；`main.tsx` 副作用 import 启动调度。⚠️ **moeyo 全站 5w+ 篇 → 首次快照/建库按时间倒序只取最近 `MAX_SNAPSHOT_PAGES=60` 页（≈6000 篇）**，避免拉爆。统计页暂未加 moeyo 独立项（待办）。
48. **moeyo 分类整干净（1.4.0 补丁）**：moeyo 共 **519 个分类**，绝大多数是 `イベント` 下的**具体展会子类**，导致「分类」标签树满屏展会名。修：`fetchCategories` **翻页取全**并只保留**顶层分类**（`parent=0`）且 `count >= 100`、排除含「人気記事/限定」的，得到 **ニュース / フィギュア / イベント / ホビー・模型・プラモ / コスプレ / その他**；`syncSiteTags` 末尾**清理「分类」根下已不在该集合的旧标签**。设置里的「分类订阅」列表也只剩这几个。
49. **moeyo 去掉「厂商」标签（1.4.0 补丁）**：moeyo 标题没有 `厂商「…」` 这种稳定格式，`guessManufacturer`（取 `「` 前缀）产生 **1349 个垃圾厂商标签**（如「コトブキヤ新作美少女フィギュア」「【アダルトフィギュア】」「【WF2026冬】…」）。修：**moeyo 不再生成「厂商」**（保留 分类/年份），`syncSiteTags` 顺带**自动删除遗留的「厂商」根**；并手动清理了 `moeyo-tags.json`（移除 1350 个标签，备份 `.bak-catfix`），现只剩根 `moeyo`(分类) + `年份`。
50. **moeyo 分类改层级树（1.4.0 补丁，用户发现）**：`サンプルレビュー`(id 1611, **2.3 万篇**) 其实是 **`フィギュア`(1601) 的子分类**——之前「只留顶层」把它误杀了（它才是 moeyo 最大分类）。真实树：`フィギュア` → `サンプルレビュー`/`製品版レビュー`/`アキバ新発売`/`ドール`；乱的是 `イベント(1612) → その他イベント(7027) → 498 个具体展会`。修：`fetchCategories` **保留深度 ≤1** 的分类（顶层+一层子类），砍掉更深的展会；`syncSiteTags` 按分类树**建层级标签**（父分类的标签作父级，无父则挂「分类」根），文章按各分类 id 挂到对应标签；清理「分类」子树里过期标签。设置里的分类订阅列表也变成层级（约 33 项）。⚠️ 另发现 moeyo 文章正文含 `■ 商品名：`/`■ 発売元：`/`■ サイズ：`/`■ 原型制作：` 等**结构化字段**（如 article/166208），将来可据此做**可靠的「厂商」**（从 `発売元` 提）+ 尺寸。
51. **moeyo 目标分类：正文提字段 → 厂商标签 + Hpoi 匹配（1.4.0 补丁）**：仅对 **`サンプルレビュー`(1611) / `製品版レビュー`(1588)** 两分类（正文稳定带字段）做：① 刷新时对这两类文章**批量拉正文**，解析 **`発売元`→厂商** 存入站点缓存 `makers`（`extractMakerFromHtml`）；`syncSiteTags` 据此重建 **「厂商」根**（并清理过期厂商标签）。② `parseMoeyoProduct(title, html)` 从 `商品名`/`発売元`/`サイズ` 取值；**Hpoi 候选面板**接入 moeyo 详情页（仅这两分类显示，`MOEYO_HPOI_CATEGORY_IDS`），`HpoiMatchPanel` 新增 `parse` 参数（fig-memo 用默认，moeyo 传 `parseMoeyoProduct`）。moeyo 侧加回 `hpoi`（meta/item/`setHpoiMatch`）。⚠️ 首次刷新会为这两类（数量大）批量拉正文，约 60 批请求，之后缓存增量。
52. **修复 moeyo 详情图片为 0（1.4.0 补丁）**：moeyo **不在 `media` 里挂图**（`/media?parent=` 恒 0），图片是**正文内联 `<img src="https://moeyo.com/image/…/00Ns.jpg">`**（`s` 与不带 `s` 同图）。而克隆来的 `fetchContentImages` 正则域名残留成 `moeyo-r18.site/wp-content/uploads` → 解析不到 → 详情 0 图。修：`fetchPostImages` 直接解析正文（不再查 media）；正则改 `moeyo.com/(image|wp-content/uploads)/`；跳过列表 `thumbnail.*`。
53. **moeyo 分类再精简 + 深层事件保留（1.4.0 补丁，用户反馈）**：用户指出 `article/166337` 应属 `メガホビEXPO2026`（它是 `イベント → メガホビEXPO(21108) → メガホビEXPO2026(26410)` 的**三级**子类）——之前「深度≤1」把它砍了。改为：**只保留白名单 6 个主分类（ニュース/フィギュア/イベント/ホビー・模型・プラモ/コスプレ/その他）及其任意深度子类，排除「人気記事/限定/その他イベント」链**（去掉那棵 498 展会毒瘤）。`syncSiteTags` 分类建树改**按深度排序通用嵌套**（不再只两级）。`fetchCategories` 同规则。另：列表封面回退用轻量 `thumbnail.jpg`（此前改成跳过 thumbnail 会让卡片加载大图更卡）。用户本地 `moeyo-tags.json` 已重置（`.bak-reset2`），下次打开重建。
54. **moeyo 分类定为「最精简 8 项」+ 别名归并 + 修持久化损坏（1.4.0 补丁）**：① 粒度定案=最精简：**分类 = 6 主分类 + サンプルレビュー(1611) + 製品版レビュー(1588)**；其余分类经 **`categoryAlias`**（任意分类 id → 最近保留祖先）归并（メガホビEXPO2026 → イベント，アキバ新発売/ドール → フィギュア）。`fetchCategories` 返回 `{cats, alias}`；别名随站点缓存持久化（`MoeyoSiteCache.categoryAlias`），`syncSiteTags` 按别名把文章挂到保留分类。② **真正根因（「改了还是不对」）**：`zustand persist` 多次 `set` **并发写同一文件**，`tauri-file-storage` 直接覆盖 → `moeyo-tags.json` 被写成**两份 JSON 拼接**（`Extra data`）。修 `tauri-file-storage.ts`：**每 store 写队列串行化 + 临时文件原子替换**（全局修复）；`syncSiteTags` 分类建树**按层批量写**。③ 用户本地 `moeyo-site.json` 离线改为 8 分类 + 503 条 alias、`moeyo-tags.json` 清空（备份 `.bak-8`），下次打开即得：分类(6 主 + フィギュア›サンプル/製品版レビュー) + 厂商 + 年份；`166337` → イベント + サンプルレビュー。
55. **moeyo 事件文章移出レビュー + 卡顿优化（1.4.0 补丁）**：① `166366` 等 `[メガホビEXPO2026, サンプルレビュー]` 双分类文章，在 `syncSiteTags` 里**若命中「イベント」分类则不再挂 `サンプル/製品版レビュー`**（`REVIEW_CATEGORY_NAMES`），故事件报道只在「イベント」下、不再混进レビュー。② 卡顿：侧栏「厂商」曾达 **1484** 个标签，展开 Tree 直接卡死 → **只保留出现 ≥2 篇的厂商**（`mfrCount`）+ **`Tree virtual height`**（`CategorySidebar` 用 ResizeObserver 量高度、虚拟滚动）。本地 `moeyo-tags.json` 清空（`.bak-ev`）待重建。
56. **moeyo 分类再取舍 + 正文保留原格式（1.4.0 补丁）**：① **去掉 `コスプレ` 分类**（基本空/不准）→ 保留 **7 项**；② 分类改为**优先级独占**：一篇文章只挂**最高优先**的一类 —— **イベント > レビュー > 其它**（如 `150211` → 只 サンプルレビュー；`166366` → 只 イベント）。③ **正文保留原格式**：`fetchPostDetail` 不再删 `a/img/figure`（只清 `script/style/注释`）→ 图片/带超链接的文字都回来；`Moeyo.tsx` 正文容器**拦截 `<a>` 点击用浏览器打开**；补 `.moeyo-article` 样式与 `.moeyo-pop` 动画。
57. **修复 moeyo 标签关系「只增不减」+ 新增プレスリリース分类（1.4.0 补丁）**：① **根因**：`syncSiteTags` 的 `applyFolderTags` **只加 paths、从不删** → 改规则后旧路径（如 `166362` 仍在サンプルレビュー）永远残留。修：同步前**先清空所有标签的 `paths`，再重建**。② 用户发现 **`プレスリリース`(2548, `/category/news/release`, 既有 3739 篇)** 正文也稳定带 `商品名/発売元/サイズ`（抽样 8/8）→ **加为独立保留分类**并纳入 **hpoi 适配**（`MOEYO_HPOI_CATEGORY_IDS = [1611,1588,2548]`，`REVIEW_CATEGORY_NAMES` 同步加）→ 现分类 **8 项**。本地缓存 alias 重算、标签清空待重建。

58. **时间流置顶为默认页 + 主页改名（1.4.0）**：`constants/routes.tsx` 把「时间流」移到数组首位（默认路由 = `ROUTES[0]`，`route.ts` 用 `getRouteFromHash() || ROUTES[0]`），原「主页」改名 **「X主页」**（路由 id 仍 `home`，作者跳转等不受影响）。
59. **时间流「未下载转贴」（1.4.0）**：订阅加 `includeRetweets`（默认关，**仅进时间流不下载**）；`twitter/api.ts` 加 `getUserRetweets`（走 UserTweets hash、**不过滤转贴**、从 `retweeted_status_result` 取原创媒体，优先 `extended_entities`）；`services/retweets.ts` 存 `retweets.jsonl`（**按原创推文 id 去重**、多人转合并 `retweetedBy`、保留 30 天）；时间流新增 `kind:'retweet'`——原作者可点 → **app 内主页**（`loadUser`，那页有订阅按钮）、小字「转推自 @x」、直接「订阅原作者」按钮；去重三档（原创 id / 原作者已订阅则跳过 / 与已下载按 postId 去重）。
60. **时间流状态保持 + 右下角按钮（1.4.0）**：会话缓存（列表 + 已加载条数 + **滚动位置**，挂载先用缓存秒显、**同时后台重新聚合**以反映新内容）；右下角两个圆形按钮：**刷新**（先 `checkAll` 更新订阅/转贴再聚合）、**回到顶部**。
61. **时间流媒体适配（1.4.0）**：视频/GIF 点击**应用内弹窗播放**（本地 `toAssetUrl` mp4 / 转贴用远程 `videoUrl` 流式）；右键加「**保存到本地**」（图片/视频都有，走正常下载管线）；本地视频用**缓存缩略图**（`utils/thumbnail.ts` 新增 `generateVideoThumbUrl`：WebView 解一帧→canvas→存 `thumb-cache`，`LocalThumb` 加 `kind="video"`；本地库 `FileGrid` 网格也从内联 `<video>` 换成缓存缩略图）。
62. **时间流分类标注 + 头像（1.4.0）**：fig-memo/moeyo 条目标注**分类标签**（新记事 + 已下载，`getSiteCategoryMap` 回填）；**头像**——下载/转贴用真人，网页来源（fig-memo/moeyo）用其**平台图标**。
63. **设置新增（1.4.0）**：时间流「**保留天数**」（1~30 默认 7，替换写死的 7 天）；moeyo 区块加「**进「时间流的分类**」多选白名单（`settings.timeline.moeyoCategoryIds`，**全不选 = 都不进**）；「parukamun 自用订阅」标题规范化改为「fig-memo」。
64. **moeyo 去厂商标签 + 性能（1.4.0）**：`syncSiteTags` 不再生成「厂商」根/子（448 个太卡）并清历史遗留；**停掉为提厂商而做的正文批量抓取**；新增 `ensureTagsSynced` —— **站点缓存未变就跳过标签树重建**（原每次进 moeyo 遍历 3 万篇重建）。
65. **moeyo 内置种子（1.4.0）**：`src/data/moeyo-site-seed.json`（**31083 篇**清单 + 分类/别名/封面）+ `src/data/moeyo-hpoi.json`（**21581 条** hpoi 匹配）；`readSiteCache` 本地无缓存用种子、本地比种子旧/少则**一次性并集合并（种子为准，含 id 修正为字符串）**；hpoi 用 `resolveHpoi` 回退种子。首启秒开。
66. **订阅修复 + 提速（1.4.0）**：① 失败也写 `lastCheckedAt`（原失败不写 → 调度器每秒判定「从未检查」→ **整晚无限重试把 X 锤成 403 空体/非 JSON**）；② 出错订阅重试间隔 `ERROR_RETRY_MS=5min`；③ 检查**限流**并发 4 / 间隔 200ms + 全局闸门（手动与定时不叠加）；④ 时间流「刷新」接入 `checkAll`（转贴随之更新）；⑤ 订阅「文件夹」按钮取值形状修复（`post.creator.name`，原写 `post.user.name` → 解析成 `undefined` 打不开）。
67. **性能修复：moeyo 点年份标签卡死（1.4.0）**：`Moeyo.tsx` 的 `filtered` 原对**每条**文章调 `matchesFilter`（内部每条都重算 `tagCoveredSet`，年份 2014 有 1430 条 → 3 万 × 1430 ≈ 千万级）→ 卡死。改为**每个选中标签的覆盖集只预计算一次**，逐条仅做 Set 查询。
68. **moeyo hpoi 离线全量匹配（1.4.0）**：三分类（サンプル/製品版/プレスリリース）**29083 篇全量**跑 hpoi（命中 **21581**，对应 **11528** 个词条；事件类 7065 篇无单一商品跳过）。脚本与数据在仓库外 `E:\OPENCODE\moeyo-batch\`（`run-match.cmd` 带实时进度条、断点续跑）。

69. **Rust 本地流式媒体代理（1.4.1）**：`src-tauri/src/media_proxy.rs`（`tiny_http`，仅 `127.0.0.1:随机端口`，`/media?u=<url>&p=<proxy>` 转发、**透传 Range**、走应用代理）；命令 `media_proxy_port`；前端 `utils/media-proxy.ts`（`ensureMediaProxy`/`mediaProxyUrl`）、`hooks/useRemoteVideo.ts`。解决未下载转贴视频 `<video>` 走不到代理的黑屏 → **边下边播/可拖动**。
70. **时间流本地文件删除兜底（1.4.1）**：`getTimelineGroups` 探测 `existsLocal`；记录新增 `videoUrl`（下载直链）；本地删了 → 按「未下载」处理（右键转远程、图片经代理显示）；视频/GIF 无直链时 **`services/tweet-media.ts` 按「用户名+推文ID」反查媒体流取 mp4**（自动 + 点击）。
71. **GIF（1.4.1）**：设置「下载 → GIF 转真实 gif」（默认关，系统 ffmpeg）→ 下载完转 `.gif` 替换 mp4；时间流 GIF 本地 `.gif` 用 `<img>`（会动）、本地 mp4/远程用无控件自动循环 `<video>`；同图 `001.jpg`/`001s.jpg` 去重；`dedupeMediaRecords` 折叠重复记录。
72. **图片切割附带来源（1.4.1）**：`settings.split.appendSourceInfo`（默认关）；开启后剪贴板含 文件列表 + 文本 + **CF_HTML**（内联图片+文本）；`copy_files_to_clipboard(paths,text,html)` 用 `set_without_clear` 多格式；切片编码改 JPEG（更快）。
73. **正文/标题可选中 + 选中文字菜单（1.4.1）**：`<article>` 加 `select-text`；`hooks/useTextSelectionMenu.tsx`（复制/全选/用选中文字搜索 Hpoi/打开链接）。
74. **moeyo 详情图片集合（1.4.1）**：原来「本地有图就只显示本地」→ 改为**以远程全量列表为准、本地命中用本地**（按归一化文件名匹配）；正文内嵌图右键菜单；`Hpoi` 搜索按钮补上。
75. **本地库「打开本地储存位置」（1.4.1）**：`image-menu` 的 reveal 改 `showInFolder(path, true)`（选中文件，原会用默认程序打开文件）。
76. **文章详情保存按钮（1.4.1）**：从顶栏移到右下角圆形按钮（收藏下方），不再被 Hpoi 面板遮挡。

## 待办（下一步候选，按优先级）

1. `download.ts` 的 `if (source === 'figmemo')` 命名分支 → 抽「按源命名钩子」去泄漏
2. fig-memo 长列表虚拟滚动 / 封面懒加载（点标签卡顿、切换慢已修；首次进仍一次性渲染 ~1688 卡）
3. 崩溃/强杀后残留 `aria2c.exe` + 端口占用不会自动清理（可加启动检测/清理或提示）
4. 站点改版风险：解析逻辑都在 `services/figmemo.ts`，失败只影响本功能
5. （历史遗留）下载层 errorCode 16 退避、缩略图/大文件体验、asset 桌面实测

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
Tauri v1 + React18 + TS + Vite + Tailwind + antd5 + Zustand，当前版本 1.4.1（已发布）。
请先读 项目根目录的 DEVELOPMENT.md 和 HANDOFF.md 了解现状，再开始。

约定：
- 改完跑 pnpm typeCheck + npx eslint ./src（必要时 pnpm build）；除非我说“打包”，否则别 pnpm tauri build。
- 打包后把 P-Spider.exe / aria2c.exe / P-Spider_1.4.1_x64-setup.exe 拷到 <测试目录>（app 开着会被占用，需先退出）。
- git push 要走代理：git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin master；发 Release 前设 $env:HTTPS_PROXY='http://127.0.0.1:7897' 再用 gh。
- 别用 PowerShell 直接读写源码（破坏 UTF-8中文）；用 .NET [IO.File] + UTF8Encoding($false)。
- 用户数据（标签/收藏/订阅/历史/设置）都在 %APPDATA%\p-spider\，仓库里不放任何数据文件。

当前进度见 HANDOFF.md「已完成 / 待办」，发布流程见 DEVELOPMENT.md「如何发布新版」。我这轮要处理的问题是：<在这里写你的需求>
```
