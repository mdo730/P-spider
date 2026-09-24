// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fsutil;
mod network;

use tauri::{CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, WindowEvent};

fn main() {
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
          fsutil::get_path_mtimes,
          fsutil::get_folder_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}