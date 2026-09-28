// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup;
mod fsutil;
mod image_search;
mod media_proxy;
mod network;

use tauri::{CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, WindowEvent};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    image_search::capture_cli_args(&args);
    // 单实例：非主实例且带 --image-search → 把路径转给已运行实例后直接退出（不新开窗口）
    let primary = image_search::start_control_listener();
    if !primary {
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
        .on_system_tray_event(|app, event| {
            if let SystemTrayEvent::MenuItemClick { id, .. } = event {
                match id.as_str() {
                    "show" => {
                        if let Some(window) = app.get_window("main") {
                            window.show().ok();
                            window.set_focus().ok();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                }
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
          media_proxy::media_proxy_port,
          image_search::reverse_image_search,
          image_search::take_image_search_arg,
          image_search::take_pending_image_search,
          image_search::set_image_search_explorer_menu,
          backup::export_user_backup,
          backup::import_user_backup,
          fsutil::get_path_mtimes,
          fsutil::get_folder_stats,
          fsutil::generate_thumbnail,
          fsutil::copy_files_to_clipboard,
          fsutil::convert_video_to_gif,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}