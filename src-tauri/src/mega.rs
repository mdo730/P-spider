//! MEGA 公开链接下载（自研，无外部程序）。
//!
//! 支持 folder / file 公开分享链接：
//! - folder：`?n=<文件夹句柄>` + `{"a":"f","c":1,"ca":1,"r":1}` 拿节点树；
//!   各节点 k 用「文件夹键」AES-ECB 解出节点键；属性用节点键 AES-CBC 解密。
//! - file：`{"a":"g","p":<文件句柄>}`；下载地址 `?n=<文件夹句柄>` + `{"a":"g","g":1,"n":<文件句柄>}`。
//! - 数据用节点键 AES-CTR（nonce=nodeKey[16..24]，从 0 开始）解密。
//!
//! 协议参考 megajs（MIT）。仅实现下载所需的最小子集。

use aes::cipher::{BlockDecrypt, KeyInit};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::Manager;
use tokio::io::AsyncWriteExt;

const API: &str = "https://g.api.mega.co.nz/cs";

/// 下载结果（返回给前端，供下载管理展示/打开）
#[derive(serde::Serialize)]
pub struct MegaResult {
  pub bytes: u64,
  pub count: usize,
  /// 顶层条目名（单个时用于「打开」；多个时为空 → 打开 mega 目录）
  pub root: String,
  pub is_dir: bool,
}

/// 向前端推送下载进度（id 为空则不发）
fn emit_progress(app: &tauri::AppHandle, id: &str, written: u64, total: u64) {
  if id.is_empty() {
    return;
  }
  let _ = app.emit_all(
    "mega-progress",
    json!({ "id": id, "written": written, "total": total }),
  );
}

fn b64(s: &str) -> Result<Vec<u8>, String> {
  let mut t = s.trim().replace('-', "+").replace('_', "/");
  while t.len() % 4 != 0 {
    t.push('=');
  }
  STANDARD.decode(t).map_err(|e| e.to_string())
}

/// AES 密钥 = key[0..16] XOR key[16..32]（不足按 0 补）
fn aes_key_from(key: &[u8]) -> [u8; 16] {
  let mut k = [0u8; 16];
  for i in 0..16 {
    let hi = key.get(i).copied().unwrap_or(0);
    let lo = key.get(16 + i).copied().unwrap_or(0);
    k[i] = hi ^ lo;
  }
  k
}

/// AES-128-ECB 就地解密（无填充，要求长度是 16 的倍数）
fn ecb_decrypt(key: &[u8; 16], data: &mut [u8]) {
  let cipher = aes::Aes128::new_from_slice(key).expect("aes key");
  for chunk in data.chunks_mut(16) {
    if chunk.len() != 16 {
      return;
    }
    let mut block = aes::cipher::generic_array::GenericArray::clone_from_slice(chunk);
    cipher.decrypt_block(&mut block);
    chunk.copy_from_slice(&block);
  }
}

/// AES-128-CBC 就地解密（IV 全 0，无填充）
fn cbc_decrypt(key: &[u8; 16], data: &mut [u8]) {
  use cbc::cipher::{BlockDecryptMut, KeyIvInit};
  type Dec = cbc::Decryptor<aes::Aes128>;
  if data.len() % 16 != 0 {
    return;
  }
  let mut d = Dec::new_from_slices(key, &[0u8; 16]).expect("cbc key/iv");
  for chunk in data.chunks_mut(16) {
    let block = aes::cipher::generic_array::GenericArray::from_mut_slice(chunk);
    d.decrypt_block_mut(block);
  }
}

/// 用「文件夹键」把节点的 k 解成节点键（去 "handle:" 前缀，多定义取最后一个）
fn node_key(folder_key: &[u8; 16], k: &str) -> Result<Vec<u8>, String> {
  let part = k.split('/').last().unwrap_or(k);
  let raw = part.rsplit(':').next().unwrap_or(part);
  let mut buf = b64(raw)?;
  ecb_decrypt(folder_key, &mut buf);
  Ok(buf)
}

/// 用节点键解密属性，返回 JSON（含 n=文件名）
fn parse_attrs(node_key: &[u8], a: &str) -> Option<Value> {
  let mut buf = b64(a).ok()?;
  let key = aes_key_from(node_key);
  cbc_decrypt(&key, &mut buf);
  let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
  let s = String::from_utf8_lossy(&buf[..end]).to_string();
  if !s.starts_with("MEGA{") {
    return None;
  }
  serde_json::from_str::<Value>(&s[4..]).ok()
}

fn build_client(proxy_url: Option<&str>) -> Result<reqwest::Client, String> {
  let mut b = reqwest::Client::builder()
    .connect_timeout(std::time::Duration::from_secs(20))
    .timeout(std::time::Duration::from_secs(600));
  if let Some(p) = proxy_url {
    if !p.is_empty() {
      b = b.proxy(reqwest::Proxy::all(p).map_err(|e| e.to_string())?);
    }
  }
  b.build().map_err(|e| e.to_string())
}

/// 组装 API URL（保留 sid 参数位，当前恒为空 → 匿名下载）
fn api_url(params: &str, sid: &str) -> String {
  if sid.is_empty() {
    format!("{API}?{params}")
  } else {
    format!("{API}?{params}&sid={sid}")
  }
}

enum MegaLink {
  Folder { handle: String, key: Vec<u8> },
  File { handle: String, key: Vec<u8> },
}

fn parse_link(url: &str) -> Result<MegaLink, String> {
  let u = url.trim();
  let hash_idx = u.find('#').ok_or("MEGA 链接缺少 #key")?;
  let head = &u[..hash_idx];
  let tail = &u[hash_idx + 1..];
  let key_str = tail.split("/file/").next().unwrap_or(tail);
  let key = b64(key_str)?;

  if let Some(i) = head.find("/folder/") {
    return Ok(MegaLink::Folder {
      handle: head[i + 8..].trim_end_matches('/').to_string(),
      key,
    });
  }
  if let Some(i) = head.find("/file/") {
    return Ok(MegaLink::File {
      handle: head[i + 6..].trim_end_matches('/').to_string(),
      key,
    });
  }
  if tail.starts_with("F!") {
    let parts: Vec<&str> = tail[2..].split('!').collect();
    return Ok(MegaLink::Folder {
      handle: parts[0].to_string(),
      key: b64(parts.get(1).copied().unwrap_or(""))?,
    });
  }
  Err("无法识别的 MEGA 链接格式".into())
}

/// 把 MEGA 数字错误码翻成中文提示
fn err_for(code: i64) -> String {
  let msg = match code {
    -3 => "MEGA 服务临时拥堵，请稍后重试",
    -4 => "请求过于频繁（限流），请稍后重试",
    -5 => "MEGA 请求失败",
    -6 => "并发请求过多，请稍后重试",
    -9 => "对象不存在（链接可能已失效）",
    -11 => "访问受限",
    -16 => "账号被封禁",
    -17 => "超出 MEGA 配额（带宽/存储），请换节点或稍后重试",
    -26 => "该账号启用了两步验证（暂不支持）",
    _ => "未知错误",
  };
  format!("MEGA 错误 {code}：{msg}")
}

async fn api_post(client: &reqwest::Client, url: &str, body: Value) -> Result<Value, String> {
  let resp = client
    .post(url)
    .header("Content-Type", "application/json")
    .json(&body)
    .send()
    .await
    .map_err(|e| e.to_string())?;
  let text = resp.text().await.map_err(|e| e.to_string())?;
  if text.trim().is_empty() {
    return Err("MEGA 返回空响应，请稍后重试或更换代理节点".into());
  }
  let v: Value = serde_json::from_str(&text).map_err(|e| format!("解析响应失败: {e}: {text}"))?;
  let first = match &v {
    Value::Array(a) => a.first().cloned().unwrap_or(Value::Null),
    Value::Object(_) => v.clone(),
    Value::Number(_) => v.clone(),
    _ => Value::Null,
  };
  if first.is_null() {
    return Err(format!("MEGA 响应为空: {text}"));
  }
  if first.is_number() {
    return Err(err_for(first.as_i64().unwrap_or(0)));
  }
  Ok(first)
}

fn sanitize(name: &str) -> String {
  let s: String = name
    .chars()
    .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
    .collect();
  let s = s.trim().to_string();
  if s.is_empty() {
    "unnamed".into()
  } else {
    s
  }
}

async fn download_file(
  app: &tauri::AppHandle,
  progress_id: &str,
  total: u64,
  done_before: u64,
  sid: &str,
  client: &reqwest::Client,
  folder_handle: &str,
  file_handle: &str,
  node_key_bytes: &[u8],
  size: u64,
  dest: &std::path::Path,
) -> Result<u64, String> {
  if size == 0 {
    tokio::fs::write(dest, b"").await.map_err(|e| e.to_string())?;
    return Ok(0);
  }
  // 重复检测：目标文件已存在且大小一致 → 跳过（批量/重跑不重复下载）
  if let Ok(meta) = tokio::fs::metadata(dest).await {
    if meta.len() == size {
      emit_progress(app, progress_id, done_before + size, total);
      return Ok(0);
    }
  }
  let body = json!([{ "a": "g", "g": 1, "n": file_handle }]);
  let resp = api_post(
    client,
    &api_url(&format!("n={folder_handle}&id=0"), sid),
    body,
  )
  .await?;
  let g = resp.get("g").and_then(|x| x.as_str()).ok_or("未取到下载地址")?;
  let res = client
    .get(format!("{g}/0-{}", size - 1))
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if res.status().as_u16() == 509 {
    return Err("MEGA 带宽限制（509），稍后再试".into());
  }
  if !res.status().is_success() {
    return Err(format!("下载失败，状态 {}", res.status()));
  }

  let key = aes_key_from(node_key_bytes);
  let mut iv = [0u8; 16];
  let nonce = node_key_bytes.get(16..24).unwrap_or(&[]);
  let n = nonce.len().min(8);
  iv[..n].copy_from_slice(&nonce[..n]);
  use ctr::cipher::{KeyIvInit, StreamCipher};
  let mut ctr =
    ctr::Ctr128BE::<aes::Aes128>::new_from_slices(&key, &iv).map_err(|e| e.to_string())?;

  let mut file = tokio::fs::File::create(dest).await.map_err(|e| e.to_string())?;
  let mut written = 0u64;
  let mut last_emit = 0u64;
  let mut stream = res.bytes_stream();
  while let Some(chunk) = stream.next().await {
    let mut c = chunk.map_err(|e| e.to_string())?.to_vec();
    ctr.apply_keystream(&mut c);
    file.write_all(&c).await.map_err(|e| e.to_string())?;
    written += c.len() as u64;
    // 每 ~256KB 推送一次进度，避免事件风暴
    if written - last_emit >= 262144 {
      emit_progress(app, progress_id, done_before + written, total);
      last_emit = written;
    }
  }
  file.flush().await.map_err(|e| e.to_string())?;
  emit_progress(app, progress_id, done_before + written.min(size), total);
  Ok(written)
}

/// 预统计文件夹下所有文件总大小（进度分母）
fn sum_file_sizes(nodes: &[Value], current: &str) -> u64 {
  let mut total = 0u64;
  for n in nodes
    .iter()
    .filter(|n| n.get("p").and_then(|p| p.as_str()) == Some(current))
  {
    let t = n.get("t").and_then(|v| v.as_u64()).unwrap_or(0);
    let h = n.get("h").and_then(|v| v.as_str()).unwrap_or("");
    let size = n.get("s").and_then(|v| v.as_u64()).unwrap_or(0);
    if t == 1 {
      total += sum_file_sizes(nodes, h);
    } else {
      total += size;
    }
  }
  total
}

fn walk_nodes<'a>(
  app: &'a tauri::AppHandle,
  progress_id: &'a str,
  total: u64,
  sid: &'a str,
  client: &'a reqwest::Client,
  nodes: &'a [Value],
  folder_key: &'a [u8; 16],
  share_handle: &'a str,
  current: &'a str,
  dir: std::path::PathBuf,
  count: &'a mut usize,
  bytes: &'a mut u64,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
  Box::pin(async move {
    for n in nodes
      .iter()
      .filter(|n| n.get("p").and_then(|p| p.as_str()) == Some(current))
    {
      let t = n.get("t").and_then(|v| v.as_u64()).unwrap_or(0);
      let h = n.get("h").and_then(|v| v.as_str()).unwrap_or("");
      let k = n.get("k").and_then(|v| v.as_str()).unwrap_or("");
      let size = n.get("s").and_then(|v| v.as_u64()).unwrap_or(0);
      let nk = node_key(folder_key, k)?;
      let name = parse_attrs(&nk, n.get("a").and_then(|v| v.as_str()).unwrap_or(""))
        .and_then(|a| a.get("n").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| h.to_string());
      let dest = dir.join(sanitize(&name));
      if t == 1 {
        tokio::fs::create_dir_all(&dest)
          .await
          .map_err(|e| e.to_string())?;
        walk_nodes(
          app,
          progress_id,
          total,
          sid,
          client,
          nodes,
          folder_key,
          share_handle,
          h,
          dest,
          count,
          bytes,
        )
        .await?;
      } else {
        let done_before = *bytes;
        *bytes += download_file(
          app,
          progress_id,
          total,
          done_before,
          sid,
          client,
          share_handle,
          h,
          &nk,
          size,
          &dest,
        )
        .await?;
        *count += 1;
      }
    }
    Ok(())
  })
}

#[tauri::command]
pub async fn mega_download(
  app: tauri::AppHandle,
  url: String,
  out_dir: String,
  proxy_url: Option<String>,
  progress_id: Option<String>,
) -> Result<MegaResult, String> {
  let pid = progress_id.unwrap_or_default();
  let sid = String::new();
  let client = build_client(proxy_url.as_deref())?;
  let link = parse_link(&url)?;
  tokio::fs::create_dir_all(&out_dir)
    .await
    .map_err(|e| e.to_string())?;
  let base = std::path::PathBuf::from(&out_dir);

  let mut count = 0usize;
  let mut bytes = 0u64;
  let mut root = String::new();
  let mut is_dir = false;

  match link {
    MegaLink::File { handle, key } => {
      let body = json!([{ "a": "g", "p": handle }]);
      let resp = api_post(&client, &api_url("id=0", &sid), body).await?;
      let size = resp.get("s").and_then(|v| v.as_u64()).unwrap_or(0);
      let at = resp.get("at").and_then(|v| v.as_str()).unwrap_or("");
      let name = parse_attrs(&key, at)
        .and_then(|a| a.get("n").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| handle.clone());
      let dest = base.join(sanitize(&name));
      bytes += download_file(
        &app, &pid, size, 0, &sid, &client, &handle, &handle, &key, size, &dest,
      )
      .await?;
      count += 1;
      root = name;
    }
    MegaLink::Folder { handle, key } => {
      let folder_key = aes_key_from(&key);
      let body = json!([{ "a": "f", "c": 1, "ca": 1, "r": 1 }]);
      let resp = api_post(
        &client,
        &api_url(&format!("n={handle}&id=0"), &sid),
        body,
      )
      .await?;
      let nodes = resp
        .get("f")
        .and_then(|v| v.as_array())
        .ok_or("文件夹响应缺少 f")?
        .clone();

      let handles: std::collections::HashSet<&str> = nodes
        .iter()
        .filter_map(|n| n.get("h").and_then(|h| h.as_str()))
        .collect();
      let walk_root = nodes
        .iter()
        .find(|n| {
          n.get("p")
            .and_then(|p| p.as_str())
            .map(|p| !handles.contains(p))
            .unwrap_or(true)
        })
        .and_then(|n| n.get("h").and_then(|h| h.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| handle.clone());

      let total = sum_file_sizes(&nodes, &walk_root);

      // 顶层条目（用于「打开」）：唯一时取名，多个时留空（打开 mega 目录）
      let tops: Vec<&Value> = nodes
        .iter()
        .filter(|n| n.get("p").and_then(|p| p.as_str()) == Some(walk_root.as_str()))
        .collect();
      is_dir = true;
      if tops.len() == 1 {
        let n = tops[0];
        let k = n.get("k").and_then(|v| v.as_str()).unwrap_or("");
        let nk = node_key(&folder_key, k)?;
        let name = parse_attrs(&nk, n.get("a").and_then(|v| v.as_str()).unwrap_or(""))
          .and_then(|a| a.get("n").and_then(|v| v.as_str()).map(|s| s.to_string()));
        if let Some(name) = name {
          root = sanitize(&name);
        }
        is_dir = n.get("t").and_then(|v| v.as_u64()).unwrap_or(0) == 1;
      }

      walk_nodes(
        &app,
        &pid,
        total,
        &sid,
        &client,
        &nodes,
        &folder_key,
        &handle,
        &walk_root,
        base.clone(),
        &mut count,
        &mut bytes,
      )
      .await?;
    }
  }

  Ok(MegaResult {
    bytes,
    count,
    root,
    is_dir,
  })
}

