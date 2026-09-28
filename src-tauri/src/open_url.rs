//! 打开外部链接，并把默认浏览器窗口提到最前。
//!
//! 以图搜图场景：app 可能根本不在前台（资源管理器右键启动的实例、或被最小化到托盘），
//! 这时只用 shell.open 打开链接，浏览器往往会开在后台，用户看不到结果。
//! 这里补一次前台激活（AllowSetForegroundWindow + SetForegroundWindow）。

use std::os::windows::process::CommandExt;
use windows_sys::Win32::Foundation::{CloseHandle, LPARAM, BOOL, HWND};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, KEYEVENTF_KEYUP, VK_MENU,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, EnumWindows, GetWindowTextLengthW, GetWindowThreadProcessId,
    IsWindowVisible, SetForegroundWindow, ShowWindow, ASFW_ANY, SW_RESTORE,
};

/// 不弹黑框
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 常见浏览器/内嵌浏览器的进程名关键字
const BROWSER_HINTS: &[&str] = &[
    "chrome",
    "msedge",
    "firefox",
    "brave",
    "opera",
    "vivaldi",
    "chromium",
    "iexplore",
    "360se",
    "360chrome",
    "qqbrowser",
    "sogouexplorer",
    "maxthon",
];

fn exe_name_of(hwnd: HWND) -> Option<String> {
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    if pid == 0 {
        return None;
    }
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle == 0 {
        return None;
    }
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut len) };
    unsafe { CloseHandle(handle) };
    if ok == 0 {
        return None;
    }
    let full = String::from_utf16_lossy(&buf[..len as usize]);
    full.rsplit(['\\', '/'])
        .next()
        .map(|s| s.to_ascii_lowercase())
}

unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let out = &mut *(lparam as *mut Vec<HWND>);
    if IsWindowVisible(hwnd) == 0 || GetWindowTextLengthW(hwnd) == 0 {
        return 1;
    }
    if let Some(name) = exe_name_of(hwnd) {
        if BROWSER_HINTS.iter().any(|h| name.contains(h)) {
            out.push(hwnd);
        }
    }
    1
}

/// 把找到的第一个浏览器顶层窗口提到最前
fn focus_browser() {
    let mut found: Vec<HWND> = Vec::new();
    unsafe {
        EnumWindows(Some(enum_cb), &mut found as *mut Vec<HWND> as LPARAM);
    }
    if let Some(&hwnd) = found.first() {
        unsafe {
            // 解锁前台限制的小把戏：模拟一次 ALT 键按下/抬起
            keybd_event(VK_MENU as u8, 0, 0, 0);
            keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);
            ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
        }
    }
}

/// 打开 URL（系统默认浏览器），并尝试把浏览器窗口提到最前
#[tauri::command]
pub fn open_url_foreground(url: String) -> Result<(), String> {
    // 允许随后启动/激活的进程（浏览器）自行抢前台
    unsafe { AllowSetForegroundWindow(ASFW_ANY) };

    std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| e.to_string())?;

    // 同步等待再激活：调用方（资源管理器启动的实例）会紧接着退出进程，
    // 若放到子线程里做，进程一退线程就没了。浏览器窗口创建/切页需要一点时间。
    std::thread::sleep(std::time::Duration::from_millis(700));
    focus_browser();
    std::thread::sleep(std::time::Duration::from_millis(700));
    focus_browser();
    Ok(())
}
