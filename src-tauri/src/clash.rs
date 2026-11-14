// 内置代理：把 mihomo（Clash.Meta）作为**可选安装**的核心拉起，用用户的 Clash 订阅作为节点来源，
// 在本机开一个 mixed-port（HTTP+SOCKS）供应用所有请求使用。
// - 核心不随安装包分发：设置页点「安装内核」按需下载到 %APPDATA%\p-spider\mihomo。
// - 订阅由 Rust 拉取（写 ./sub.yaml），顺带读取 subscription-userinfo 头以显示剩余流量。
// - 节点选择走 mihomo 的 external-controller RESTful API（127.0.0.1）。
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

static CHILD: Mutex<Option<Child>> = Mutex::new(None);

/// Windows Job Object：把 mihomo 子进程绑到本进程，父进程结束时（含被强杀）系统自动终止子进程。
#[cfg(windows)]
mod job {
  use std::sync::Mutex;
  use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
  use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  };
  use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
  };

  static JOB: Mutex<isize> = Mutex::new(0);

  fn ensure_job() -> HANDLE {
    let mut g = match JOB.lock() {
      Ok(g) => g,
      Err(_) => return 0,
    };
    if *g != 0 {
      return *g as HANDLE;
    }
    unsafe {
      let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
      if job == 0 {
        return 0;
      }
      let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
      info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      let ok = SetInformationJobObject(
        job,
        JobObjectExtendedLimitInformation,
        &info as *const _ as *const core::ffi::c_void,
        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
      );
      if ok == 0 {
        let _ = CloseHandle(job);
        return 0;
      }
      *g = job as isize;
      job
    }
  }

  /// 把指定 PID 加入 job（失败则退回进程内 kill 兜底）
  pub fn assign(pid: u32) {
    unsafe {
      let job = ensure_job();
      if job == 0 {
        return;
      }
      let proc = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
      if proc != 0 {
        let _ = AssignProcessToJobObject(job, proc);
        let _ = CloseHandle(proc);
      }
    }
  }
}

/// mixed-port（应用请求走这里）
pub const DEFAULT_MIXED_PORT: u16 = 7899;
/// external-controller 端口（节点列表 / 切换）
const CONTROLLER_PORT: u16 = 19099;
/// 内置核心里程碑版本（下载固定此版本，保证可用）
const CORE_VERSION: &str = "v1.19.32";
const CORE_URL: &str = "https://github.com/MetaCubeX/mihomo/releases/download/v1.19.32/mihomo-windows-amd64-compatible-v1.19.32.zip";

#[derive(serde::Serialize, Clone)]
pub struct SubscriptionInfo {
  upload: u64,
  download: u64,
  total: u64,
  expire: i64,
}

#[derive(serde::Serialize)]
pub struct ClashStatus {
  running: bool,
  mixed_port: u16,
  controller: String,
  subscription: Option<SubscriptionInfo>,
}

#[derive(serde::Serialize)]
pub struct CoreStatus {
  installed: bool,
  version: String,
  path: String,
}

fn app_data() -> PathBuf {
  let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
  PathBuf::from(base).join("p-spider")
}
fn core_dir() -> PathBuf {
  app_data().join("mihomo")
}
fn clash_dir() -> PathBuf {
  app_data().join("clash")
}

/// 定位 mihomo：优先 appdata 已安装的核心；其次主程序同目录（旧打包/绿色版兼容）
fn mihomo_path() -> Result<PathBuf, String> {
  let installed = core_dir().join("mihomo.exe");
  if installed.exists() {
    return Ok(installed);
  }
  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = exe.parent() {
      for name in ["mihomo.exe", "mihomo-x86_64-pc-windows-msvc.exe"] {
        let p = dir.join(name);
        if p.exists() {
          return Ok(p);
        }
      }
    }
  }
  Err("尚未安装内置代理内核，请在设置页点「安装内核」".into())
}

/// 本机端口是否已被占用
fn port_in_use(port: u16) -> bool {
  std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
}

fn write_config(mixed_port: u16) -> Result<PathBuf, String> {
  let dir = clash_dir();
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let cfg = format!(
"mixed-port: {port}
allow-lan: false
bind-address: 127.0.0.1
mode: rule
log-level: warning
ipv6: true
external-controller: 127.0.0.1:{ctrl}

dns:
  enable: true
  ipv6: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - https://223.5.5.5/dns-query
    - https://1.1.1.1/dns-query

proxy-providers:
  sub:
    type: file
    path: ./sub.yaml
    health-check:
      enable: true
      url: https://www.gstatic.com/generate_204
      interval: 300

proxy-groups:
  - name: AUTO
    type: url-test
    use:
      - sub
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
  - name: PROXY
    type: select
    use:
      - sub
    proxies:
      - AUTO

rules:
  - MATCH,PROXY
",
    port = mixed_port,
    ctrl = CONTROLLER_PORT,
  );
  let path = dir.join("config.yaml");
  std::fs::write(&path, cfg).map_err(|e| e.to_string())?;
  Ok(path)
}

fn parse_userinfo(s: &str) -> Option<SubscriptionInfo> {
  let mut upload = 0u64;
  let mut download = 0u64;
  let mut total = 0u64;
  let mut expire = 0i64;
  let mut any = false;
  for part in s.split(';') {
    if let Some((k, v)) = part.split_once('=') {
      let val = v.trim().parse::<i64>().unwrap_or(0);
      match k.trim() {
        "upload" => {
          upload = val.max(0) as u64;
          any = true;
        }
        "download" => {
          download = val.max(0) as u64;
          any = true;
        }
        "total" => {
          total = val.max(0) as u64;
          any = true;
        }
        "expire" => {
          expire = val;
          any = true;
        }
        _ => {}
      }
    }
  }
  if any {
    Some(SubscriptionInfo {
      upload,
      download,
      total,
      expire,
    })
  } else {
    None
  }
}

/// 构造拉订阅用的 client：代理地址是本机地址或空则直连
fn sub_client(proxy_url: Option<&str>) -> Result<reqwest::Client, String> {
  let mut b = reqwest::Client::builder()
    .connect_timeout(Duration::from_secs(15))
    .timeout(Duration::from_secs(60));
  if let Some(p) = proxy_url {
    let p = p.trim();
    if !p.is_empty() && !p.contains("127.0.0.1") && !p.contains("localhost") {
      b = b.proxy(reqwest::Proxy::all(p).map_err(|e| e.to_string())?);
    }
  }
  b.build().map_err(|e| e.to_string())
}

/// 拉订阅：返回 (内容, 流量信息?)。流量来自 `subscription-userinfo` 响应头。
async fn fetch_subscription(
  url: &str,
  proxy_url: Option<&str>,
) -> Result<(String, Option<SubscriptionInfo>), String> {
  let client = sub_client(proxy_url)?;
  let resp = client
    .get(url)
    .header("User-Agent", "clash-verge/v1.6.2")
    .send()
    .await
    .map_err(|e| format!("拉取订阅失败：{e}"))?;
  if !resp.status().is_success() {
    return Err(format!("拉取订阅失败：HTTP {}", resp.status().as_u16()));
  }
  let info = resp
    .headers()
    .get("subscription-userinfo")
    .and_then(|v| v.to_str().ok())
    .and_then(parse_userinfo);
  let body = resp.text().await.map_err(|e| e.to_string())?;
  Ok((body, info))
}

/// 终止当前 mihomo 进程（若有）
pub fn kill() {
  if let Ok(mut g) = CHILD.lock() {
    if let Some(mut c) = g.take() {
      let _ = c.kill();
      let _ = c.wait();
    }
  }
}

fn controller_client() -> Result<reqwest::Client, String> {
  reqwest::Client::builder()
    .no_proxy()
    .timeout(Duration::from_secs(5))
    .build()
    .map_err(|e| e.to_string())
}

// ---- 命令 ----

#[tauri::command]
pub fn clash_core_status() -> CoreStatus {
  match mihomo_path() {
    Ok(p) => CoreStatus {
      installed: true,
      version: CORE_VERSION.into(),
      path: p.to_string_lossy().to_string(),
    },
    Err(_) => CoreStatus {
      installed: false,
      version: String::new(),
      path: String::new(),
    },
  }
}

/// 下载并安装内置核心（zip 解出 mihomo.exe → %APPDATA%\p-spider\mihomo）
#[tauri::command]
pub async fn clash_core_install(
  app: tauri::AppHandle,
  proxy_url: Option<String>,
) -> Result<(), String> {
  use futures_util::StreamExt;
  use tokio::io::AsyncWriteExt;

  let client = sub_client(proxy_url.as_deref())?;
  let resp = client
    .get(CORE_URL)
    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if !resp.status().is_success() {
    return Err(format!("下载内核失败：HTTP {}", resp.status().as_u16()));
  }

  std::fs::create_dir_all(core_dir()).map_err(|e| e.to_string())?;
  let tmp = std::env::temp_dir().join("p-spider-mihomo.zip");
  let total = resp.content_length().unwrap_or(0);
  let mut file = tokio::fs::File::create(&tmp)
    .await
    .map_err(|e| e.to_string())?;
  let mut downloaded: u64 = 0;
  let mut last = 0u64;
  let mut stream = resp.bytes_stream();
  while let Some(chunk) = stream.next().await {
    let c = chunk.map_err(|e| e.to_string())?;
    file.write_all(&c).await.map_err(|e| e.to_string())?;
    downloaded += c.len() as u64;
    if downloaded - last >= 262144 {
      let _ = app.emit_all(
        "clash-progress",
        serde_json::json!({ "phase": "download", "downloaded": downloaded, "total": total }),
      );
      last = downloaded;
    }
  }
  file.flush().await.map_err(|e| e.to_string())?;
  drop(file);

  let _ = app.emit_all(
    "clash-progress",
    serde_json::json!({ "phase": "extract" }),
  );
  let f = std::fs::File::open(&tmp).map_err(|e| e.to_string())?;
  let mut zip = zip::ZipArchive::new(f).map_err(|e| format!("打开内核压缩包失败：{e}"))?;
  let mut done = false;
  for i in 0..zip.len() {
    let mut zf = zip.by_index(i).map_err(|e| e.to_string())?;
    if zf.name().to_lowercase().ends_with(".exe") {
      let out = core_dir().join("mihomo.exe");
      let mut of = std::fs::File::create(&out).map_err(|e| e.to_string())?;
      std::io::copy(&mut zf, &mut of).map_err(|e| e.to_string())?;
      done = true;
      break;
    }
  }
  let _ = std::fs::remove_file(&tmp);
  if !done {
    return Err("内核压缩包里没找到 mihomo.exe".into());
  }
  let _ = app.emit_all("clash-progress", serde_json::json!({ "phase": "done" }));
  Ok(())
}

/// 启动内置代理：拉订阅 → 写 config → 起 mihomo → 返回状态 + 流量
#[tauri::command]
pub async fn clash_start(
  subscription_url: String,
  mixed_port: Option<u16>,
  proxy_url: Option<String>,
) -> Result<ClashStatus, String> {
  kill();
  let sub = subscription_url.trim().to_string();
  if sub.is_empty() {
    return Err("订阅链接为空".into());
  }
  let port = mixed_port.unwrap_or(DEFAULT_MIXED_PORT);
  if port_in_use(port) {
    return Err(format!("本地端口 {port} 已被占用，请换一个"));
  }
  let exe = mihomo_path()?;

  // 拉订阅（获取内容 + 流量信息）
  let (body, info) = fetch_subscription(&sub, proxy_url.as_deref()).await?;

  let dir = clash_dir();
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  std::fs::write(dir.join("sub.yaml"), &body).map_err(|e| e.to_string())?;
  let cfg = write_config(port)?;

  let mut cmd = Command::new(&exe);
  cmd
    .arg("-d")
    .arg(&dir)
    .arg("-f")
    .arg(&cfg)
    .stdout(Stdio::null())
    .stderr(Stdio::null());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }

  let child = cmd
    .spawn()
    .map_err(|e| format!("启动内置代理失败：{e}"))?;
  #[cfg(windows)]
  job::assign(child.id());
  if let Ok(mut g) = CHILD.lock() {
    *g = Some(child);
  }
  Ok(ClashStatus {
    running: true,
    mixed_port: port,
    controller: format!("127.0.0.1:{CONTROLLER_PORT}"),
    subscription: info,
  })
}

#[tauri::command]
pub fn clash_stop() -> Result<(), String> {
  kill();
  Ok(())
}

#[tauri::command]
pub fn clash_status() -> Result<ClashStatus, String> {
  let running = CHILD.lock().map(|g| g.is_some()).unwrap_or(false);
  Ok(ClashStatus {
    running,
    mixed_port: DEFAULT_MIXED_PORT,
    controller: format!("127.0.0.1:{CONTROLLER_PORT}"),
    subscription: None,
  })
}

/// PROXY 组的节点列表与当前选择（`{ all: [...], now: "..." }`）
#[tauri::command]
pub async fn clash_proxies() -> Result<serde_json::Value, String> {
  let url = format!("http://127.0.0.1:{CONTROLLER_PORT}/proxies/PROXY");
  let resp = controller_client()?
    .get(&url)
    .send()
    .await
    .map_err(|e| format!("读取节点失败：{e}"))?;
  resp
    .json::<serde_json::Value>()
    .await
    .map_err(|e| e.to_string())
}

/// 切换 PROXY 组当前节点
#[tauri::command]
pub async fn clash_select(name: String) -> Result<(), String> {
  let url = format!("http://127.0.0.1:{CONTROLLER_PORT}/proxies/PROXY");
  controller_client()?
    .put(&url)
    .json(&serde_json::json!({ "name": name }))
    .send()
    .await
    .map_err(|e| format!("切换节点失败：{e}"))?;
  Ok(())
}

/// 清理上次异常退出残留的自家 mihomo（按 sidecar 完整路径精确匹配，不误杀外部同名进程）。
#[cfg(windows)]
pub fn kill_orphans() {
  use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
  use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
  };
  use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, TerminateProcess,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
  };

  let Ok(exe) = mihomo_path() else {
    return;
  };
  let target = exe.to_string_lossy().to_lowercase();

  unsafe {
    let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if snap == INVALID_HANDLE_VALUE {
      return;
    }
    let mut entry: PROCESSENTRY32W = std::mem::zeroed();
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    if Process32FirstW(snap, &mut entry) != 0 {
      loop {
        let name: String = entry
          .szExeFile
          .iter()
          .take_while(|&&c| c != 0)
          .map(|&c| c as u8 as char)
          .collect();
        if name.eq_ignore_ascii_case("mihomo.exe") {
          let proc = OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
            0,
            entry.th32ProcessID,
          );
          if proc != 0 {
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            if QueryFullProcessImageNameW(proc, 0, buf.as_mut_ptr(), &mut len) != 0 {
              let path = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase();
              if path == target {
                let _ = TerminateProcess(proc, 0);
              }
            }
            let _ = CloseHandle(proc);
          }
        }
        if Process32NextW(snap, &mut entry) == 0 {
          break;
        }
      }
    }
    let _ = CloseHandle(snap);
  }
}
