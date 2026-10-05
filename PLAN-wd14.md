# PLAN · WD14 视觉标签（fig-memo 检索辅助）

> 自用功能（本人用），不对外宣传、不保证给普通用户开箱即用。最后更新：2026-10-05

## 目标
用 WD14 给 fig-memo 文章生成**结构化标签**，建可检索索引，方便按「体型/服装/姿势/元素/道具/发型」快速翻参考。

## 结论：用 WD14，不用 Florence2
- WD14（`wd-v1-4-moat-tagger-v2`，311MB ONNX）：出干净 danbooru 标签，~141ms/图（GPU）。
- Florence2-large-PromptGen（3.1GB）：出自然语言描述——**啰嗦/重复/幻觉、不一致，不适合当标签**，弃用。

## 运行时（外挂，非内置）
- 独立 venv：`E:\OPENCODE\wd14-venv`（Python + `onnxruntime-gpu==1.20.2` + numpy + pillow）。
  - ⚠️ 必须是 **CUDA 12 版** 的 onnxruntime-gpu（1.20.2）；1.30 要 CUDA 13，与 torch cu128 不兼容。
  - CUDA/cuDNN DLL 复用 ComfyUI torch：`E:\OPENCODE\ainimte\ComfyUI\venv\Lib\site-packages\torch\lib`（`cublasLt64_12.dll`/`cudnn64_9.dll`）。脚本里靠环境变量 `WD14_CUDA_LIB` 注入。
- 脚本：`wd14_serve.py`（模型只加载一次，stdin 逐行吃图片路径 → stdout 逐行吐 JSON）。自动检测 CUDA，没有就 CPU。
- 模型/CSV 直接读 ComfyUI 里的现成文件。

## 受控词表（闭集）
- 原始 WD14 输出**不直接暴露**；经 `wd14-tag-map.json` 映射到有限词表（**词条 + 别名**模型）。
- 未命中且不在忽略列表 → 丢弃 / 进「待归类」队列。
- 归一规则：① 剥颜色前缀再查别名 ② 同类合并（枪械刀剑→武器、demon wings→翅膀）③ 以 `hair`/`eyes` 结尾丢弃。
- 两层：内置 `wd14-tag-map.json` + 用户覆盖 `wd14-tag-map-user.json`。
- 调研（24 篇/192 图，424 个原始标签）：命中词表 40%、忽略 53%、未归类 7%；闭集约 170 条，目标 ≤ 250。

## 数据文件
- `figmemo-visual-tags.jsonl`：`postId → { 词条ids[], 引擎, 词表版本, 取图数, 时间 }`
- `wd14-unknown.json`：待归类 raw 标签 + 次数。
- `wd14-tag-map.json` / `wd14-tag-map-user.json`。

## 交互（fig-memo 优先）
- 列表页右下角**并排两枚圆钮**：`🔍 识别` / `⚙ 管理`。
- 识别 = 对**当前筛选结果**（未设筛选 = 全量）跑；跳过已识别；可断点续跑。
- 每篇取图数（设置项）：`1` / `5` / `全量`。
- 进度可视化：FAB 环形进度 + `12/57`；浮现面板显示当前篇/已用/剩余 + 停止。
- 结果写索引；列表加「视觉标签」筛选；卡片角标「已识别」。
- 管理面板 = Drawer：`词表` / `待归类` / `索引` 三个 Tab。
- 顺序：先处理**库存文章**，跑通再考虑新文章自动识别。

## 设置项（设置 → 站点 → fig-memo）
- 视觉识别·每篇取图数：1 / 5 / 全量
- Python 路径（自动探测：优先 `E:\OPENCODE\wd14-venv`，否则 ComfyUI venv）
- CUDA 库目录（默认 ComfyUI `torch\lib`）
- 状态行：当前后端（GPU RTX 3060 Ti ~141ms/图 / CPU）

## 耗时（GPU 141ms/图）
| 取图 | 全量 2633 篇 |
|---|---|
| 1 张 | ~6 分钟 |
| 5 张 | ~28 分钟 |
| 全量 | ~2.3 小时（CPU ~9h） |

## 测试脚本/数据
- `C:\Users\33400\AppData\Local\Temp\opencode\wd14test\`：`wd14_serve.py`、`wd14-tag-map.draft.json`、`florence_test.py`、调研图 `survey/`。
