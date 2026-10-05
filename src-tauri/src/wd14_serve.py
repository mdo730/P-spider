#!/usr/bin/env python3
"""WD14 常驻脚本（P-Spider 附带）：stdin 逐行吃图片路径 → stdout 逐行吐 JSON 标签。

模型来源：优先环境变量 WD14_ONNX / WD14_CSV；否则回退 ComfyUI 插件目录。
CUDA 库目录由 WD14_CUDA_LIB 注入（复用 ComfyUI torch 的 lib，可选）。
"""
import argparse
import csv
import json
import os
import sys
import time

try:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import numpy as np
from PIL import Image

_cuda_lib = os.environ.get("WD14_CUDA_LIB")
if _cuda_lib and os.path.isdir(_cuda_lib):
    os.environ["PATH"] = _cuda_lib + os.pathsep + os.environ.get("PATH", "")
    if hasattr(os, "add_dll_directory"):
        os.add_dll_directory(_cuda_lib)

import onnxruntime as ort

FALLBACK_DIR = os.environ.get(
    "WD14_MODEL_DIR", r"E:\OPENCODE\ainimte\ComfyUI\custom_nodes\ComfyUI-WD14-Tagger\models"
)
FALLBACK_MODEL = "wd-v1-4-moat-tagger-v2"
THRESHOLD = 0.35
CHAR_THRESHOLD = 0.85
MAX_RES = 1280


def load_tags(csv_path):
    tags, general_index, character_index = [], None, None
    with open(csv_path, encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)
        for row in reader:
            if general_index is None and row[2] == "0":
                general_index = reader.line_num - 2
            elif character_index is None and row[2] == "4":
                character_index = reader.line_num - 2
            tags.append(row[1].replace("_", " "))
    return tags, general_index, character_index


def preprocess(image, height):
    if max(image.size) > MAX_RES:
        ratio = MAX_RES / max(image.size)
        image = image.resize(tuple(int(x * ratio) for x in image.size), Image.LANCZOS)
    ratio = float(height) / max(image.size)
    new_size = tuple(int(x * ratio) for x in image.size)
    image = image.resize(new_size, Image.LANCZOS)
    square = Image.new("RGB", (height, height), (255, 255, 255))
    square.paste(image, ((height - new_size[0]) // 2, (height - new_size[1]) // 2))
    arr = np.array(square).astype(np.float32)[:, :, ::-1]
    return np.expand_dims(arr, 0)


def main():
    model_onnx = os.environ.get("WD14_ONNX")
    model_csv = os.environ.get("WD14_CSV")
    if not model_onnx or not model_csv:
        model_onnx = os.path.join(FALLBACK_DIR, FALLBACK_MODEL + ".onnx")
        model_csv = os.path.join(FALLBACK_DIR, FALLBACK_MODEL + ".csv")

    tags, gi, ci = load_tags(model_csv)
    providers = (
        ["CUDAExecutionProvider"] if "CUDAExecutionProvider" in ort.get_available_providers() else []
    ) + ["CPUExecutionProvider"]
    sess = ort.InferenceSession(model_onnx, providers=providers)
    inp = sess.get_inputs()[0]
    height = inp.shape[1]
    label = sess.get_outputs()[0].name
    print(f"[ready] provider={sess.get_providers()} height={height}", file=sys.stderr, flush=True)

    def tag_one(path):
        t = time.time()
        img = Image.open(path).convert("RGB")
        arr = preprocess(img, height)
        probs = sess.run([label], {inp.name: arr})[0][0]
        scored = []
        for i, p in enumerate(probs):
            if i < gi:
                continue
            th = CHAR_THRESHOLD if (ci is not None and i >= ci) else THRESHOLD
            if p > th:
                scored.append((float(p), tags[i]))
        scored.sort(reverse=True)  # 置信度从高到低（越前越重要）
        return {
            "path": path,
            "tags": [n for _, n in scored],
            "ms": round((time.time() - t) * 1000, 1),
        }

    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            print(json.dumps(tag_one(path), ensure_ascii=False), flush=True)
        except Exception as e:
            print(json.dumps({"path": path, "error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
