//! 缓存/存储统计与清理。
//!
//! 统计并清理：日志、缩略图缓存、WD14 临时图、图片切割临时、旧备份文件（.bak-*/ .pre-import）。
//! 不碰用户数据（downloads.jsonl / history.db / *.json 数据 / hpoi 索引 / WebView）。

use std::path::Path;
use tauri::AppHandle;

fn dir_size(p: &Path) -> u64 {
  let mut total = 0;
  if let Ok(rd) = std::fs::read_dir(p) {
    for e in rd.flatten() {
      if let Ok(md) = e.metadata() {
        if md.is_dir() {
          total += dir_size(&e.path());
        } else {
          total += md.len();
        }
      }
    }
  }
  total
}

/// 删除目录内的所有内容（目录本身保留），返回成功释放的字节数
fn rm_dir_contents(p: &Path) -> u64 {
  let mut freed = 0;
  if let Ok(rd) = std::fs::read_dir(p) {
    for e in rd.flatten() {
      let path = e.path();
      let Ok(md) = e.metadata() else { continue };
      if md.is_dir() {
        let sz = dir_size(&path);
        if std::fs::remove_dir_all(&path).is_ok() {
          freed += sz;
        }
      } else if std::fs::remove_file(&path).is_ok() {
        freed += md.len();
      }
    }
  }
  freed
}

fn is_backup(name: &str) -> bool {
  name.contains(".bak-") || name.ends_with(".pre-import")
}

fn backups_size(dir: &Path) -> u64 {
  let mut total = 0;
  if let Ok(rd) = std::fs::read_dir(dir) {
    for e in rd.flatten() {
      let name = e.file_name().to_string_lossy().to_string();
      if is_backup(&name) {
        if let Ok(md) = e.metadata() {
          total += md.len();
        }
      }
    }
  }
  total
}

fn clear_backups(dir: &Path) -> u64 {
  let mut freed = 0;
  if let Ok(rd) = std::fs::read_dir(dir) {
    for e in rd.flatten() {
      let name = e.file_name().to_string_lossy().to_string();
      if is_backup(&name) {
        if let Ok(md) = e.metadata() {
          if std::fs::remove_file(e.path()).is_ok() {
            freed += md.len();
          }
        }
      }
    }
  }
  freed
}

fn paths(app: &AppHandle) -> (std::path::PathBuf, std::path::PathBuf) {
  let r = app.path_resolver();
  (
    r.app_data_dir().unwrap_or_default(),
    r.app_cache_dir().unwrap_or_default(),
  )
}

#[tauri::command]
pub fn storage_usage(app: AppHandle) -> serde_json::Value {
  let (ad, ac) = paths(&app);
  serde_json::json!({
    "logs": dir_size(&ad.join("logs")),
    "thumb": dir_size(&ad.join("thumb-cache")),
    "wd14": dir_size(&ac.join("wd14")) + dir_size(&ac.join("wd14-single")),
    "split": dir_size(&ac.join("split-cache")),
    "backups": backups_size(&ad),
  })
}

#[tauri::command]
pub fn clear_storage(app: AppHandle) -> u64 {
  let (ad, ac) = paths(&app);
  let mut freed = 0;
  freed += rm_dir_contents(&ad.join("logs"));
  freed += rm_dir_contents(&ad.join("thumb-cache"));
  freed += rm_dir_contents(&ac.join("wd14"));
  freed += rm_dir_contents(&ac.join("wd14-single"));
  freed += rm_dir_contents(&ac.join("split-cache"));
  freed += clear_backups(&ad);
  freed
}

/// 日志保留策略：只留最近 `days` 天、且总量不超过 `cap_mb`，超出的删最旧的。
/// 返回释放字节数。
#[tauri::command]
pub fn cleanup_logs(app: AppHandle, days: u64, cap_mb: u64) -> u64 {
  let Some(dir) = app.path_resolver().app_log_dir() else {
    return 0;
  };
  cleanup_logs_inner(&dir, days, cap_mb)
}

fn cleanup_logs_inner(dir: &Path, days: u64, cap_mb: u64) -> u64 {
  let cap = cap_mb * 1024 * 1024;
  let now = std::time::SystemTime::now();
  let cutoff = now
    .checked_sub(std::time::Duration::from_secs(days * 86400))
    .unwrap_or(now);
  let mut files: Vec<(std::path::PathBuf, std::time::SystemTime, u64)> = Vec::new();
  if let Ok(rd) = std::fs::read_dir(dir) {
    for e in rd.flatten() {
      let name = e.file_name().to_string_lossy().to_string();
      if !name.ends_with(".log") {
        continue;
      }
      if let Ok(md) = e.metadata() {
        if let Ok(mtime) = md.modified() {
          files.push((e.path(), mtime, md.len()));
        }
      }
    }
  }
  // 新→旧
  files.sort_by(|a, b| b.1.cmp(&a.1));
  let mut kept: u64 = 0;
  let mut freed: u64 = 0;
  for (p, mtime, size) in files {
    let within_time = mtime >= cutoff;
    let within_cap = kept + size <= cap;
    if within_time && within_cap {
      kept += size;
    } else if std::fs::remove_file(&p).is_ok() {
      freed += size;
    }
  }
  freed
}
