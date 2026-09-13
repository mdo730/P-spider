use std::collections::HashMap;
use reqwest::Method;
use serde_json::Value;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

#[derive(Default, serde::Serialize)]
pub struct Response {
  status: u16,
  headers: HashMap<String, Vec<String>>,
  body: Value,
}

#[tauri::command]
pub async fn network_fetch(
  method: String,
  url: String,
  body: String,
  enable_proxy: bool,
  proxy_url: String,
  response_type: String,
  headers: HashMap<String, String>,
) -> Result<Response, String> {
  let map_reqwest_err = |err: reqwest::Error| err.to_string();
  // Convert method string into Method
  let method: Method = match method.to_uppercase().as_str() {
    "GET" => Ok(Method::GET),
    "POST" => Ok(Method::POST),
    "PATCH" => Ok(Method::PATCH),
    "PUT" => Ok(Method::PUT),
    "DELETE" => Ok(Method::DELETE),
    "HEAD" => Ok(Method::HEAD),
    _ => Err("Invalid method".to_string()),
  }?;

  // Build client
  let client = {
    let mut b = reqwest::Client::builder();
    // 网络超时：避免代理/服务器挂起时请求无限等待（会导致订阅一直卡在"检查中"）
    b = b
      .connect_timeout(std::time::Duration::from_secs(15))
      .timeout(std::time::Duration::from_secs(30));

    // Auto set proxy settings
    if enable_proxy {
      if proxy_url.len() == 0 {
        // Use system proxy, do nothing
      } else {
        // Use custom proxy url
        let proxy_http = reqwest::Proxy::http(proxy_url.clone()).or(Err("Failed to set proxy url".to_string()))?;
        let proxy_https = reqwest::Proxy::https(proxy_url.clone()).or(Err("Failed to set proxy url".to_string()))?;
        b = b.proxy(proxy_http).proxy(proxy_https);
      }
    } else {
      // No proxy
      b = b.no_proxy();
    }

    b.build().or(Err("Failed to build reqwest client".to_string()))
  }?;

  // Build request
  let request = {
    let mut req = client.request(method.clone(), url);
    for (k, v) in headers {
      req = req.header(k, v);
    }

    if !matches!(method.clone(), Method::GET) {
      req = req.body(body);
    }

    req
  };

  // Send request
  let response = request.send().await.map_err(map_reqwest_err)?;

  // Extract some info
  let status = response.status().as_u16();
  let resp_headers = {
    let reqwest_headers = response.headers();
    let mut h: HashMap<String, Vec<String>> = HashMap::with_capacity(reqwest_headers.len());

    for (k, v) in reqwest_headers {
      let v = v.to_str();
      if let Err(_) = v {
        continue;
      }

      let v = v.unwrap().to_string();
      h.entry(k.to_string()).and_modify(|arr: &mut Vec<String>| arr.push(v.clone()))
        .or_insert_with(|| vec![v]);
    }

    h
  };

  // Load response body
  let body: Value = {
    match response_type.as_str() {
      // 直接返回原始 JSON（可能是对象或数组），前端按需取用
      "json" => response.json::<Value>().await.map_err(map_reqwest_err),
      "text" => response.text().await.map_err(map_reqwest_err).map(|res| Value::String(res)),
      "binary" => {
        let bytes = response.bytes().await.map_err(map_reqwest_err)?;
        serde_json::to_value(bytes.to_vec()).map_err(|err| err.to_string())
      },
      _ => Err("Unsupported response type".to_string())
    }
  }?;

  return Ok(Response {
    status,
    body,
    headers: resp_headers })
}

#[tauri::command]
pub async fn network_get_system_proxy_url() -> Result<HashMap<String, String>, ()> {
  let mut mapped_proxies: HashMap<String, String> = HashMap::new();

  // 读取 Windows 注册表中的系统代理设置
  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  let settings = hkcu
    .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings");

  let (proxy_enable, proxy_server) = match settings {
    Ok(key) => {
      let enable: u32 = key.get_value("ProxyEnable").unwrap_or(0);
      let server: String = key.get_value("ProxyServer").unwrap_or_default();
      (enable, server)
    }
    Err(_) => (0, String::new()),
  };

  if proxy_enable == 1 && !proxy_server.is_empty() {
    // 代理服务器格式可能是 "127.0.0.1:7890" 或 "http=127.0.0.1:7890;https=127.0.0.1:7890"
    let server = proxy_server.trim().to_string();
    if server.contains('=') {
      // 按协议分开的格式
      for part in server.split(';') {
        let part = part.trim();
        if let Some(eq) = part.find('=') {
          let scheme = part[..eq].to_lowercase();
          let host = part[eq + 1..].to_string();
          mapped_proxies.insert(scheme, host);
        }
      }
    } else {
      // 单一代理地址，同时用于 http/https
      mapped_proxies.insert("http".to_string(), server.clone());
      mapped_proxies.insert("https".to_string(), server);
    }
  }

  Ok(mapped_proxies)
}

const RUN_KEY_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE_NAME: &str = "P-Spider";

/// 设置开机自启动（写入当前用户 Run 注册表键）
#[tauri::command]
pub fn set_auto_start(enabled: bool) -> Result<bool, String> {
  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  let run_key = hkcu
    .create_subkey(RUN_KEY_PATH)
    .map_err(|e| format!("Failed to open Run key: {e}"))?
    .0;

  if enabled {
    // 取当前 exe 路径，带引号防止路径含空格
    let exe_path = std::env::current_exe()
      .map_err(|e| format!("Failed to get current exe path: {e}"))?;
    let cmd = format!("\"{}\"", exe_path.display());
    run_key
      .set_value(RUN_VALUE_NAME, &cmd)
      .map_err(|e| format!("Failed to set autostart: {e}"))?;
  } else {
    let _ = run_key.delete_value(RUN_VALUE_NAME);
  }

  Ok(true)
}

/// 查询当前是否已设置开机自启动
#[tauri::command]
pub fn get_auto_start() -> bool {
  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  if let Ok(run_key) = hkcu.open_subkey(RUN_KEY_PATH) {
    if let Ok::<String, _>(value) = run_key.get_value(RUN_VALUE_NAME) {
      return !value.is_empty();
    }
  }
  false
}

/// 退出应用（托盘/关闭选择框用，可靠退出方式）
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
  app.exit(0);
}
