//! 启动器：启动 exe / 打开文件夹，以及从系统图标库提取图标缓存为 PNG。
//!
//! 图标提取走 `SHGetFileInfoW` 拿到 HICON，再用 GDI 把颜色位图读成 RGBA，
//! 交给 image crate 编码成 PNG。前端用 asset 协议展示缓存文件。

use std::ffi::{c_void, OsStr};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use image::{ImageBuffer, Rgba};
use tauri::AppHandle;

use windows_sys::Win32::Foundation::POINT;
use windows_sys::Win32::Graphics::Gdi::{
  DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
  BITMAPINFOHEADER, DIB_RGB_COLORS,
};
use windows_sys::Win32::UI::Shell::{
  ShellExecuteW, SHFILEINFOW, SHGetFileInfoW, SHGFI_ICON, SHGFI_LARGEICON,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  DestroyIcon, GetCursorPos, GetIconInfo, ICONINFO,
};

fn to_wide(path: &Path) -> Vec<u16> {
  OsStr::new(path)
    .encode_wide()
    .chain(std::iter::once(0))
    .collect()
}

/// 启动 exe 或用资源管理器打开文件夹/文件。
#[tauri::command]
pub fn launcher_open(path: String) -> Result<(), String> {
  let target = PathBuf::from(path.trim());
  if !target.is_absolute() {
    return Err("只支持绝对路径".to_string());
  }
  if !target.exists() {
    return Err(format!("路径不存在：{}", target.display()));
  }

  let op: Vec<u16> = "open\0".encode_utf16().collect();
  let file = to_wide(&target);
  let ret = unsafe {
    ShellExecuteW(
      0,
      op.as_ptr(),
      file.as_ptr(),
      std::ptr::null(),
      std::ptr::null(),
      1,
    )
  } as isize;
  if ret <= 32 {
    return Err(format!("启动失败（ShellExecute={ret}）"));
  }
  Ok(())
}

/// 当前鼠标的屏幕物理坐标（外部拖入文件时用于命中标签行）。
#[tauri::command]
pub fn launcher_cursor_position() -> Result<(i32, i32), String> {
  let mut point: POINT = unsafe { std::mem::zeroed() };
  let ok = unsafe { GetCursorPos(&mut point) };
  if ok == 0 {
    return Err("获取光标位置失败".to_string());
  }
  Ok((point.x, point.y))
}

/// 从 Windows 系统图标库提取指定路径的图标，缓存为 PNG，返回缓存文件绝对路径。
///
/// 缓存键包含路径与修改时间：exe 更新后图标会自动刷新。
#[tauri::command]
pub fn launcher_icon(app: AppHandle, path: String) -> Result<String, String> {
  let target = PathBuf::from(path.trim());
  if !target.exists() {
    return Err("路径不存在".to_string());
  }

  let dir = app
    .path_resolver()
    .app_data_dir()
    .ok_or_else(|| "无法获取应用数据目录".to_string())?
    .join("launcher-icons");
  std::fs::create_dir_all(&dir).map_err(|e| format!("创建图标缓存目录失败：{e}"))?;

  let out = dir.join(format!("{}.png", cache_key(&target)));
  if out.is_file() {
    return Ok(out.to_string_lossy().to_string());
  }

  let img = extract_icon_rgba(&target)?;
  img
    .save(&out)
    .map_err(|e| format!("写入图标缓存失败：{e}"))?;
  Ok(out.to_string_lossy().to_string())
}

fn cache_key(path: &Path) -> String {
  let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
  let mut feed = |bytes: &[u8]| {
    for b in bytes {
      hash ^= *b as u64;
      hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
  };
  feed(path.to_string_lossy().as_bytes());
  if let Ok(meta) = std::fs::metadata(path) {
    if let Ok(modified) = meta.modified() {
      if let Ok(d) = modified.duration_since(UNIX_EPOCH) {
        feed(&d.as_secs().to_le_bytes());
      }
    }
  }
  format!("{hash:016x}")
}

fn extract_icon_rgba(path: &Path) -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String> {
  let wide = to_wide(path);
  let mut info: SHFILEINFOW = unsafe { std::mem::zeroed() };
  let flags = SHGFI_ICON | SHGFI_LARGEICON;
  let ok = unsafe {
    SHGetFileInfoW(
      wide.as_ptr(),
      0,
      &mut info,
      std::mem::size_of::<SHFILEINFOW>() as u32,
      flags,
    )
  };
  if ok == 0 || info.hIcon == 0 {
    return Err("无法获取系统图标".to_string());
  }
  let hicon = info.hIcon;

  let result = unsafe { hicon_to_image(hicon) };
  unsafe { DestroyIcon(hicon) };
  result
}

unsafe fn hicon_to_image(
  hicon: isize,
) -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String> {
  let mut icon_info: ICONINFO = std::mem::zeroed();
  if GetIconInfo(hicon, &mut icon_info) == 0 {
    return Err("读取图标信息失败".to_string());
  }
  let hbm_color = icon_info.hbmColor;
  let hbm_mask = icon_info.hbmMask;
  if hbm_color == 0 {
    if hbm_mask != 0 {
      DeleteObject(hbm_mask);
    }
    return Err("图标没有颜色位图".to_string());
  }

  let mut bmp: BITMAP = std::mem::zeroed();
  let got = GetObjectW(
    hbm_color,
    std::mem::size_of::<BITMAP>() as i32,
    &mut bmp as *mut _ as *mut c_void,
  );
  if got == 0 || bmp.bmWidth <= 0 || bmp.bmHeight <= 0 {
    DeleteObject(hbm_color);
    DeleteObject(hbm_mask);
    return Err("读取图标尺寸失败".to_string());
  }
  let width = bmp.bmWidth as u32;
  let height = bmp.bmHeight as u32;

  let mut bi: BITMAPINFO = std::mem::zeroed();
  bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
  bi.bmiHeader.biWidth = width as i32;
  bi.bmiHeader.biHeight = -(height as i32);
  bi.bmiHeader.biPlanes = 1;
  bi.bmiHeader.biBitCount = 32;
  bi.bmiHeader.biCompression = 0;

  let mut buf = vec![0u8; (width * height * 4) as usize];
  let hdc = GetDC(0);
  let lines = GetDIBits(
    hdc,
    hbm_color,
    0,
    height,
    buf.as_mut_ptr() as *mut c_void,
    &mut bi,
    DIB_RGB_COLORS,
  );
  ReleaseDC(0, hdc);
  DeleteObject(hbm_color);
  if hbm_mask != 0 {
    DeleteObject(hbm_mask);
  }
  if lines == 0 {
    return Err("读取图标像素失败".to_string());
  }

  let has_alpha = buf
    .chunks_exact(4)
    .any(|px| px[3] != 0);

  let mut img = ImageBuffer::<Rgba<u8>, Vec<u8>>::new(width, height);
  for y in 0..height {
    for x in 0..width {
      let i = ((y * width + x) * 4) as usize;
      let b = buf[i];
      let g = buf[i + 1];
      let r = buf[i + 2];
      let a = if has_alpha { buf[i + 3] } else { 255 };
      img.put_pixel(x, y, Rgba([r, g, b, a]));
    }
  }
  Ok(img)
}
