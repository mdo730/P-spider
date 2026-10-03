# P-Spider 1.6.4 开发计划：宠物彩蛋「香蕉君」

> 本文件记录宠物养成彩蛋的**最终方案**（会话讨论定案），实现按此执行。
> 相关：`HANDOFF.md`（会话交接）、`AGENTS.md`（维护说明）。
> 数值蓝本参考开源项目 **LorisYounger/VPet**（虚拟桌宠模拟器，Apache-2.0）的属性/经济/工作学习设计。

## 目标与定位

- 一个**隐藏彩蛋**：在「关于」页 3 秒内连点 Logo 5 次解锁。
- 轻量养成骨架，但预留中量扩展位；**强解耦**，`src/pet/` 可整体抽出当独立小游戏。
- 货币「金币」，宠物名可改，学历用正经命名。

## 已定决策

| # | 项 | 结论 |
|---|---|---|
| 1 | 入口 | 关于页 Logo 3 秒内连点 5 次解锁，解锁后常驻入口 |
| 2 | 展示 | 入口按钮 → 独立弹窗面板 |
| 3 | 属性 | 饱腹/清洁/心情/健康/体力/好感/经验等级/金币/学历（借 VPet） |
| 4 | 生存 | 引入体力；**不会死**，重病可治 |
| 5 | 节奏 | 极慢/挂机向（饱腹约 3 天见底）|
| 6 | 收入 | 下载产金（主，学历倍率）+ 打工（第二独立主干，纯打工党可玩）|
| 7 | 学习/打工 | VPet 式「占用一段时间」的日程制（完成后结算）|
| 8 | 通胀 | 靠下载量天然封顶 + 大额出口（学习/图鉴/高级物品）|
| 9 | 交互 | 轻量点击反馈（点宠物=摸摸），纯增益不惩罚 |
| 10 | 动画 | 可插拔渲染层，当前静态图 + CSS |
| 11 | 防作弊 | 时间回拨 → 不扣不加（仅对齐锚点）|
| 12 | 文案 | 温柔陪伴向；学历：幼儿园→小学→初中→高中→大学→硕士→博士→博士后 |

## 目录结构（自包含，可抽出）

```
src/pet/
  index.ts              # 唯一对外出口（PetEgg / useLogoUnlock / usePetStore / emitPetActivity）
  types.ts              # 类型定义
  constants.ts          # 全部数值配置（调参只动这里）
  items.ts              # 物品数据表（数据驱动，加物品=加一条）
  engine.ts             # core 纯逻辑（无 React/zustand/Tauri）
  pet-store.ts          # zustand persist 薄壳（→ %APPDATA%\p-spider\pet.json）
  activity.ts           # emitPetActivity 上报入口
  activity-bridge.ts    # 唯一业务耦合点（main.tsx 副作用 import）
  useLogoUnlock.ts      # 连点解锁 hook
  ui/
    BananaSprite.tsx    # 可插拔渲染层（唯一「动起来」实现点）
    PetEgg.tsx          # 入口按钮 + 弹窗 + 养成面板
    pet.css             # 精灵图 CSS 动画
  assets/banana.png     # 角色母图
```

**解耦原则**：`engine.ts` 为 `(state, ...args, now) => state` 纯函数，不含任何外部依赖；业务侧只经 `activity-bridge` 单向调用 `emitPetActivity`。抽出时删掉 bridge 即可，core/store 照常独立。

## 数据模型（PetState）

- 三围 + 状态：`satiety / cleanliness / mood / health / energy`（0~100）
- 成长：`exp`（等级 `level = ⌊√exp/10⌋ + 1`）、`affinity`
- 经济：`coin`、`eduLevel`
- 疾病：`sickSince`（0 未病；健康 < 40 生病，< 15 重症，重症不自愈需用药）
- 进食缓冲 `buffer`（借 VPet Store：食物效果一半即时、一半随时间释放）
- 日程 `task`（打工/学习，占用一段时间，离线也推进，到期结算）
- 库存 `inventory` / 玩具耐久 `toys` / 图鉴 `collection`
- 时间锚点与行为计数 `stats`

## 经济数值（初版，均在 constants.ts）

- 下载：`1 + 0.5×学历` 金币/次（每日下载量天然封顶）
- 打工：`10 × (1 + 0.4×学历)` 金币，30 分钟，耗体力 30 + 少量饱腹/心情
- 学习：学费 `200/500/1200/3000/8000/20000/50000` 递增，2 小时，耗体力 40
- 物品：食物 5~30、清洁 4~12、玩具 15~30（耐用）、医疗 20/40
- 衰减：饱腹 -1.4/时、清洁 -0.83/时、心情 -0.7/时；体力 +12/时
- 生病：三围不足时按概率突发扣健康，每日最多 1 次

## 运行时行为

- **离线结算** `settle(state, now)`：衰减/缓冲释放/体力恢复/健康疾病/日程完成；时间回拨则不扣不加。
- **在线上报**：`activity-bridge` 订阅 `onTaskCompleted`（下载）、搜索历史栈顶变化（搜索）、`pendingArticle` 变化（浏览）→ `emitPetActivity`。未解锁不产金。
- **面板**：每秒刷新倒计时，每分钟 `sync()` 结算一次（只在弹窗打开时）。

## 动画方案（可插拔）

`BananaSprite` 只接收 `{ mood, health, action }`，当前用**单张母图 + CSS**（呼吸/摇摆/弹跳/发抖/灰度），按状态切 class。
后续若用 AI 出**差分图**或换 **Rive/精灵图**，只改 `BananaSprite` 内部，core 与面板不动。
（AI 路线建议：优先「差分图 + CSS」，逐帧精灵图不一致、视频抽帧透明背景难处理。）

## 改动清单

- 新增：`src/pet/**`
- 改：`pages/About.tsx`（连点解锁 + 入口）、`main.tsx`（副作用 import bridge）
- 版本：`package.json`、`src-tauri/Cargo.toml` → 1.6.4（tauri.conf.json version 指向 package.json）
- 存储：新增 `%APPDATA%\p-spider\pet.json`

## 验证

1. `pnpm typeCheck` 通过
2. `npx eslint ./src` 通过
3. `pnpm tauri build` 打包

---

# 升级：桌面宠物窗（1.6.4 后续，批次一已完成）

> 从「应用内弹窗」升级为「独立置顶桌面窗」。分两批：批次一=窗+交互+命名；批次二=学科/工种/皮肤。

## 架构调整（多窗口）

- **状态归属**：解锁标记 `petUnlocked` 移入 `app-state`（主窗口），避免两窗口抢写；
  `pet.json` 由**桌面宠物窗独占**读写。主窗口不再 import pet store（`src/pet/index.ts` 已改为轻量出口）。
- **窗口**：`WebviewWindow('pet', { transparent, decorations:false, alwaysOnTop, resizable:false, skipTaskbar:false })`，
  由 `src/pet/open-window.ts` 创建/聚焦；`main.tsx` 按 `getCurrent().label==='pet'` 渲染 `PetDesktop`。
- **活跃度**：主窗口 `activity-bridge` → `emitPetActivity` 改为**广播 Tauri 事件** `pet-activity`；
  宠物窗监听事件后结算（宠物窗未开则不结算）。
- **托盘 tooltip**：Rust 新增命令 `set_tray_tooltip`，宠物窗状态变化时经 `src/pet/tray.ts` 节流写入。

## 交互（批次一）

- 拖拽：按住宠物移动 → `startDragging()`；未移动则视为点击。
- **状态信息**：不放在宠物窗上。Windows 限制——系统托盘图标悬停只能显示系统 tooltip（纯文本）；故状态压缩为**托盘 tooltip 文本**（`set_tray_tooltip`）。
- 点击宠物（无位移）→ 宠物下方固定槽位展开 **5 个圆形按钮**（照顾/商店/打工/学习/图鉴）；槽位常驻占位，宠物不位移。
- 点击按钮 → 面板出现在**宠物右侧**（窗口向右加宽，宠物在左不被遮挡）；面板只放**选项**、不显示当前状态；点**空白区域**关闭面板（无右上角 X）。
- **首次领养**：未领养时先弹命名卡；后续改名收 **100 金币**（`RENAME_COST`）。
- 窗口尺寸三档：`base 200×250 / panel 290×330 / adopt 250×250`（`resizePetWindow`）。

## 关于页开关（批次二附带）

- 解锁后，关于页显示「桌面宠物 香蕉君」**开关**（`app-state.petEnabled`）：开启则**随软件启动显示**，关闭则关闭宠物窗。
- 旁边「**删除宠物数据**」按钮：二次确认后关闭宠物窗并删除 `%APPDATA%\p-spider\pet.json`（不删解锁标记）。

## 批次二（已完成）

- **学习分学科**：`career.ts` 的 `SUBJECTS`（编程/绘画/语言/音乐/体育）；学习某学科提升对应能力，学费随等级递增。
- **打工分工种**：`career.ts` 的 `JOBS`；工种有学科门槛，收益 = `(base + 能力×5) × (1 + 学历系数)`。
- **学历**：不再单独存储，由**学科总等级**换算（`eduLevelOf`，每 2 点总等级 +1 级）。
- **皮肤（图鉴）**：`skins.ts`，**纯成就解锁**（等级/学历/收集/打工次数/学科满级）。视觉走「**AI 整图替换**」——把整图放 `src/pet/assets/skins/<id>.png`，由 `import.meta.glob` 自动按 id 加载；无图时回退 `filter` 调色。`BananaSprite` 支持 `skinImage`（整图）与 `skinFilter`（调色兜底）。

## 体验修订（1.6.4 收尾）

- **修复「每次开关都重新领养」**：桌面宠物窗**必须等持久化水合完成**后再 set；此前挂载即 `sync()` 会把默认存档写回覆盖真实存档。现用 `usePetStore.persist.onFinishHydration` 门控，未水合前不渲染、不结算、不监听事件。
- 预设名字改 **西西**；关于页开关文案改为「宠物」。
- 宠物窗：整窗 **禁止选中文字**（输入框除外），修复拖拽时误选导致拖不动。
- 宠物在窗口**左上角锚定**，点圆按钮展开/打开面板**不改变宠物位置与大小**（窗口向右下扩展）。
- 圆按钮 **6 个**（照顾/商店/打工/学习/图鉴/**属性**）；属性面板显示详细数值（等级/经验/好感/学历/五维/学科/统计）。
- **金币飘字**：金币增加（下载完成 / 打工结算）时宠物头顶弹「🪙 +x」上浮淡出。
- 面板点**空白区域**关闭；无右上角 X。

## 新增/变更文件

- 新增：`pet/open-window.ts`、`pet/tray.ts`、`pet/desktop/PetDesktop.tsx`
- 改：`pet/activity.ts`（改事件广播）、`pet/index.ts`（轻量出口）、`pet/pet-store.ts`（adopt/rename）、
  `pet/engine.ts`（adopt/rename/`adopted`）、`pet/types.ts`（`adopted`）、`pet/constants.ts`（`RENAME_COST`）、
  `pet/ui/pet.css`（透明窗）、`stores/app-state.ts`（`petUnlocked`）、`main.tsx`（分支渲染）、
  `pages/About.tsx`（入口改为打开窗）、`src-tauri/src/main.rs`（`set_tray_tooltip`）
- 删除：`pet/ui/PetEgg.tsx`（被 PetDesktop 取代）

## 批次二（待做）

- ~~学习分学科、打工分工种~~ **已完成**（见上）。
- ~~皮肤纯成就解锁~~ **已完成**（CSS filter 调色，见上；后续若补美术素材，换 `BananaSprite` 即可）。

> ⚠️ 桌面宠物窗依赖真实 Tauri 环境，浏览器预览不可见；需 `pnpm tauri build` 后实机验证透明窗/拖拽/tooltip。
