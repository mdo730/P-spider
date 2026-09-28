// 以图搜图：本地图/远程图 → 上传到 Yandex 拿公开 URL → 调各搜索引擎。
// 能稳定解析的（SauceNAO / iqdb / trace.moe）返回结构化条目；其余只返回“结果页 URL”交给浏览器。
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

/// 启动参数里传来的待搜图路径（资源管理器右键调用）
static IMAGE_SEARCH_ARG: Mutex<Option<String>> = Mutex::new(None);

pub fn capture_cli_args(args: &[String]) {
  if let Some(i) = args.iter().position(|a| a == "--image-search") {
    if let Some(p) = args.get(i + 1) {
      if let Ok(mut g) = IMAGE_SEARCH_ARG.lock() {
        *g = Some(p.clone());
      }
    }
  }
}

#[tauri::command]
pub fn take_image_search_arg() -> Option<String> {
  IMAGE_SEARCH_ARG.lock().ok().and_then(|mut g| g.take())
}

/// 本进程启动参数里的待搜图路径（不取走；用于“二次实例”转发判断）
pub fn current_arg() -> Option<String> {
  IMAGE_SEARCH_ARG.lock().ok().and_then(|g| g.clone())
}

/// 把路径通过控制端口转发给已在运行的实例
pub fn forward_arg(path: &str) {
  if let Ok(mut s) = TcpStream::connect("127.0.0.1:6803") {
    let _ = s.write_all(format!("{path}\n").as_bytes());
  }
}

/// 已运行实例收到、待前端处理的搜图请求队列
static PENDING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// 启动单实例控制监听（固定端口 6803）；返回是否为主实例
pub fn start_control_listener() -> bool {
  match TcpListener::bind("127.0.0.1:6803") {
    Ok(listener) => {
      thread::spawn(move || {
        for stream in listener.incoming().flatten() {
          let mut line = String::new();
          if BufReader::new(&stream).read_line(&mut line).is_ok() {
            let p = line.trim();
            if !p.is_empty() {
              if let Ok(mut q) = PENDING.lock() {
                q.push(p.to_string());
              }
            }
          }
        }
      });
      true
    }
    Err(_) => false,
  }
}

#[tauri::command]
pub fn take_pending_image_search() -> Option<String> {
  PENDING
    .lock()
    .ok()
    .and_then(|mut q| (!q.is_empty()).then(|| q.remove(0)))
}

/// 添加/移除 Windows 资源管理器图片右键「用 P-Spider 以图搜图」（HKCU，免管理员）。
/// 同时注册到 SystemFileAssociations\image 与各图片扩展名（webp/avif 等不被 image 感知类型覆盖）。
#[tauri::command]
pub fn set_image_search_explorer_menu(enabled: bool) -> Result<bool, String> {
  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  const EXTS: [&str; 13] = [
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "jfif", "tif", "tiff", "heic", "jxl",
    "svg",
  ];
  // 感知类型 + 每扩展名两种写法（Software\Classes\.ext 与 SystemFileAssociations\.ext）
  let mut roots: Vec<String> = vec![
    r"SystemFileAssociations\image".to_string(),
    r"SystemFileAssociations\.jpeg".to_string(),
  ];
  for e in EXTS {
    roots.push(format!(".{e}"));
    roots.push(format!("SystemFileAssociations\\.{e}"));
  }
  if enabled {
    let exe = std::env::current_exe()
      .map_err(|e| e.to_string())?
      .display()
      .to_string();
    for root in &roots {
      let path = format!("Software\\Classes\\{root}\\shell\\PSpiderImageSearch");
      let (key, _) = hkcu.create_subkey(&path).map_err(|e| e.to_string())?;
      key
        .set_value("", &"用 P-Spider 以图搜图")
        .map_err(|e| e.to_string())?;
      let _ = key.set_value("Icon", &exe);
      let (cmd, _) = key.create_subkey("command").map_err(|e| e.to_string())?;
      cmd
        .set_value("", &format!("\"{}\" --image-search \"%1\"", exe))
        .map_err(|e| e.to_string())?;
    }
  } else {
    for root in &roots {
      let path = format!("Software\\Classes\\{root}\\shell\\PSpiderImageSearch");
      let _ = hkcu.delete_subkey_all(&path);
    }
  }
  Ok(true)
}

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

#[derive(Serialize, Clone)]
pub struct SearchItem {
  pub thumb: String,
  pub url: String,
  pub title: String,
  pub similarity: Option<f64>,
}

#[derive(Serialize)]
pub struct EngineResult {
  pub engine: String,
  pub items: Vec<SearchItem>,
  pub page_url: Option<String>,
  pub error: Option<String>,
}

fn build_client(proxy: &str) -> Result<reqwest::blocking::Client, String> {
  let mut b = reqwest::blocking::Client::builder()
    .connect_timeout(Duration::from_secs(15))
    .timeout(Duration::from_secs(90))
    .user_agent(UA);
  if !proxy.is_empty() {
    b = b.proxy(reqwest::Proxy::all(proxy).map_err(|e| e.to_string())?);
  }
  b.build().map_err(|e| e.to_string())
}

fn enc(s: &str) -> String {
  let mut out = String::with_capacity(s.len());
  for byte in s.bytes() {
    let c = byte as char;
    if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
      out.push(c);
    } else {
      out.push_str(&format!("%{:02X}", byte));
    }
  }
  out
}

fn strip_tags(s: &str) -> String {
  let re = Regex::new(r"<[^>]+>").unwrap();
  re.replace_all(s, "").trim().to_string()
}

/// 拿到图片的公开 URL：远程直接用；本地图上传到 Yandex 图床（同时返回 Yandex 结果页）
fn get_public_url(input: &str, proxy: &str) -> Result<(String, String), String> {
  if input.starts_with("http://") || input.starts_with("https://") {
    return Ok((input.to_string(), String::new()));
  }
  let client = build_client(proxy)?;
  let form = reqwest::blocking::multipart::Form::new()
    .file("upfile", input)
    .map_err(|e| format!("读取本地图片失败：{e}"))?;
  let upload_url = "https://yandex.ru/images/search?rpt=imageview&format=json&request=%7B%22blocks%22%3A%5B%7B%22block%22%3A%22b-page_type_search-by-image__link%22%7D%5D%7D";
  let resp = client
    .post(upload_url)
    .multipart(form)
    .send()
    .map_err(|e| format!("上传到 Yandex 失败：{e}"))?;
  let v: Value = resp.json().map_err(|e| format!("Yandex 返回异常：{e}"))?;
  let p = &v["blocks"][0]["params"];
  let pubu = p["originalImageUrl"]
    .as_str()
    .or_else(|| p["imageUrl"].as_str())
    .ok_or_else(|| "Yandex 上传未返回图片地址".to_string())?
    .to_string();
  let cbir = p["cbirId"].as_str().unwrap_or("").to_string();
  let page = if cbir.is_empty() {
    String::new()
  } else {
    format!(
      "https://yandex.ru/images/search?rpt=imageview&cbir_id={}",
      cbir
    )
  };
  Ok((pubu, page))
}

/// 解析 Yandex CBIR 结果页：站点命中(CbirSites) + 相似图(CbirSimilar)
fn yandex_items(page_url: &str, proxy: &str) -> Result<Vec<SearchItem>, String> {
  let client = build_client(proxy)?;
  let html = client
    .get(page_url)
    .header("Accept-Language", "ru")
    .send()
    .map_err(|e| e.to_string())?
    .text()
    .map_err(|e| e.to_string())?;
  let re_href = Regex::new(r#"href="(https?://[^"]+)""#).unwrap();
  let re_img = Regex::new(r#"<img[^>]+src="([^"]+)""#).unwrap();
  let re_title = Regex::new(r#"(?s)CbirSites-ItemTitle[^>]*>(.*?)</a>"#).unwrap();
  let fix = |u: &str| -> String {
    if u.starts_with("//") {
      format!("https:{u}")
    } else {
      u.to_string()
    }
  };
  let mut items = vec![];
  // 站点命中
  for chunk in html.split("class=\"CbirSites-Item\"").skip(1) {
    let url = re_href
      .captures(chunk)
      .map(|c| c[1].to_string())
      .unwrap_or_default();
    let thumb = re_img
      .captures(chunk)
      .map(|c| fix(&c[1]))
      .unwrap_or_default();
    let title = re_title
      .captures(chunk)
      .map(|c| strip_tags(&c[1]))
      .unwrap_or_default();
    if url.is_empty() && thumb.is_empty() {
      continue;
    }
    items.push(SearchItem {
      thumb,
      url,
      title,
      similarity: None,
    });
  }
  // 相似图
  if let Some(pos) = html.find("CbirSimilarList-Thumbs") {
    let tail = &html[pos..];
    let end = tail.find("</section>").unwrap_or(tail.len());
    let seg = &tail[..end];
    let mut seen = std::collections::HashSet::new();
    for c in re_img.captures_iter(seg) {
      let u = fix(&c[1]);
      if u.is_empty() || !seen.insert(u.clone()) {
        continue;
      }
      items.push(SearchItem {
        thumb: u.clone(),
        url: u,
        title: String::new(),
        similarity: None,
      });
    }
  }
  Ok(items)
}

/// 取输入图片字节：本地路径直接读；远程 URL 下载（用于直传各引擎）
fn read_input_bytes(
  input: &str,
  client: &reqwest::blocking::Client,
) -> Result<(String, Vec<u8>), String> {
  if input.starts_with("http://") || input.starts_with("https://") {
    let b = client
      .get(input)
      .send()
      .map_err(|e| e.to_string())?
      .bytes()
      .map_err(|e| e.to_string())?
      .to_vec();
    Ok(("blob".to_string(), b))
  } else {
    let b = std::fs::read(input).map_err(|e| format!("读取图片失败：{e}"))?;
    Ok((
      input
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("blob")
        .to_string(),
      b,
    ))
  }
}

/// Google Lens 直传（备用）：结果页 `vsrid` 绑定上传会话，登录态浏览器打开会报“未关联账号”，
/// 故默认改用 `lens.google.com/uploadbyurl`（需公开 URL）。保留以备将来。
#[allow(dead_code)]
fn lens_upload(input: &str, proxy: &str) -> Result<String, String> {
  use reqwest::blocking::multipart::{Form, Part};
  let mut b = reqwest::blocking::Client::builder()
    .connect_timeout(Duration::from_secs(15))
    .timeout(Duration::from_secs(60))
    .redirect(reqwest::redirect::Policy::none())
    .user_agent(UA);
  if !proxy.is_empty() {
    b = b.proxy(reqwest::Proxy::all(proxy).map_err(|e| e.to_string())?);
  }
  let client = b.build().map_err(|e| e.to_string())?;
  let (filename, bytes) = read_input_bytes(input, &client)?;
  let stcs = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0);
  let url = format!("https://lens.google.com/v3/upload?stcs={stcs}");
  let mime = match filename
    .rsplit('.')
    .next()
    .unwrap_or("")
    .to_ascii_lowercase()
    .as_str()
  {
    "png" => "image/png",
    "webp" => "image/webp",
    "gif" => "image/gif",
    "bmp" => "image/bmp",
    _ => "image/jpeg",
  };
  let part = Part::bytes(bytes)
    .file_name(filename)
    .mime_str(mime)
    .map_err(|e| e.to_string())?;
  let form = Form::new().part("encoded_image", part);
  let resp = client
    .post(&url)
    .multipart(form)
    .send()
    .map_err(|e| format!("上传到 Google Lens 失败：{e}"))?;
  let loc = resp
    .headers()
    .get("location")
    .and_then(|v| v.to_str().ok())
    .map(|s| s.to_string());
  match loc {
    Some(l) if l.starts_with("http") => Ok(l),
    Some(l) => Ok(format!("https://lens.google.com{l}")),
    None => Err("Google Lens 上传未返回结果页".into()),
  }
}

fn saucenao(input: &str, key: Option<&str>, proxy: &str) -> Result<Vec<SearchItem>, String> {
  use reqwest::blocking::multipart::{Form, Part};
  let client = build_client(proxy)?;
  let (filename, bytes) = read_input_bytes(input, &client)?;
  // 有 API key 用 JSON 接口
  if let Some(k) = key.filter(|k| !k.trim().is_empty()) {
    let part = Part::bytes(bytes).file_name(filename);
    let form = Form::new()
      .text("output_type", "2")
      .text("api_key", k.to_string())
      .text("db", "999")
      .part("file", part);
    let v: Value = client
      .post("https://saucenao.com/search.php")
      .multipart(form)
      .send()
      .map_err(|e| e.to_string())?
      .json()
      .map_err(|e| e.to_string())?;
    let mut items = vec![];
    if let Some(arr) = v["results"].as_array() {
      for r in arr {
        let h = &r["header"];
        let d = &r["data"];
        let sim = h["similarity"].as_str().and_then(|s| s.parse::<f64>().ok());
        let url = d["ext_urls"]
          .as_array()
          .and_then(|a| a.first())
          .and_then(|x| x.as_str())
          .unwrap_or("")
          .to_string();
        let title = d["title"].as_str().or_else(|| d["source"].as_str()).unwrap_or("").to_string();
        items.push(SearchItem {
          thumb: h["thumbnail"].as_str().unwrap_or("").to_string(),
          url,
          title,
          similarity: sim,
        });
      }
    }
    return Ok(items);
  }
  // 无 key：直传文件解析网页结果
  let part = Part::bytes(bytes).file_name(filename);
  let form = Form::new().text("db", "999").part("file", part);
  let resp = client
    .post("https://saucenao.com/search.php")
    .multipart(form)
    .send()
    .map_err(|e| e.to_string())?;
  let status = resp.status().as_u16();
  let html = resp.text().map_err(|e| e.to_string())?;
  if status == 429 || html.contains("Search Limit Exceeded") {
    return Err("SauceNAO 触发限流（未注册每 IP 约 100 次/天，稍后再试或填 API Key）".into());
  }
  let re_href = Regex::new(r#"<a[^>]+href="([^"]+)""#).unwrap();
  let re_img = Regex::new(r#"<img[^>]+src="([^"]+)""#).unwrap();
  let re_sim = Regex::new(r#"resultsimilarityinfo[^>]*>\s*([0-9.]+)%"#).unwrap();
  let re_title = Regex::new(r#"(?s)resulttitle[^>]*>.*?<a[^>]*>(.*?)</a>"#).unwrap();
  let mut items = vec![];
  for chunk in html.split("class=\"result").skip(1) {
    let url = re_href
      .captures(chunk)
      .map(|c| c[1].to_string())
      .unwrap_or_default();
    let thumb = re_img
      .captures(chunk)
      .map(|c| c[1].to_string())
      .unwrap_or_default();
    let similarity = re_sim
      .captures(chunk)
      .and_then(|c| c[1].parse::<f64>().ok());
    let title = re_title
      .captures(chunk)
      .map(|c| strip_tags(&c[1]))
      .unwrap_or_default();
    if url.is_empty() && thumb.is_empty() {
      continue;
    }
    items.push(SearchItem {
      thumb,
      url,
      title,
      similarity,
    });
  }
  Ok(items)
}

fn iqdb(pub_url: &str, proxy: &str) -> Result<Vec<SearchItem>, String> {
  let client = build_client(proxy)?;
  let html = client
    .get("https://iqdb.org/")
    .query(&[("url", pub_url)])
    .send()
    .map_err(|e| e.to_string())?
    .text()
    .map_err(|e| e.to_string())?;
  let re_href = Regex::new(r#"<a[^>]+href="(https?://[^"]+)""#).unwrap();
  let re_img = Regex::new(r#"<img[^>]+src="([^"]+)""#).unwrap();
  let mut items = vec![];
  for chunk in html.split("class=\"match").skip(1) {
    let url = re_href
      .captures(chunk)
      .map(|c| c[1].to_string())
      .unwrap_or_default();
    let thumb = re_img
      .captures(chunk)
      .map(|c| {
        let u = c[1].to_string();
        if u.starts_with("//") {
          format!("https:{u}")
        } else {
          u
        }
      })
      .unwrap_or_default();
    if url.is_empty() && thumb.is_empty() {
      continue;
    }
    items.push(SearchItem {
      thumb,
      url,
      title: String::new(),
      similarity: None,
    });
  }
  Ok(items)
}

fn trace_moe(pub_url: &str, proxy: &str) -> Result<Vec<SearchItem>, String> {
  let client = build_client(proxy)?;
  let v: Value = client
    .get("https://api.trace.moe/search")
    .query(&[("url", pub_url)])
    .send()
    .map_err(|e| e.to_string())?
    .json()
    .map_err(|e| e.to_string())?;
  let mut items = vec![];
  if let Some(arr) = v["result"].as_array() {
    for r in arr {
      let title = r["anilist"]["title"]["native"]
        .as_str()
        .or_else(|| r["anilist"]["title"]["romaji"].as_str())
        .unwrap_or("")
        .to_string();
      let ep = r["episode"].as_str().unwrap_or("");
      let label = if ep.is_empty() {
        title
      } else {
        format!("{title} 第 {ep} 集")
      };
      let id = r["anilist"]["id"].as_i64();
      let url = id
        .map(|i| format!("https://anilist.co/anime/{i}"))
        .unwrap_or_default();
      items.push(SearchItem {
        thumb: r["image"].as_str().unwrap_or("").to_string(),
        url,
        title: label,
        similarity: r["similarity"].as_f64(),
      });
    }
  }
  Ok(items)
}

#[tauri::command]
pub fn reverse_image_search(
  input: String,
  engine: String,
  proxy: String,
  saucenao_key: Option<String>,
) -> Result<EngineResult, String> {
  let (pub_url, yandex_page) = get_public_url(&input, &proxy)?;
  let open_page = |engine: &str, page: String| EngineResult {
    engine: engine.to_string(),
    items: vec![],
    page_url: if page.is_empty() { None } else { Some(page) },
    error: None,
  };
  match engine.as_str() {
    "saucenao" => Ok(EngineResult {
      engine,
      items: saucenao(&pub_url, saucenao_key.as_deref(), &proxy)?,
      page_url: None,
      error: None,
    }),
    "iqdb" => Ok(EngineResult {
      engine,
      items: iqdb(&pub_url, &proxy)?,
      page_url: None,
      error: None,
    }),
    "trace_moe" => Ok(EngineResult {
      engine,
      items: trace_moe(&pub_url, &proxy)?,
      page_url: None,
      error: None,
    }),
    "yandex" => {
      let page = if yandex_page.is_empty() {
        format!(
          "https://yandex.ru/images/search?rpt=imageview&url={}",
          enc(&pub_url)
        )
      } else {
        yandex_page
      };
      Ok(EngineResult {
        engine,
        items: yandex_items(&page, &proxy)?,
        page_url: Some(page),
        error: None,
      })
    }
    "google_lens" => Ok(open_page(
      "google_lens",
      format!("https://lens.google.com/uploadbyurl?url={}", enc(&pub_url)),
    )),
    "ascii2d" => Ok(open_page(
      "ascii2d",
      format!("https://ascii2d.net/search/url/{}", pub_url),
    )),
    other => Err(format!("未知引擎：{other}")),
  }
}
