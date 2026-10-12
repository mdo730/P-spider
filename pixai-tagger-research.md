# PixAI Tagger 调研记录

> 调研时间：2026-10-12
> 结论：等 deepghs 出 v1.0 ONNX 版本再接入（v0.9 优势有限，v1.0 提升大但暂无 ONNX）

## 一、模型对比（PixAI v1.0 vs WD14）

| 维度 | WD14（项目当前用） | PixAI Tagger v1.0 |
|---|---|---|
| 标签数 | ~9000（general+character） | **30,877**（6 个分类） |
| 输入分辨率 | 448×448 | **1008×1008** |
| 骨干网络 | ConvNeXt/ViT（317M） | finetuned SAM3（486M） |
| 分类 | general + character 两类 | general + character + **style + copyright + meta + rating** 六类 |
| 推理速度 | 快（317M，448 输入） | 慢约一倍（486M，1008 输入，H100 上 48 张/s） |
| 许可 | WD 系开源 | Apache-2.0 |
| 模型体积 | ~350MB | ~1.9GB（model.safetensors） |

## 二、基准测试（50416 张测试图，共同标签集）

### General tags（8407 共同标签）
| Model | micro F1 | macro F1 | mAP |
|---|---|---|---|
| **PixAI Tagger v1.0** | **0.6660** | **0.3885** | **0.3807** |
| AnimeTIMM CAFormer B36 | 0.6435 | 0.3539 | 0.3324 |
| AnimeTIMM ConvNeXtV2 Huge | 0.6421 | 0.3752 | 0.3333 |
| AnimeTIMM EVA Giant | 0.6410 | 0.3796 | 0.3391 |
| AnimeTIMM EVA02 Large | 0.6401 | 0.3742 | 0.3423 |
| AnimeTIMM SigLIP Giant | 0.6362 | 0.3722 | 0.3267 |
| PixAI Tagger v0.9 | 0.5980 | 0.3286 | 0.3251 |
| Camie v2 | 0.5775 | 0.2109 | 0.2245 |

### Character tags（2099 共同标签）
| Model | micro F1 | macro F1 | mAP |
|---|---|---|---|
| **PixAI Tagger v1.0** | 0.9242 | 0.8919 | 0.9226 |
| AnimeTIMM SigLIP Giant | **0.9265** | **0.9082** | 0.9232 |
| AnimeTIMM EVA Giant | 0.9221 | 0.9018 | **0.9271** |
| AnimeTIMM ConvNeXtV2 Huge | 0.9188 | 0.8974 | 0.9182 |
| AnimeTIMM EVA02 Large | 0.9179 | 0.8923 | 0.9226 |
| AnimeTIMM CAFormer B36 | 0.9069 | 0.8779 | 0.9079 |
| PixAI Tagger v0.9 | 0.8198 | 0.7791 | 0.8376 |
| Camie v2 | 0.7261 | 0.6491 | 0.7192 |

### v0.9 → v1.0 提升幅度
| Release | 词汇量 | 输入分辨率 | General micro F1 | Character micro F1 |
|---|---|---|---|---|
| PixAI Tagger v0.9 | 13,461 | 448×448 | 0.5980 | 0.8198 |
| **PixAI Tagger v1.0** | **30,877** | **1008×1008** | **0.6660** | **0.9242** |

General +6.80 个点，Character +10.44 个点。

## 三、v1.0 六分类输出

| 分类 | 标签数 | 默认阈值 | 说明 |
|---|---|---|---|
| general | 15,043 | 0.17 | 可见内容（服装/姿势/物体/构图） |
| character | 8,308 | 0.27 | 命名角色 |
| style | 4,917 | 0.15 | 画风标签（WD14 完全没有） |
| copyright | 2,460 | 0.24 | 作品来源/系列（含 original） |
| meta | 145 | 0.17 | 媒介/来源/分辨率/状态 |
| rating | 4 | 0.41 | rating:g/s/q/e |

全词汇集整体 micro F1 = 0.723。

## 四、ONNX 接入现状

### deepghs ONNX 仓库

| 版本 | 仓库 | 状态 |
|---|---|---|
| v0.9 | `deepghs/pixai-tagger-v0.9-onnx` | ✅ 已有，公开 |
| v1.0 | `deepghs/pixai-tagger-v1.0-onnx` | ❌ 不存在（deepghs 尚未转换） |

### v0.9 ONNX 仓库文件结构（已确认）
```
deepghs/pixai-tagger-v0.9-onnx
├── model.onnx           # ONNX 模型
├── selected_tags.csv    # id,tag_id,name,category,count,ips
├── preprocess.json      # 预处理参数
├── thresholds.csv       # category,name,threshold
├── categories.json     # 分类定义
├── meta.json
└── README.md
```

### v0.9 预处理参数（preprocess.json 已确认）
- resize 到 448×448（bilinear）
- 归一化：mean=0.5, std=0.5（即 `(x/255 - 0.5) / 0.5`）
- RGB 顺序
- 输入节点名：`input`，形状 `[1,448,448,3]`（NHWC）

### v0.9 CSV 格式（与 WD14 不同）
- WD14 CSV 列：`id,name,category`（name 在第 2 列）
- PixAI CSV 列：`id,tag_id,name,category,count,ips`（**name 在第 3 列**，category 同样 0=general/4=character）

## 五、接入方案（v1.0 ONNX 出来后执行）

### 集成点（基于现有架构，最小改动）

| 层 | 文件 | 改动 |
|---|---|---|
| 前端模型列表 | `services/wd14.ts` `WD14_MODELS` | 追加 PixAI 模型项，下载 URL 按 modelId 前缀分流（`pixai-` → deepghs 仓库，否则 → SmilingWolf） |
| 设置 UI | `pages/Settings.tsx` | 引擎选项不变（内置/外挂），模型下拉多一个选项 |
| Rust 预处理 | `src-tauri/src/wd14_infer.rs` `preprocess()` | 按 modelId 分支：PixAI 走 RGB+归一化(0.5/0.5)+448；WD14 走 BGR+不归一化+448 |
| Rust CSV 解析 | `wd14_infer.rs` `load_csv()` | 按 CSV 表头判断列数，name 列位置不同（WD14 第 2 列，PixAI 第 3 列） |
| Rust 阈值 | `wd14_infer.rs` `tag()` | PixAI v1.0 有 6 分类阈值，需要扩展（v0.9 仍 2 分类，兼容） |
| 下载逻辑 | `wd14_model_download` | PixAI 多文件（preprocess.json/thresholds.csv/categories.json），需一并下载 |

### 关键差异适配
1. **预处理**：PixAI 是 RGB+归一化(0.5)，WD14 是 BGR+不归一化。需按 modelId 分支
2. **CSV 列**：PixAI 的 name 在第 3 列（WD14 第 2 列）。load_csv 需适配
3. **v1.0 六分类**：v0.9 仍只有 general/character(0/4)，v1.0 有 6 类。tag() 的阈值逻辑需扩展
4. **模型体积**：v0.9 ~320MB，v1.0 ONNX 预计 ~1.9GB。下载提示需更新

### ComfyUI 工作流参考
- 文件：`E:\Downloads\Anima+本地简易反推流.json`
- 节点类型：`PixAITaggerPlus`
- 后接 `DanbooruTagDedup`（标签去重）节点
- 阈值：general 0.17 / character 0.27

## 六、等待策略

- 定期检查 `deepghs/pixai-tagger-v1.0-onnx` 是否发布
- v1.0 ONNX 出来后，按上述方案接入，改动约 80-120 行（集中在 `wd14_infer.rs` 和 `wd14.ts`）
- 接入后作为可选模型，不替换 WD14（让用户在设置-工具与数据-视觉识别-模型里选）

## 七、参考链接

- v1.0 原版：https://huggingface.co/pixai-labs/pixai-tagger-v1.0
- v0.9 ONNX：https://huggingface.co/deepghs/pixai-tagger-v0.9-onnx
- imgutils 文档：https://dghs-imgutils.deepghs.org/main/api_doc/tagging/pixai.html
- imgutils 源码：https://github.com/deepghs/imgutils/blob/main/imgutils/tagging/pixai.py
- ComfyUI 插件：https://github.com/warwk/ComfyUI-PixAI-Tagger
