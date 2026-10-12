//! hpoi 离线索引（SQLite）。
//!
//! 首次使用时把 `appData/hpoi-index/*.json` 建成 `hpoi-index.db`，之后只查库，
//! JS 不再把 77MB 索引读进 WebView 内存。
//! 匹配逻辑与原前端 `hpoi-search.ts` 对齐：归一化（normHpoi）→ 子串 AND + 位置打分。

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use unicode_normalization::UnicodeNormalization;

static BUILD_LOCK: Mutex<()> = Mutex::new(());

const PUNCT: &[char] = &[
  '「', '」', '『', '』', '（', '）', '(', ')', '[', ']', '【', '】', '·', '・', ':', '：', ',', '，',
  '。', '.', '!', '！', '?', '？', '~', '～', '-', '_', '/', '\\', '\'', '"', '’', '“', '”', '&',
  '+',
];

/// 与前端 normHpoi 一致：NFKC + 小写 + 去空白/标点
fn norm_hpoi(s: &str) -> String {
  let nfkc: String = s.nfkc().collect();
  let mut out = String::with_capacity(nfkc.len());
  for c in nfkc.chars() {
    if c.is_whitespace() {
      continue;
    }
    let lc: char = c.to_lowercase().next().unwrap_or(c);
    if PUNCT.contains(&lc) {
      continue;
    }
    out.push(lc);
  }
  out
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HpoiHit {
  kind: String,
  id: i64,
  name: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  name_ja: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  company_name: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  category: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  cover: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  release_date: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  filter_id: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  hits: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  hits_day: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  hits7_day: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  rating: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  collect: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  refs: Option<Vec<String>>,
  score: i64,
}

#[derive(Serialize)]
pub struct EntityName {
  id: i64,
  name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityInfo {
  id: i64,
  name: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  cover: Option<String>,
}

#[derive(Serialize)]
pub struct KindCount {
  kind: String,
  count: i64,
}

fn index_dir(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(
    app.path_resolver()
      .app_data_dir()
      .ok_or_else(|| "无法获取应用数据目录".to_string())?
      .join("hpoi-index"),
  )
}
fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(index_dir(app)?.join("hpoi-index.db"))
}

fn non_empty(s: Option<String>) -> Option<String> {
  s.filter(|x| !x.is_empty())
}

fn read_items(dir: &PathBuf, kind: &str) -> Result<Vec<Value>, String> {
  let p = dir.join(format!("{kind}.json"));
  if !p.is_file() {
    return Ok(vec![]);
  }
  let text = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
  let j: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
  Ok(
    j.get("items")
      .and_then(|v| v.as_array())
      .cloned()
      .unwrap_or_default(),
  )
}

fn s_of(v: &Value) -> Option<String> {
  v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
}
fn i_of(v: &Value) -> i64 {
  v.as_i64().unwrap_or(0)
}
fn f_of(v: &Value) -> f64 {
  v.as_f64().unwrap_or(0.0)
}

const HOBBY_COLS: &str =
  "id,name,name_ja,company,category,cover,release_date,search_norm,name_norm,refs,hits,hits_day,hits7_day,rating,collect";

fn build_db(app: &AppHandle, path: &PathBuf) -> Result<(), String> {
  build_db_dir(&index_dir(app)?, path)
}

fn build_db_dir(dir: &PathBuf, path: &PathBuf) -> Result<(), String> {
  let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
  conn
    .execute_batch(
      "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
       CREATE TABLE hobby(id INTEGER PRIMARY KEY, name TEXT, name_ja TEXT,
         company TEXT, category TEXT, cover TEXT, release_date TEXT,
         search_norm TEXT, name_norm TEXT, refs TEXT,
         hits INTEGER, hits_day INTEGER, hits7_day INTEGER, rating REAL, collect INTEGER);
       CREATE TABLE entity(kind TEXT, id INTEGER, name TEXT, cover TEXT,
         filter_id INTEGER, search_norm TEXT, name_norm TEXT);
       CREATE TABLE hobby_ref(hobby_id INTEGER, tag TEXT);
       CREATE UNIQUE INDEX idx_entity_kind_id ON entity(kind,id);
       CREATE INDEX idx_ref_tag ON hobby_ref(tag);",
    )
    .map_err(|e| e.to_string())?;

  let tx = conn.transaction().map_err(|e| e.to_string())?;
  {
    let items = read_items(dir, "hobby")?;
    let mut ins = tx
      .prepare(
        "INSERT OR REPLACE INTO hobby(id,name,name_ja,company,category,cover,release_date,search_norm,name_norm,refs,hits,hits_day,hits7_day,rating,collect)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .map_err(|e| e.to_string())?;
    let mut ins_ref = tx
      .prepare("INSERT INTO hobby_ref(hobby_id,tag) VALUES(?,?)")
      .map_err(|e| e.to_string())?;
    for row in items {
      let a = match row.as_array() {
        Some(a) => a,
        None => continue,
      };
      let g = |i: usize| a.get(i).unwrap_or(&Value::Null);
      let id = i_of(g(0));
      let name = s_of(g(1)).unwrap_or_default();
      let refs = g(7).as_array().cloned().unwrap_or_default();
      let refs_json = serde_json::to_string(&refs).unwrap_or_else(|_| "[]".into());
      ins
        .execute(rusqlite::params![
          id,
          name,
          s_of(g(2)),
          s_of(g(3)),
          s_of(g(4)),
          s_of(g(5)),
          s_of(g(6)),
          s_of(g(8)).unwrap_or_default(),
          norm_hpoi(&name),
          refs_json,
          i_of(g(9)),
          i_of(g(10)),
          i_of(g(11)),
          f_of(g(12)),
          i_of(g(13)),
        ])
        .map_err(|e| e.to_string())?;
      for r in refs {
        if let Some(tag) = r.as_str() {
          ins_ref
            .execute(rusqlite::params![id, tag])
            .map_err(|e| e.to_string())?;
        }
      }
    }
  }
  for kind in ["company", "series", "works", "charactar", "person"] {
    let items = read_items(dir, kind)?;
    let mut ins = tx
      .prepare("INSERT OR REPLACE INTO entity(kind,id,name,cover,filter_id,search_norm,name_norm) VALUES(?,?,?,?,?,?,?)")
      .map_err(|e| e.to_string())?;
    for row in items {
      let a = match row.as_array() {
        Some(a) => a,
        None => continue,
      };
      let g = |i: usize| a.get(i).unwrap_or(&Value::Null);
      let name = s_of(g(1)).unwrap_or_default();
      let (filter_id, norm_idx) = if kind == "company" {
        (Some(i_of(g(3))), 4)
      } else {
        (None, 3)
      };
      ins
        .execute(rusqlite::params![
          kind,
          i_of(g(0)),
          name,
          s_of(g(2)),
          filter_id,
          s_of(g(norm_idx)).unwrap_or_default(),
          norm_hpoi(&name),
        ])
        .map_err(|e| e.to_string())?;
    }
  }
  // 并入增量 delta.json（主快照之后新增/补抓的条目，同格式）
  if let Ok(delta) = read_delta(dir) {
    let mut ins_h = tx
      .prepare(
        "INSERT OR REPLACE INTO hobby(id,name,name_ja,company,category,cover,release_date,search_norm,name_norm,refs,hits,hits_day,hits7_day,rating,collect)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .map_err(|e| e.to_string())?;
    let mut ins_ref = tx
      .prepare("INSERT INTO hobby_ref(hobby_id,tag) VALUES(?,?)")
      .map_err(|e| e.to_string())?;
    for row in delta.get("hobbies").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
      let a = match row.as_array() {
        Some(a) => a,
        None => continue,
      };
      let g = |i: usize| a.get(i).unwrap_or(&Value::Null);
      let id = i_of(g(0));
      let name = s_of(g(1)).unwrap_or_default();
      let refs = g(7).as_array().cloned().unwrap_or_default();
      let refs_json = serde_json::to_string(&refs).unwrap_or_else(|_| "[]".into());
      ins_h
        .execute(rusqlite::params![
          id, name, s_of(g(2)), s_of(g(3)), s_of(g(4)), s_of(g(5)), s_of(g(6)),
          s_of(g(8)).unwrap_or_default(), norm_hpoi(&name), refs_json,
          i_of(g(9)), i_of(g(10)), i_of(g(11)), f_of(g(12)), i_of(g(13)),
        ])
        .map_err(|e| e.to_string())?;
      for r in refs {
        if let Some(tag) = r.as_str() {
          ins_ref.execute(rusqlite::params![id, tag]).map_err(|e| e.to_string())?;
        }
      }
    }
    let mut ins_e = tx
      .prepare("INSERT OR REPLACE INTO entity(kind,id,name,cover,filter_id,search_norm,name_norm) VALUES(?,?,?,?,?,?,?)")
      .map_err(|e| e.to_string())?;
    for (kind, key, norm_idx) in [
      ("company", "company", 4usize),
      ("series", "series", 3),
      ("works", "works", 3),
      ("charactar", "charactar", 3),
      ("person", "person", 3),
    ] {
      for row in delta.get(key).and_then(|v| v.as_array()).cloned().unwrap_or_default() {
        let a = match row.as_array() {
          Some(a) => a,
          None => continue,
        };
        let g = |i: usize| a.get(i).unwrap_or(&Value::Null);
        let name = s_of(g(1)).unwrap_or_default();
        let filter_id = if kind == "company" { Some(i_of(g(3))) } else { None };
        ins_e
          .execute(rusqlite::params![
            kind, i_of(g(0)), name, s_of(g(2)), filter_id,
            s_of(g(norm_idx)).unwrap_or_default(), norm_hpoi(&name),
          ])
          .map_err(|e| e.to_string())?;
      }
    }
  }
  tx.commit().map_err(|e| e.to_string())?;
  Ok(())
}

fn read_delta(dir: &PathBuf) -> Result<Value, String> {
  let p = dir.join("delta.json");
  if !p.is_file() {
    return Ok(Value::Null);
  }
  let text = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
  serde_json::from_str(&text).map_err(|e| e.to_string())
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

fn parse_refs(s: Option<String>) -> Option<Vec<String>> {
  s.and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
    .filter(|v| !v.is_empty())
}

fn kind_weight(kind: &str) -> i64 {
  match kind {
    "hobby" => 3,
    "company" => 2,
    _ => 1,
  }
}

fn score_tokens(hay: &str, name_norm: &str, tokens: &[String]) -> Option<i64> {
  let mut score = 0i64;
  for t in tokens {
    if !hay.contains(t.as_str()) {
      return None;
    }
    score += if hay.starts_with(t.as_str()) { 3 } else { 1 };
  }
  if tokens.len() == 1 && name_norm == tokens[0] {
    score += 6;
  } else if name_norm.starts_with(tokens[0].as_str()) {
    score += 2;
  }
  Some(score)
}

/// 从查询行构造 hobby 命中（列顺序 = HOBBY_COLS）
fn hobby_from_row(r: &rusqlite::Row, score: i64) -> rusqlite::Result<HpoiHit> {
  Ok(HpoiHit {
    kind: "hobby".into(),
    id: r.get(0)?,
    name: r.get(1)?,
    name_ja: non_empty(r.get::<_, Option<String>>(2)?),
    company_name: non_empty(r.get::<_, Option<String>>(3)?),
    category: non_empty(r.get::<_, Option<String>>(4)?),
    cover: non_empty(r.get::<_, Option<String>>(5)?),
    release_date: non_empty(r.get::<_, Option<String>>(6)?),
    filter_id: None,
    hits: Some(r.get(10)?),
    hits_day: Some(r.get(11)?),
    hits7_day: Some(r.get(12)?),
    rating: Some(r.get(13)?),
    collect: Some(r.get(14)?),
    refs: parse_refs(Some(r.get(9)?)),
    score,
  })
}

fn entity_from_row(kind: &str, r: &rusqlite::Row) -> rusqlite::Result<HpoiHit> {
  Ok(HpoiHit {
    kind: kind.into(),
    id: r.get(0)?,
    name: r.get(1)?,
    name_ja: None,
    company_name: None,
    category: None,
    cover: non_empty(r.get::<_, Option<String>>(2)?),
    release_date: None,
    filter_id: r.get::<_, Option<i64>>(3)?,
    hits: None,
    hits_day: None,
    hits7_day: None,
    rating: None,
    collect: None,
    refs: None,
    score: 0,
  })
}

#[tauri::command]
pub async fn hpoi_search(
  app: AppHandle,
  tokens: Vec<String>,
  limit: usize,
) -> Result<Vec<HpoiHit>, String> {
  let tokens: Vec<String> = tokens.into_iter().filter(|t| !t.is_empty()).collect();
  if tokens.is_empty() {
    return Ok(vec![]);
  }
  let conn = ensure_db(&app)?;
  let mut hits: Vec<HpoiHit> = Vec::new();

  // hobby
  {
    let where_clause = (0..tokens.len())
      .map(|i| format!("instr(search_norm, ?{}) > 0", i + 1))
      .collect::<Vec<_>>()
      .join(" AND ");
    let sql = format!("SELECT {HOBBY_COLS} FROM hobby WHERE {where_clause}");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params: Vec<&dyn rusqlite::ToSql> =
      tokens.iter().map(|t| t as &dyn rusqlite::ToSql).collect();
    let mut rows = stmt.query(params.as_slice()).map_err(|e| e.to_string())?;
    while let Some(r) = rows.next().map_err(|e| e.to_string())? {
      let hay: String = r.get(7).map_err(|e| e.to_string())?;
      let name_norm: String = r.get(8).map_err(|e| e.to_string())?;
      if let Some(mut score) = score_tokens(&hay, &name_norm, &tokens) {
        score += kind_weight("hobby");
        hits.push(hobby_from_row(r, score).map_err(|e| e.to_string())?);
      }
    }
  }

  // entities
  for kind in ["company", "series", "works", "charactar", "person"] {
    let where_clause = (0..tokens.len())
      .map(|i| format!("instr(search_norm, ?{}) > 0", i + 2))
      .collect::<Vec<_>>()
      .join(" AND ");
    let sql = format!(
      "SELECT id,name,cover,filter_id,search_norm,name_norm FROM entity WHERE kind=?1 AND {where_clause}"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut params: Vec<&dyn rusqlite::ToSql> = vec![&kind];
    for t in &tokens {
      params.push(t);
    }
    let mut rows = stmt.query(params.as_slice()).map_err(|e| e.to_string())?;
    while let Some(r) = rows.next().map_err(|e| e.to_string())? {
      let hay: String = r.get(4).map_err(|e| e.to_string())?;
      let name_norm: String = r.get(5).map_err(|e| e.to_string())?;
      if let Some(mut score) = score_tokens(&hay, &name_norm, &tokens) {
        score += kind_weight(kind);
        let mut hit = entity_from_row(kind, r).map_err(|e| e.to_string())?;
        hit.score = score;
        hits.push(hit);
      }
    }
  }

  hits.sort_by(|a, b| {
    b.score
      .cmp(&a.score)
      .then_with(|| b.release_date.cmp(&a.release_date))
  });
  hits.truncate(limit);
  Ok(hits)
}

#[tauri::command]
pub async fn hpoi_list_by_ref(
  app: AppHandle,
  kind: String,
  id: i64,
) -> Result<Vec<HpoiHit>, String> {
  let tag = match kind.as_str() {
    "company" => "c",
    "series" => "s",
    "works" => "w",
    "charactar" => "h",
    "person" => "p",
    _ => return Ok(vec![]),
  };
  let tag = format!("{tag}:{id}");
  let conn = ensure_db(&app)?;
  let sql = format!(
    "SELECT {} FROM hobby h JOIN hobby_ref r ON r.hobby_id=h.id WHERE r.tag=?",
    HOBBY_COLS
      .split(',')
      .map(|c| if c == "id" { "h.id".to_string() } else { format!("h.{c}") })
      .collect::<Vec<_>>()
      .join(",")
  );
  let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
  let mut rows = stmt.query([&tag]).map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  while let Some(r) = rows.next().map_err(|e| e.to_string())? {
    out.push(hobby_from_row(r, 0).map_err(|e| e.to_string())?);
  }
  Ok(out)
}

#[tauri::command]
pub async fn hpoi_entity_names(
  app: AppHandle,
  kind: String,
  ids: Vec<i64>,
) -> Result<Vec<EntityName>, String> {
  let conn = ensure_db(&app)?;
  let mut stmt = conn
    .prepare("SELECT name FROM entity WHERE kind=?1 AND id=?2 LIMIT 1")
    .map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  for id in ids {
    if let Some(name) = stmt
      .query_row(rusqlite::params![kind, id], |r| r.get::<_, String>(0))
      .optional()
      .map_err(|e| e.to_string())?
    {
      out.push(EntityName { id, name });
    }
  }
  Ok(out)
}

#[tauri::command]
pub async fn hpoi_entity_info(
  app: AppHandle,
  kind: String,
  ids: Vec<i64>,
) -> Result<Vec<EntityInfo>, String> {
  let conn = ensure_db(&app)?;
  let mut stmt = conn
    .prepare("SELECT name,cover FROM entity WHERE kind=?1 AND id=?2 LIMIT 1")
    .map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  for id in ids {
    if let Some((name, cover)) = stmt
      .query_row(rusqlite::params![kind, id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
      })
      .optional()
      .map_err(|e| e.to_string())?
    {
      out.push(EntityInfo {
        id,
        name,
        cover: non_empty(cover),
      });
    }
  }
  Ok(out)
}

#[tauri::command]
pub async fn hpoi_hits_by_ids(
  app: AppHandle,
  kind: String,
  ids: Vec<i64>,
) -> Result<Vec<HpoiHit>, String> {
  let conn = ensure_db(&app)?;
  let mut map: std::collections::HashMap<i64, HpoiHit> = std::collections::HashMap::new();
  if kind == "hobby" {
    let sql = format!("SELECT {HOBBY_COLS} FROM hobby WHERE id=?1");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    for id in &ids {
      if let Some(hit) = stmt
        .query_row([id], |r| hobby_from_row(r, 0))
        .optional()
        .map_err(|e| e.to_string())?
      {
        map.insert(*id, hit);
      }
    }
  } else {
    let mut stmt = conn
      .prepare("SELECT id,name,cover,filter_id FROM entity WHERE kind=?1 AND id=?2 LIMIT 1")
      .map_err(|e| e.to_string())?;
    for id in &ids {
      if let Some(hit) = stmt
        .query_row(rusqlite::params![kind, id], |r| entity_from_row(&kind, r))
        .optional()
        .map_err(|e| e.to_string())?
      {
        map.insert(*id, hit);
      }
    }
  }
  Ok(ids.into_iter().filter_map(|id| map.remove(&id)).collect())
}

#[tauri::command]
pub async fn hpoi_hobby_refs(app: AppHandle, id: i64) -> Result<Option<Vec<String>>, String> {
  let conn = ensure_db(&app)?;
  let refs: Option<String> = conn
    .query_row("SELECT refs FROM hobby WHERE id=?1 LIMIT 1", [id], |r| r.get(0))
    .optional()
    .map_err(|e| e.to_string())?
    .flatten();
  Ok(parse_refs(refs))
}

#[tauri::command]
pub async fn hpoi_counts(app: AppHandle) -> Result<Vec<KindCount>, String> {
  let conn = ensure_db(&app)?;
  let mut out = Vec::new();
  let hobby: i64 = conn
    .query_row("SELECT COUNT(*) FROM hobby", [], |r| r.get(0))
    .unwrap_or(0);
  out.push(KindCount {
    kind: "hobby".into(),
    count: hobby,
  });
  let mut stmt = conn
    .prepare("SELECT kind, COUNT(*) FROM entity GROUP BY kind")
    .map_err(|e| e.to_string())?;
  let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(r) = rows.next().map_err(|e| e.to_string())? {
      out.push(KindCount {
        kind: r.get::<_, String>(0).map_err(|e| e.to_string())?,
        count: r.get::<_, i64>(1).map_err(|e| e.to_string())?,
      });
    }
  Ok(out)
}

/// 批量取 hobby refs（Timeline 收藏过滤用）
#[tauri::command]
pub async fn hpoi_hobby_refs_batch(
  app: AppHandle,
  ids: Vec<i64>,
) -> Result<Vec<(i64, Vec<String>)>, String> {
  let conn = ensure_db(&app)?;
  let mut stmt = conn
    .prepare("SELECT refs FROM hobby WHERE id=?1 LIMIT 1")
    .map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  for id in ids {
    let refs: Option<String> = stmt
      .query_row([id], |r| r.get::<_, Option<String>>(0))
      .optional()
      .map_err(|e| e.to_string())?
      .flatten();
    if let Some(v) = parse_refs(refs) {
      out.push((id, v));
    }
  }
  Ok(out)
}

/// 重置：删掉 DB（导入新索引后调用，下次查询重建）
#[tauri::command]
pub fn hpoi_db_reset(app: AppHandle) -> Result<(), String> {
  let path = db_path(&app)?;
  if path.is_file() {
    std::fs::remove_file(&path).map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn build_db_probe() {
    let appdata = match std::env::var("APPDATA") {
      Ok(v) => v,
      Err(_) => return,
    };
    let dir = std::path::PathBuf::from(appdata)
      .join("p-spider")
      .join("hpoi-index");
    if !dir.join("hobby.json").is_file() {
      println!("无索引，跳过");
      return;
    }
    let dbp = std::env::temp_dir().join("hpoi-test.db");
    let _ = std::fs::remove_file(&dbp);
    build_db_dir(&dir, &dbp).expect("build");
    let conn = Connection::open(&dbp).unwrap();
    let n: i64 = conn
      .query_row("SELECT COUNT(*) FROM hobby", [], |r| r.get(0))
      .unwrap();
    let c: i64 = conn
      .query_row("SELECT COUNT(*) FROM entity WHERE kind='company'", [], |r| {
        r.get(0)
      })
      .unwrap();
    println!("hobby={} company={}", n, c);
    assert!(n > 0);
  }
}
