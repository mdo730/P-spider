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

