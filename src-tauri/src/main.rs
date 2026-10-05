// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup;
mod fsutil;
mod hpoi_index;
mod open_url;
mod image_search;
mod media_proxy;
mod network;
mod mega;
mod wd14;
mod wd14_infer;

use tauri::{
    AppHandle, CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, WindowEvent,
};

use std::sync::{Arc, Mutex};
use winapi::shared::windef::POINT;
use winapi::um::winuser::GetCursorPos;

/// 桌面宠物窗的「可交互命中区」（窗口内逻辑像素矩形：x, y, w, h）。
/// 前端在布局变化时上报；后台线程据光标位置切换窗口的鼠标穿透。
#[derive(Default)]
struct PetHit {
    rects: Vec<[f64; 4]>,
}

#[tauri::command]
fn pet_set_hit_rects(state: tauri::State<'_, Arc<Mutex<PetHit>>>, rects: Vec<[f64; 4]>) {
    if let Ok(mut s) = state.lock() {
        s.rects = rects;
    }
}

/// 显示并聚焦主窗口（托盘左键/双击、菜单「显示窗口」共用）
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        window.show().ok();
        window.set_focus().ok();
    }
}

/// 设置系统托盘悬停提示（桌面宠物窗用来显示宠物现状）
#[tauri::command]
fn set_tray_tooltip(app: AppHandle, text: String) {
    let _ = app.tray_handle().set_tooltip(&text);
}

/// 用本机压缩软件解压到指定目录：优先 Bandizip 的 bz.exe。
/// 未找到 Bandizip 时返回 "BANDIZIP_NOT_FOUND"（前端回退用默认程序打开）。
#[tauri::command]
fn extract_archive(archive: String, out_dir: String) -> Result<String, String> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(var) {
            candidates.push(
                std::path::Path::new(&base)
                    .join("Bandizip")
                    .join("bz.exe"),
            );
        }
    }
    candidates.push(std::path::PathBuf::from(r"C:\Program Files\Bandizip\bz.exe"));
    candidates.push(std::path::PathBuf::from(
        r"C:\Program Files (x86)\Bandizip\bz.exe",
    ));
    let Some(bz) = candidates.into_iter().find(|p| p.exists()) else {
        return Err("BANDIZIP_NOT_FOUND".into());
    };
    let output = std::process::Command::new(&bz)
        // bz.exe 要求开关在压缩包之前：switch 放前面、包名放最后
        .arg("x")
        .arg(format!("-o:{}", out_dir))
        .arg("-y")
        .arg(&archive)
        .output()
        .map_err(|e| format!("spawn failed: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(format!(
            "bz.exe 退出码 {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    image_search::capture_cli_args(&args);
    // 单实例：非主实例且带 --image-search → 把路径转给已运行实例后直接退出（不新开窗口）
    let primary = image_search::start_control_listener();
    if !primary {
        if let Some(u) = image_search::current_pixiv_arg() {
            image_search::forward_pixiv_arg(&u);
            std::process::exit(0);
        }
        if let Some(p) = image_search::current_arg() {
            image_search::forward_arg(&p);
            std::process::exit(0);
        }
    }

    let show_item = CustomMenuItem::new("show", "显示窗口");
    let quit_item = CustomMenuItem::new("quit", "退出");
    let tray_menu = SystemTrayMenu::new()
        .add_item(show_item)
        .add_item(quit_item);
    let tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .system_tray(tray)
        .manage(Arc::new(Mutex::new(PetHit::default())))
        .setup(|app| {
            // 桌面宠物窗点击穿透：轮询光标，命中「可交互矩形」时才接收鼠标事件
            let handle = app.handle();
            std::thread::spawn(move || {
                let mut last: Option<bool> = None;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(40));
                    let Some(win) = handle.get_window("pet") else {
                        last = None;
                        continue;
                    };
                    let rects = handle
                        .state::<Arc<Mutex<PetHit>>>()
                        .lock()
                        .map(|s| s.rects.clone())
                        .unwrap_or_default();
                    let (Ok(scale), Ok(pos)) = (win.scale_factor(), win.outer_position())
                    else {
                        continue;
                    };
                    let mut pt = POINT { x: 0, y: 0 };
                    let ok = unsafe { GetCursorPos(&mut pt) };
                    if ok == 0 {
                        continue;
                    }
                    let lx = (pt.x - pos.x) as f64 / scale;
                    let ly = (pt.y - pos.y) as f64 / scale;
                    let inside = rects.iter().any(|r| {
                        lx >= r[0] && lx <= r[0] + r[2] && ly >= r[1] && ly <= r[1] + r[3]
                    });
                    let ignore = !inside;
                    if last != Some(ignore) {
                        let _ = win.set_ignore_cursor_events(ignore);
                        last = Some(ignore);
                    }
                }
            });
            Ok(())
        })
        .on_system_tray_event(|app, event| {
            match event {
                SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                },
                // 左键单击 / 双击托盘图标 → 直接显示主窗口
                SystemTrayEvent::LeftClick { .. } | SystemTrayEvent::DoubleClick { .. } => {
                    show_main_window(app);
                }
                _ => {}
            }
        })
        .on_window_event(|event| {
            if let WindowEvent::CloseRequested { api, .. } = event.event() {
                // 仅拦截主窗口（最小化到托盘/退出交由前端决定）；
                // 其它窗口（如本地库媒体查看器）正常关闭即可
                if event.window().label() == "main" {
                    api.prevent_close();
                    let _ = event.window().emit("close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
          network::network_fetch,
          network::network_get_system_proxy_url,
          network::set_auto_start,
          network::get_auto_start,
          network::quit_app,
          network::relaunch_app,
          set_tray_tooltip,
          pet_set_hit_rects,
          extract_archive,
          mega::mega_download,
          wd14::wd14_start,
          wd14::wd14_tag,
          wd14::wd14_stop,
          wd14::wd14_download,
          wd14::wd14_setup_external,
          wd14_infer::wd14_builtin_tag,
          wd14_infer::wd14_model_download,
          wd14_infer::wd14_release,
          media_proxy::media_proxy_port,
          image_search::reverse_image_search,
          image_search::take_image_search_arg,
          image_search::take_pending_image_search,
          image_search::take_pixiv_auth_arg,
          image_search::take_pending_pixiv_auth,
          image_search::set_pixiv_auth_scheme,
          image_search::set_image_search_explorer_menu,
          backup::export_user_backup,
          backup::import_user_backup,
          hpoi_index::import_hpoi_index,
          hpoi_index::install_bundled_hpoi_index,
          open_url::open_url_foreground,
          fsutil::get_path_mtimes,
          fsutil::get_folder_stats,
          fsutil::generate_thumbnail,
          fsutil::copy_files_to_clipboard,
          fsutil::convert_video_to_gif,
          fsutil::video_thumbnail,
          fsutil::download_and_convert_ugoira,
          fsutil::copy_image_to_clipboard,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}