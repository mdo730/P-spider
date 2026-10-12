//! 下载历史（SQLite）。
//!
//! 首次使用时把 `appData/downloads.jsonl`（可能几十 MB / 14 万条）建成 `history.db`，
//! 之后本地库按路径、时间流按时间查询，**JS 不再常驻全部记录**。
//! 新下载仍追加写 jsonl（备份/导出），同时入库。

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::io::BufRead;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

static BUILD_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistRecord {
  pub post_id: String,
  pub tweet_time: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub full_text: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub username: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub display_name: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub avatar: Option<String>,
  pub media_type: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub media_url: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub video_url: Option<String>,
  pub file_path: String,
  pub file_name: String,
  pub downloaded_at: i64,
  pub source: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub platform: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub post_url: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub user_id: Option<String>,
}

#[derive(Serialize)]
pub struct SegmentPlatform {
  seg: String,
  platform: String,
}

fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
  app.path_resolver()
    .app_data_dir()
    .ok_or_else(|| "无法获取应用数据目录".to_string())
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app_dir(app)?.join("history.db"))
}
fn jsonl_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app_dir(app)?.join("downloads.jsonl"))
}

fn norm_path(p: &str) -> String {
  p.replace('/', "\\").to_lowercase()
}

fn insert_row(conn: &Connection, r: &HistRecord) -> rusqlite::Result<()> {
  conn.execute(
    "INSERT INTO hist(post_id,tweet_time,full_text,username,display_name,avatar,media_type,media_url,video_url,file_path,path_norm,file_name,downloaded_at,source,platform,post_url,user_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    rusqlite::params![
      r.post_id, r.tweet_time, r.full_text, r.username, r.display_name, r.avatar,
      r.media_type, r.media_url, r.video_url, r.file_path, norm_path(&r.file_path),
      r.file_name, r.downloaded_at, r.source, r.platform, r.post_url, r.user_id,
    ],
  )?;
  Ok(())
}

fn build_db(app: &AppHandle, path: &PathBuf) -> Result<(), String> {
  build_db_from(&app_dir(app)?, path)
}

fn build_db_from(dir: &PathBuf, path: &PathBuf) -> Result<(), String> {
  let jsonl = dir.join("downloads.jsonl");
  let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
  conn
    .execute_batch(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF;
       CREATE TABLE hist(
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         post_id TEXT, tweet_time TEXT, full_text TEXT, username TEXT, display_name TEXT,
         avatar TEXT, media_type TEXT, media_url TEXT, video_url TEXT,
         file_path TEXT, path_norm TEXT, file_name TEXT, downloaded_at INTEGER,
         source TEXT, platform TEXT, post_url TEXT, user_id TEXT);
       CREATE INDEX idx_hist_path ON hist(path_norm);
       CREATE INDEX idx_hist_time ON hist(tweet_time);",
    )
    .map_err(|e| e.to_string())?;
  if !jsonl.is_file() {
    return Ok(());
  }
  let f = std::fs::File::open(&jsonl).map_err(|e| e.to_string())?;
  let reader = std::io::BufReader::new(f);
  let tx = conn.transaction().map_err(|e| e.to_string())?;
  for line in reader.lines() {
    let line = match line {
      Ok(l) => l,
      Err(_) => continue,
    };
    let s = line.trim();
    if s.is_empty() {
      continue;
    }
    if let Ok(r) = serde_json::from_str::<HistRecord>(s) {
      if !r.post_id.is_empty() && !r.file_path.is_empty() {
        insert_row(&tx, &r).map_err(|e| e.to_string())?;
      }
    }
  }
  tx.commit().map_err(|e| e.to_string())?;
  Ok(())
}

fn ensure_db(app: &AppHandle) -> Result<Connection, String> {
  let path = db_path(app)?;
  if path.is_file() {
    return Connection::open(&path).map_err(|e| e.to_string());
  }
  let _g = BUILD_LOCK.lock().map_err(|_| "锁失败")?;
  if !path.is_file() {
    build_db(app, &path)?;
  }
  Connection::open(&path).map_err(|e| e.to_string())
}

const COLS: &str = "post_id,tweet_time,full_text,username,display_name,avatar,media_type,media_url,video_url,file_path,file_name,downloaded_at,source,platform,post_url,user_id";

fn row_to_record(r: &rusqlite::Row) -> rusqlite::Result<HistRecord> {
  Ok(HistRecord {
    post_id: r.get(0)?,
    tweet_time: r.get(1)?,
    full_text: r.get(2)?,
    username: r.get(3)?,
    display_name: r.get(4)?,
    avatar: r.get(5)?,
    media_type: r.get(6)?,
    media_url: r.get(7)?,
    video_url: r.get(8)?,
    file_path: r.get(9)?,
    file_name: r.get(10)?,
    downloaded_at: r.get(11)?,
    source: r.get(12)?,
    platform: r.get(13)?,
    post_url: r.get(14)?,
    user_id: r.get(15)?,
  })
}

/// 追加一条下载历史（入 SQLite + 追加写 jsonl）
#[tauri::command]
pub async fn hist_append(app: AppHandle, record: HistRecord) -> Result<(), String> {
  let conn = ensure_db(&app)?;
  insert_row(&conn, &record).map_err(|e| e.to_string())?;
  // 同时追加 jsonl（保留原始文件，便于备份/导出）
  let jsonl = jsonl_path(&app)?;
  if let Ok(s) = serde_json::to_string(&record) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&jsonl) {
      let _ = writeln!(f, "{s}");
    }
  }
  Ok(())
}

/// 时间流：取某时间点之后的记录（ISO 字符串按字典序即时间序）
#[tauri::command]
pub async fn hist_recent(
  app: AppHandle,
  since_iso: String,
  limit: i64,
) -> Result<Vec<HistRecord>, String> {
  let conn = ensure_db(&app)?;
  let sql = format!(
    "SELECT {COLS} FROM hist WHERE tweet_time >= ?1 ORDER BY tweet_time DESC{}",
    if limit > 0 { " LIMIT ?2" } else { "" }
  );
  let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  if limit > 0 {
    let mut rows = stmt.query(rusqlite::params![since_iso, limit]).map_err(|e| e.to_string())?;
    while let Some(r) = rows.next().map_err(|e| e.to_string())? {
      out.push(row_to_record(r).map_err(|e| e.to_string())?);
    }
  } else {
    let mut rows = stmt.query([&since_iso]).map_err(|e| e.to_string())?;
    while let Some(r) = rows.next().map_err(|e| e.to_string())? {
      out.push(row_to_record(r).map_err(|e| e.to_string())?);
    }
  }
  Ok(out)
}

/// 本地库：按文件路径批量取记录
#[tauri::command]
pub async fn hist_by_paths(
  app: AppHandle,
  paths: Vec<String>,
) -> Result<Vec<HistRecord>, String> {
  if paths.is_empty() {
    return Ok(vec![]);
  }
  let conn = ensure_db(&app)?;
  let norms: Vec<String> = paths.iter().map(|p| norm_path(p)).collect();
  let ph = (0..norms.len()).map(|i| format!("?{}", i + 1)).collect::<Vec<_>>().join(",");
  let sql = format!("SELECT {COLS} FROM hist WHERE path_norm IN ({ph})");
  let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
  let params: Vec<&dyn rusqlite::ToSql> = norms.iter().map(|n| n as &dyn rusqlite::ToSql).collect();
  let mut rows = stmt.query(params.as_slice()).map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  while let Some(r) = rows.next().map_err(|e| e.to_string())? {
    out.push(row_to_record(r).map_err(|e| e.to_string())?);
  }
  Ok(out)
}

/// 文件改名后同步历史记录里的路径（归档站文件名回溯用）
#[tauri::command]
pub async fn hist_rename_path(
  app: AppHandle,
  old_path: String,
  new_path: String,
) -> Result<(), String> {
  let conn = ensure_db(&app)?;
  let file_name = std::path::Path::new(&new_path)
    .file_name()
    .and_then(|s| s.to_str())
    .unwrap_or("")
    .to_string();
  conn.execute(
    "UPDATE hist SET file_path=?1, path_norm=?2, file_name=?3 WHERE path_norm=?4",
    rusqlite::params![
      new_path,
      norm_path(&new_path),
      file_name,
      norm_path(&old_path)
    ],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

/// 本地库顶层文件夹：取「一级段 → 平台」（每段取第一个非空平台）
#[tauri::command]
pub async fn hist_platform_segments(
  app: AppHandle,
  prefix: String,
) -> Result<Vec<SegmentPlatform>, String> {
  let conn = ensure_db(&app)?;
  let prefix_norm = norm_path(&prefix);
  let mut stmt = conn
    .prepare("SELECT path_norm, platform FROM hist WHERE platform IS NOT NULL AND path_norm LIKE ?")
    .map_err(|e| e.to_string())?;
  let like = format!("{prefix_norm}%");
  let mut rows = stmt.query([&like]).map_err(|e| e.to_string())?;
  let mut seen: std::collections::HashMap<String, String> = std::collections::HashMap::new();
  while let Some(r) = rows.next().map_err(|e| e.to_string())? {
    let p: String = r.get(0).map_err(|e| e.to_string())?;
    let platform: Option<String> = r.get(1).map_err(|e| e.to_string())?;
    let platform = match platform {
      Some(p) if !p.is_empty() => p,
      _ => continue,
    };
    let rest = &p[prefix_norm.len().min(p.len())..];
    let seg = rest.trim_start_matches('\\').split('\\').next().unwrap_or("");
    if !seg.is_empty() && !seen.contains_key(seg) {
      seen.insert(seg.to_string(), platform);
    }
  }
  Ok(
    seen
      .into_iter()
      .map(|(seg, platform)| SegmentPlatform { seg, platform })
      .collect(),
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn build_hist_probe() {
    let appdata = match std::env::var("APPDATA") {
      Ok(v) => v,
      Err(_) => return,
    };
    let dir = std::path::PathBuf::from(appdata).join("p-spider");
    if !dir.join("downloads.jsonl").is_file() {
      println!("无 jsonl，跳过");
      return;
    }
    let dbp = std::env::temp_dir().join("hist-test.db");
    let _ = std::fs::remove_file(&dbp);
    build_db_from(&dir, &dbp).expect("build");
    let conn = Connection::open(&dbp).unwrap();
    let n: i64 = conn
      .query_row("SELECT COUNT(1) FROM hist", [], |r| r.get(0))
      .unwrap();
    println!("hist={}", n);
    assert!(n > 0);
  }
}
