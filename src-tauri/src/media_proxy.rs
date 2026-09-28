// 本地流式媒体代理：把远程媒体（如 video.twimg.com）经「应用代理」转发给 WebView。
// WebView 的 <video> 不走应用代理，直连常被墙；这里起一个仅监听 127.0.0.1 的小 HTTP 服务，
// 透传 Range 请求头 → 支持边下边播 / 拖动进度。
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::Duration;

use percent_encoding::percent_decode_str;
use tiny_http::{Header, Response, Server, StatusCode};

static PORT: OnceLock<u16> = OnceLock::new();

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

/// 启动本地媒体代理（幂等），返回监听端口。
#[tauri::command]
pub fn media_proxy_port() -> Result<u16, String> {
    if let Some(p) = PORT.get() {
        return Ok(*p);
    }
    let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or_else(|| "无法获取代理端口".to_string())?;
    let server = Arc::new(server);
    // 少量 worker 并发处理（一个长连接流式传输会占用一个 worker）
    for _ in 0..4 {
        let srv = server.clone();
        thread::spawn(move || loop {
            match srv.recv() {
                Ok(req) => {
                    let _ = handle(req);
                }
                Err(_) => break,
            }
        });
    }
    let _ = PORT.set(port);
    Ok(port)
}

fn handle(req: tiny_http::Request) -> Result<(), String> {
    let url = req.url().to_string();
    let query = url.splitn(2, '?').nth(1).unwrap_or("");
    let mut target = String::new();
    let mut proxy = String::new();
    let mut local = String::new();
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next().unwrap_or("");
        let v = it.next().unwrap_or("");
        let dv = percent_decode_str(v).decode_utf8_lossy().to_string();
        match k {
            "u" => target = dv,
            "p" => proxy = dv,
            "f" => local = dv,
            _ => {}
        }
    }

    // 本地文件：给 WebView 的 <video> 一个支持 Range 的 http 源
    // （Tauri asset 协议不支持 Range，导致本地视频无法解码出首帧）
    if !local.is_empty() {
        return serve_local(req, &local);
    }

    if target.is_empty() {
        let _ = req.respond(Response::from_string("missing url").with_status_code(400));
        return Ok(());
    }

    let range = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .map(|h| h.value.as_str().to_string());

    let mut cb = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60 * 60));
    if !proxy.is_empty() {
        let p = reqwest::Proxy::all(&proxy).map_err(|e| e.to_string())?;
        cb = cb.proxy(p);
    }
    let client = cb.build().map_err(|e| e.to_string())?;

    let mut r = client
        .get(&target)
        .header("User-Agent", UA)
        .header("Referer", "https://x.com/");
    if let Some(rg) = range {
        r = r.header("Range", rg);
    }
    let resp = r.send().map_err(|e| e.to_string())?;
    let code = resp.status().as_u16();

    let mut out = Response::empty(StatusCode::from(code));
    for name in [
        "Content-Type",
        "Content-Length",
        "Content-Range",
        "Accept-Ranges",
        "Last-Modified",
        "Cache-Control",
    ] {
        if let Some(v) = resp.headers().get(name) {
            if let Ok(val) = v.to_str() {
                if let Ok(h) = Header::from_bytes(name.as_bytes(), val.as_bytes()) {
                    out = out.with_header(h);
                }
            }
        }
    }
    let _ = req.respond(out.with_data(resp, None));
    Ok(())
}

/// 按扩展名猜 Content-Type（本地文件用，WebView 需要正确 mime 才肯解码）
fn mime_of(path: &str) -> &'static str {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "gif" => "image/gif",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

/// 流式返回本地文件，支持单段 Range（206）
fn serve_local(req: tiny_http::Request, path: &str) -> Result<(), String> {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            let _ = req.respond(Response::from_string("open failed").with_status_code(404));
            let _ = e;
            return Ok(());
        }
    };
    let total = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mime = mime_of(path);

    let range = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .map(|h| h.value.as_str().to_string());

    // 解析 "bytes=start-end"
    let mut start = 0u64;
    let mut end = total.saturating_sub(1);
    let mut ranged = false;
    if let Some(r) = range {
        if let Some(spec) = r.strip_prefix("bytes=") {
            let spec = spec.split(',').next().unwrap_or("").trim();
            let mut it = spec.splitn(2, '-');
            let a = it.next().unwrap_or("").trim().to_string();
            let b = it.next().unwrap_or("").trim().to_string();
            if !a.is_empty() {
                if let Ok(v) = a.parse::<u64>() {
                    start = v;
                }
            }
            if !b.is_empty() {
                if let Ok(v) = b.parse::<u64>() {
                    end = v;
                }
            }
            if total > 0 && start > end {
                end = total.saturating_sub(1);
            }
            ranged = true;
        }
    }
    if total > 0 && end >= total {
        end = total.saturating_sub(1);
    }
    let len = if total == 0 || end < start {
        0
    } else {
        end - start + 1
    };

    if let Err(e) = file.seek(SeekFrom::Start(start)) {
        let _ = req.respond(Response::from_string(format!("seek failed: {e}")).with_status_code(500));
        return Ok(());
    }
    let reader = file.take(len);

    let mut headers = Vec::new();
    if let Ok(h) = Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()) {
        headers.push(h);
    }
    if let Ok(h) = Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]) {
        headers.push(h);
    }
    if let Ok(h) = Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]) {
        headers.push(h);
    }
    if ranged {
        if let Ok(h) = Header::from_bytes(
            &b"Content-Range"[..],
            format!("bytes {}-{}/{}", start, end, total).as_bytes(),
        ) {
            headers.push(h);
        }
    }

    let status = StatusCode(if ranged { 206 } else { 200 });
    let resp = Response::new(status, headers, reader, Some(len as usize), None);
    let _ = req.respond(resp);
    Ok(())
}
