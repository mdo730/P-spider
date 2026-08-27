# P-Spider 项目维护说明

> 本项目 fork 自 `MiningCattiva/x-spider`（GPL-3.0），改名 P-Spider，并新增了订阅、统计、时间流等自定义功能。

## 常用命令

```bash
pnpm install           # 安装前端依赖
pnpm dev               # 启动 vite（浏览器预览，依赖 Tauri 的功能不可用）
pnpm typeCheck         # TypeScript 类型检查（改动后必跑）
pnpm build             # 前端构建（tsc + vite build）
pnpm tauri dev         # 桌面开发模式（需要 Rust + MSVC）
pnpm tauri build       # 打包（生成 exe + NSIS 安装包）
pnpm lint              # prettier + eslint
```

## 改动后必做的验证

1. `pnpm typeCheck` — 无类型错误
2. `npx eslint ./src` — 无 lint 错误
3. `pnpm build` — 前端构建通过
4. 需要打包时 `pnpm tauri build`，产物在 `src-tauri/target/release/`

## ⚠️ 打包节奏（重要约定）

- **除非用户明确要求打包，否则不主动打包**。只改代码 + 跑 typeCheck/eslint 验证即可。
- 用户会一次性提完所有要改的功能，攒够再打包。**不要每改一处就打一次包**。
- 用户没提"打包"时，所有改动停留在代码层面，等用户说打包才执行 `pnpm tauri build`。

## 打包与环境注意

- **Rust 工具链**：`cargo`/`rustc` 1.98+，MSVC 构建工具
- **cargo 代理**：`~/.cargo/config.toml` 配置了 `http.proxy = 127.0.0.1:7897`，直连 crates.io 很慢
- **reqwest 依赖**：原版依赖作者 fork 的 GitHub reqwest（仓库已删除），已改用 crates.io 官方版 + `winreg` 读系统代理
- **侧车 aria2c**：`Command.sidecar('binaries/aria2c')` 运行时在 **exe 同目录**找 `aria2c.exe`（绿色版 exe + aria2c.exe 必须同目录）
- **打包图标**：用 `pnpm tauri icon <源图>` 重新生成全套，改图标后必须重新打包才生效

## 关键约定

- **浏览器预览判断**：`useBootstrap.ts` 用 `'__TAURI__' in window || '__TAURI_INTERNALS__' in window` 判断是否 Tauri 环境。Tauri v1 注入 `window.__TAURI__`，v2 注入 `__TAURI_INTERNALS__`。不要只用其中一个，否则桌面版会被误判为浏览器而跳过 aria2 启动（曾因此踩坑）
- **aria2 端口**：P-Spider 用 **6802**（原版 x-spider 用 6801），避免与 x-spider 同时运行冲突
- **数据存储**：`%APPDATA%\p-spider\` 下，`settings.json`、`app-state.json`（含 cookie）、`subscriptions.json`（订阅+统计）、`downloads.jsonl`（下载历史，时间流数据源）
- **GPL-3.0**：保留原 LICENSE，分发需附源码

## 临时/实验代码清理

- 曾加过浏览器预览假数据注入（已移除）
- 动态页（HomeTimeline 刷推）曾调研后放弃——HomeTimeline 的 GraphQL hash 硬编码在 X 混淆 JS 里且频繁变化，第三方库维护的 hash 也易失效，不稳定，故不做