//! Rust 内置 WD14 推理（onnxruntime，CPU）：免 Python。
//!
//! 预处理对齐 SmilingWolf/wd14：RGBA 合成到白底 → 补成方形（白）→ 448 → BGR f32(0-255) NHWC。
//! WD14 导出的 onnx 输出已含 sigmoid（概率），按 general/character 阈值筛选。

use image::imageops::FilterType;
use image::{Rgba, RgbaImage};
use ort::session::Session;
use ort::value::Tensor;
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

pub const INPUT_SIZE: u32 = 448;

pub struct Wd14Model {
  session: Session,
  input_name: String,
  output_name: String,
  tags: Vec<String>,
  general_idx: usize,
  character_idx: usize,
}

fn load_csv(csv_path: &Path) -> Result<(Vec<String>, usize, usize), String> {
  let text = std::fs::read_to_string(csv_path).map_err(|e| e.to_string())?;
  let mut tags = Vec::new();
  let mut general_idx: Option<usize> = None;
  let mut character_idx: Option<usize> = None;
  let mut first = true;
  for line in text.lines() {
    if first {
      first = false;
      continue;
    }
    if line.trim().is_empty() {
      continue;
    }
    let cols: Vec<&str> = line.split(',').collect();
    if cols.len() < 3 {
      continue;
    }
    let idx = tags.len();
    if general_idx.is_none() && cols[2].trim() == "0" {
      general_idx = Some(idx);
    } else if character_idx.is_none() && cols[2].trim() == "4" {
      character_idx = Some(idx);
    }
    tags.push(cols[1].replace('_', " "));
  }
  Ok((
    tags,
    general_idx.unwrap_or(0),
    character_idx.unwrap_or(usize::MAX),
  ))
}

fn preprocess(path: &Path) -> Result<Vec<f32>, String> {
  let img = image::open(path).map_err(|e| e.to_string())?.into_rgba8();
  let (w, h) = img.dimensions();
  let mut canvas = RgbaImage::from_pixel(w, h, Rgba([255, 255, 255, 255]));
  image::imageops::overlay(&mut canvas, &img, 0, 0);
  let side = w.max(h);
  let mut square = RgbaImage::from_pixel(side, side, Rgba([255, 255, 255, 255]));
  image::imageops::overlay(
    &mut square,
    &canvas,
    ((side - w) / 2) as i64,
    ((side - h) / 2) as i64,
  );
  let resized = image::imageops::resize(&square, INPUT_SIZE, INPUT_SIZE, FilterType::Lanczos3);
  let mut data = Vec::with_capacity((INPUT_SIZE * INPUT_SIZE * 3) as usize);
  for (_x, _y, px) in resized.enumerate_pixels() {
    // BGR
    data.push(px[2] as f32);
    data.push(px[1] as f32);
    data.push(px[0] as f32);
  }
  Ok(data)
}

impl Wd14Model {
  pub fn load(model_path: &Path, csv_path: &Path) -> Result<Self, String> {
    let (tags, general_idx, character_idx) = load_csv(csv_path)?;
    let session = Session::builder()
      .map_err(|e| e.to_string())?
      .commit_from_file(model_path)
      .map_err(|e| format!("加载模型失败：{e}"))?;
    let input_name = session.inputs()[0].name().to_string();
    let output_name = session.outputs()[0].name().to_string();
    Ok(Self {
      session,
      input_name,
      output_name,
      tags,
      general_idx,
      character_idx,
    })
  }

  pub fn tag(
    &mut self,
    path: &Path,
    threshold: f32,
    char_threshold: f32,
  ) -> Result<Vec<String>, String> {
    let data = preprocess(path)?;
    let shape = [1usize, INPUT_SIZE as usize, INPUT_SIZE as usize, 3];
    let tensor = Tensor::from_array((shape, data)).map_err(|e| e.to_string())?;
    let outputs = self
      .session
      .run(ort::inputs![self.input_name.as_str() => tensor])
      .map_err(|e| e.to_string())?;
    let (_shape, probs) = outputs[self.output_name.as_str()]
      .try_extract_tensor::<f32>()
      .map_err(|e| e.to_string())?;
    let mut hit: Vec<(f32, &str)> = Vec::new();
    for (i, p) in probs.iter().enumerate() {
      if i < self.general_idx {
        continue;
      }
      let th = if i >= self.character_idx {
        char_threshold
      } else {
        threshold
      };
      if *p > th {
        if let Some(name) = self.tags.get(i) {
          hit.push((*p, name.as_str()));
        }
      }
    }
    // 按置信度从高到低（越前越重要，便于 ComfyUI 提示词）
    hit.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    Ok(hit.into_iter().map(|(_, n)| n.to_string()).collect())
  }
}

#[derive(Serialize)]
pub struct Wd14Tag {
  path: String,
  tags: Vec<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  error: Option<String>,
}

/// 已加载的内置模型（按 model_path 缓存；空闲超时自动卸载）
struct BuiltinModel {
  path: String,
  model: Wd14Model,
  last_used: std::time::Instant,
}

static BUILTIN: Mutex<Option<BuiltinModel>> = Mutex::new(None);
/// 空闲多少秒后自动卸载模型、释放内存
const IDLE_SECS: u64 = 300;
static REAPER_STARTED: std::sync::atomic::AtomicBool =
  std::sync::atomic::AtomicBool::new(false);

fn ensure_reaper() {
  use std::sync::atomic::Ordering;
  if REAPER_STARTED.swap(true, Ordering::SeqCst) {
    return;
  }
  std::thread::spawn(|| loop {
    std::thread::sleep(std::time::Duration::from_secs(60));
    if let Ok(mut g) = BUILTIN.lock() {
      let idle = g
        .as_ref()
        .map(|b| b.last_used.elapsed().as_secs())
        .unwrap_or(0);
      if idle >= IDLE_SECS {
        *g = None;
      }
    }
  });
}

/// 手动释放：卸载内置模型（外挂进程用 wd14_stop）
#[tauri::command]
pub fn wd14_release() -> Result<(), String> {
  let mut g = BUILTIN.lock().map_err(|_| "锁失败")?;
  *g = None;
  Ok(())
}

#[tauri::command]
pub async fn wd14_builtin_tag(
  model_path: String,
  csv_path: String,
  paths: Vec<String>,
) -> Result<Vec<Wd14Tag>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut guard = BUILTIN.lock().map_err(|_| "锁失败")?;
    let need_reload = match guard.as_ref() {
      Some(b) => b.path != model_path,
      None => true,
    };
    if need_reload {
      let m = Wd14Model::load(Path::new(&model_path), Path::new(&csv_path))?;
      *guard = Some(BuiltinModel {
        path: model_path.clone(),
        model: m,
        last_used: std::time::Instant::now(),
      });
    } else if let Some(b) = guard.as_mut() {
      b.last_used = std::time::Instant::now();
    }
    ensure_reaper();
    let model = &mut guard.as_mut().unwrap().model;
    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
      match model.tag(Path::new(&path), 0.35, 0.85) {
        Ok(tags) => out.push(Wd14Tag {
          path,
          tags,
          error: None,
        }),
        Err(e) => out.push(Wd14Tag {
          path,
          tags: vec![],
          error: Some(e),
        }),
      }
    }
    Ok(out)
  })
  .await
  .map_err(|e| e.to_string())?
}

/// 下载模型文件到 dest，通过 `wd14-progress` 事件推送进度
#[tauri::command]
pub async fn wd14_model_download(
  app: tauri::AppHandle,
  url: String,
  dest: String,
  id: String,
  proxy_url: Option<String>,
) -> Result<(), String> {
  use futures_util::StreamExt;
  use tokio::io::AsyncWriteExt;

  let mut builder = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(20));
  if let Some(p) = proxy_url {
    if !p.is_empty() {
      builder = builder.proxy(reqwest::Proxy::all(p).map_err(|e| e.to_string())?);
    }
  }
  let client = builder.build().map_err(|e| e.to_string())?;
  let resp = client
    .get(&url)
    .header(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    )
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if !resp.status().is_success() {
    return Err(format!("下载失败（{}）：{}", resp.status(), url));
  }
  if let Some(parent) = Path::new(&dest).parent() {
    tokio::fs::create_dir_all(parent)
      .await
      .map_err(|e| e.to_string())?;
  }
  let total = resp.content_length().unwrap_or(0);
  let mut file = tokio::fs::File::create(&dest)
    .await
    .map_err(|e| e.to_string())?;
  let mut downloaded: u64 = 0;
  let mut last_emit: u64 = 0;
  let mut stream = resp.bytes_stream();
  while let Some(chunk) = stream.next().await {
    let c = chunk.map_err(|e| e.to_string())?;
    file.write_all(&c).await.map_err(|e| e.to_string())?;
    downloaded += c.len() as u64;
    if downloaded - last_emit >= 262144 {
      let _ = app.emit_all(
        "wd14-progress",
        serde_json::json!({ "id": id, "downloaded": downloaded, "total": total }),
      );
      last_emit = downloaded;
    }
  }
  file.flush().await.map_err(|e| e.to_string())?;
  let _ = app.emit_all(
    "wd14-progress",
    serde_json::json!({ "id": id, "downloaded": downloaded, "total": total }),
  );
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn infer_probe() {
    let base = r"E:\OPENCODE\ainimte\ComfyUI\custom_nodes\ComfyUI-WD14-Tagger\models";
    let model = std::path::Path::new(base).join("wd-v1-4-moat-tagger-v2.onnx");
    let csv = std::path::Path::new(base).join("wd-v1-4-moat-tagger-v2.csv");
    let mut m = Wd14Model::load(&model, &csv).expect("load");

    let dir = std::path::Path::new(r"F:\twitterdownload\fig-memo");
    let mut target = None;
    'outer: for e in std::fs::read_dir(dir).unwrap().flatten() {
      if e.path().is_dir() {
        for f in std::fs::read_dir(e.path()).unwrap().flatten() {
          let p = f.path();
          if p.extension().map(|x| x == "jpg").unwrap_or(false) {
            target = Some(p);
            break 'outer;
          }
        }
      }
    }
    let p = target.expect("no image");
    println!("IMG={}", p.display());
    let tags = m.tag(&p, 0.35, 0.85).expect("tag");
    println!("TAGS={}", tags.join(", "));
    assert!(!tags.is_empty());
  }
}
