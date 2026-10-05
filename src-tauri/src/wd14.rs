//! WD14 视觉标签：常驻 Python 进程（外挂环境）。
//!
//! 前端先 `wd14_start` 启动（模型只加载一次），再 `wd14_tag` 批量喂图片路径、
//! 收 JSON 标签；结束 `wd14_stop`。模型/脚本/venv 都在外部，本模块只做进程桥。

use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct Wd14Proc {
  child: Child,
  stdin: ChildStdin,
  stdout: BufReader<ChildStdout>,
}

static WD14: Mutex<Option<Wd14Proc>> = Mutex::new(None);

#[derive(Serialize)]
pub struct Wd14Tag {
  path: String,
  tags: Vec<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  error: Option<String>,
}

#[tauri::command]
pub async fn wd14_start(
  python: String,
  script: String,
  cuda_lib: Option<String>,
  onnx: Option<String>,
  csv: Option<String>,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut guard = WD14.lock().map_err(|_| "WD14 锁失败")?;
    if guard.is_some() {
      return Ok(());
    }
    let mut cmd = Command::new(&python);
    cmd
      .arg(&script)
      .arg("--serve")
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::null())
      // 文件名含日文/中文，强制 Python UTF-8 I/O，否则 stdin 会按本地编码损坏路径
      .env("PYTHONUTF8", "1")
      .env("PYTHONIOENCODING", "utf-8");
    if let Some(o) = onnx {
      if !o.is_empty() {
        cmd.env("WD14_ONNX", o);
      }
    }
    if let Some(c) = csv {
      if !c.is_empty() {
        cmd.env("WD14_CSV", c);
      }
    }
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW：后台静默，不弹控制台窗口
    if let Some(c) = cuda_lib {
      if !c.is_empty() {
        cmd.env("WD14_CUDA_LIB", c);
      }
    }
    let mut child = cmd
      .spawn()
      .map_err(|e| format!("启动 WD14 进程失败：{e}"))?;
    let stdin = child.stdin.take().ok_or("无法获取 WD14 stdin")?;
    let stdout = BufReader::new(child.stdout.take().ok_or("无法获取 WD14 stdout")?);
    *guard = Some(Wd14Proc {
      child,
      stdin,
      stdout,
    });
    Ok(())
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn wd14_tag(paths: Vec<String>) -> Result<Vec<Wd14Tag>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut guard = WD14.lock().map_err(|_| "WD14 锁失败")?;
    let p = guard.as_mut().ok_or("WD14 未启动")?;
    for path in &paths {
      writeln!(p.stdin, "{path}").map_err(|e| e.to_string())?;
    }
    p.stdin.flush().map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(paths.len());
    for _ in 0..paths.len() {
      let mut line = String::new();
      let n = p.stdout.read_line(&mut line).map_err(|e| e.to_string())?;
      if n == 0 {
        // 进程退出，清掉句柄，避免后续一直失败
        *guard = None;
        return Err("WD14 进程已退出（可能模型加载失败或 Python 路径不对）".into());
      }
      let line = line.trim();
      if line.is_empty() {
        continue;
      }
      match serde_json::from_str::<serde_json::Value>(line) {
        Ok(v) => {
          let path = v
            .get("path")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
          let error = v
            .get("error")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
          let tags = v
            .get("tags")
            .and_then(|x| x.as_array())
            .map(|a| {
              a.iter()
                .filter_map(|t| t.as_str().map(|s| s.to_string()))
                .collect()
            })
            .unwrap_or_default();
          out.push(Wd14Tag { path, tags, error });
        }
        Err(e) => out.push(Wd14Tag {
          path: String::new(),
          tags: vec![],
          error: Some(format!("解析 WD14 输出失败: {e}")),
        }),
      }
    }
    Ok(out)
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn wd14_stop() -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut guard = WD14.lock().map_err(|_| "WD14 锁失败")?;
    if let Some(mut p) = guard.take() {
      let _ = p.child.kill();
      let _ = p.child.wait();
    }
    Ok(())
  })
  .await
  .map_err(|e| e.to_string())?
}

const SERVE_PY: &str = include_str!("wd14_serve.py");

fn run_quiet(program: &str, args: &[&str], envs: &[(&str, &str)]) -> Result<(), String> {
  let mut cmd = Command::new(program);
  cmd
    .args(args)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::piped());
  for (k, v) in envs {
    cmd.env(k, v);
  }
  #[cfg(windows)]
  cmd.creation_flags(0x0800_0000);
  let out = cmd
    .output()
    .map_err(|e| format!("执行 {program} 失败：{e}"))?;
  if !out.status.success() {
    let err = String::from_utf8_lossy(&out.stderr);
    let tail: Vec<&str> = err.lines().rev().take(3).collect();
    return Err(format!("{program} 执行失败：{}", tail.join(" | ")));
  }
  Ok(())
}

/// 一键安装外挂依赖：写脚本 → 建 venv → pip 装 onnxruntime-gpu → 返回路径
#[tauri::command]
pub async fn wd14_setup_external(
  app: tauri::AppHandle,
  python: String,
  model_dir: String,
  proxy_url: Option<String>,
) -> Result<serde_json::Value, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let total = 4u32;
    let emit = |step: u32, msg: &str| {
      let _ = app.emit_all(
        "wd14-setup",
        serde_json::json!({ "step": step, "total": total, "message": msg }),
      );
    };
    let dir = std::path::PathBuf::from(&model_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // 1. 落地脚本
    let script = dir.join("wd14_serve.py");
    std::fs::write(&script, SERVE_PY).map_err(|e| e.to_string())?;
    emit(1, "脚本就绪");

    // 2. 创建 venv
    let venv = dir.join("venv");
    let vpy = venv.join("Scripts").join("python.exe");
    if !vpy.exists() {
      run_quiet(
        &python,
        &["-m", "venv", &venv.to_string_lossy()],
        &[("PYTHONUTF8", "1")],
      )?;
    }
    emit(2, "已创建 venv");

    // 3. 安装依赖（onnxruntime-gpu；无 CUDA 时脚本自动回退 CPU）
    let proxy = proxy_url.unwrap_or_default();
    let mut envs: Vec<(&str, &str)> = vec![("PYTHONUTF8", "1")];
    if !proxy.is_empty() {
      envs.push(("HTTPS_PROXY", proxy.as_str()));
      envs.push(("HTTP_PROXY", proxy.as_str()));
    }
    run_quiet(
      &vpy.to_string_lossy(),
      &[
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "onnxruntime-gpu",
        "numpy",
        "pillow",
      ],
      &envs,
    )?;
    emit(3, "依赖安装完成");

    emit(4, "完成");
    Ok(serde_json::json!({
      "python": vpy.to_string_lossy(),
      "script": script.to_string_lossy(),
    }))
  })
  .await
  .map_err(|e| e.to_string())?
}

fn build_client(proxy_url: Option<&str>) -> Result<reqwest::Client, String> {
  let mut b = reqwest::Client::builder()
    .connect_timeout(std::time::Duration::from_secs(20))
    .timeout(std::time::Duration::from_secs(120));
  if let Some(p) = proxy_url {
    if !p.is_empty() {
      b = b.proxy(reqwest::Proxy::all(p).map_err(|e| e.to_string())?);
    }
  }
  b.build().map_err(|e| e.to_string())
}

/// 把远程图下载到 out_dir（用于给 WD14 喂本地文件），返回本地路径列表。
#[tauri::command]
pub async fn wd14_download(
  urls: Vec<String>,
  out_dir: String,
  proxy_url: Option<String>,
  referer: Option<String>,
) -> Result<Vec<String>, String> {
  let client = build_client(proxy_url.as_deref())?;
  tokio::fs::create_dir_all(&out_dir)
    .await
    .map_err(|e| e.to_string())?;
  let mut paths = Vec::new();
  for (i, url) in urls.iter().enumerate() {
    let mut req = client
      .get(url)
      .header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );
    if let Some(r) = &referer {
      if !r.is_empty() {
        req = req.header("Referer", r);
      }
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
      return Err(format!("下载图片失败（{}）：{}", resp.status(), url));
    }
    let ext = url
      .split('?')
      .next()
      .unwrap_or("")
      .rsplit('.')
      .next()
      .unwrap_or("jpg");
    let ext: String = if !ext.is_empty() && ext.len() <= 4 {
      ext.chars().filter(|c| c.is_ascii_alphanumeric()).collect()
    } else {
      "jpg".into()
    };
    let path = format!("{out_dir}\\{i}.{ext}");
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(&path, &bytes)
      .await
      .map_err(|e| e.to_string())?;
    paths.push(path);
  }
  Ok(paths)
}
