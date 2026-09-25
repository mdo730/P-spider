use serde::Serialize;
use std::time::UNIX_EPOCH;

/// 批量读取路径的修改时间（毫秒时间戳）；路径不存在或读取失败返回 None。
/// 用途：本地库按日期排序（文件夹取目录自身 mtime，文件取文件 mtime）。
#[tauri::command]
pub fn get_path_mtimes(paths: Vec<String>) -> Vec<Option<u64>> {
    paths
        .into_iter()
        .map(|p| {
            std::fs::metadata(&p)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderStats {
    file_count: u64,
    total_bytes: u64,
}

/// 递归统计文件夹内的文件总数与总占用字节数（供「属性」展示）。
#[tauri::command]
pub fn get_folder_stats(path: String) -> Result<FolderStats, String> {
    let mut file_count: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut stack = vec![std::path::PathBuf::from(&path)];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    stack.push(entry.path());
                } else {
                    file_count += 1;
                    total_bytes += meta.len();
                }
            }
        }
    }
    Ok(FolderStats {
        file_count,
        total_bytes,
    })
}

/// 生成缩略图：源图解码 → 缩放到 size×size 居中裁剪 → 存 jpg（quality 82）。
/// 在 Rust 线程执行，不占用 WebView 渲染线程与内存，避免批量生成时白屏/OOM。
/// 先读图片头检查尺寸，超大图直接拒绝（防解压炸弹）。
#[tauri::command]
pub fn generate_thumbnail(src: String, dst: String, size: u32) -> Result<(), String> {
    use image::ImageEncoder;

    let size = size.clamp(16, 4096);
    const MAX_SIDE: u32 = 12000;
    const MAX_PIXELS: u64 = 50_000_000; // ~50MP，超出的图不生成缩略图（回退显示原图）

    // 先读头部尺寸，拒绝超大图（防解压炸弹导致内存尖峰）
    let dim_reader = image::io::Reader::open(&src)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let (w, h) = dim_reader.into_dimensions().map_err(|e| e.to_string())?;
    if w == 0 || h == 0 {
        return Err("图片尺寸为 0".into());
    }
    if w > MAX_SIDE || h > MAX_SIDE || (w as u64) * (h as u64) > MAX_PIXELS {
        return Err(format!("图片过大，跳过: {w}x{h}"));
    }

    // 重新打开并解码
    let reader = image::io::Reader::open(&src)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let img = reader.decode().map_err(|e| e.to_string())?;

    // 缩放到覆盖 size×size 后居中裁剪（保持比例、不拉伸）
    let thumb = img.resize_to_fill(size, size, image::imageops::FilterType::Triangle);
    let rgb = thumb.to_rgb8();

    if let Some(parent) = std::path::Path::new(&dst).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = std::fs::File::create(&dst).map_err(|e| e.to_string())?;
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(file, 82);
    encoder
        .write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 把一批本地文件（切割图）以「文件列表」写入系统剪贴板。
/// 粘贴到聊天软件/资源管理器即得到 N 个图片附件（Windows CF_HDROP）。
#[tauri::command]
pub fn copy_files_to_clipboard(paths: Vec<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        use clipboard_win::{raw, Clipboard};
        let _clip = Clipboard::new_attempts(10).map_err(|e| e.to_string())?;
        raw::set_file_list(&paths).map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = paths;
        Err("仅支持 Windows".into())
    }
}

