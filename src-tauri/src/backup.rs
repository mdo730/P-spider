//! 用户数据备份：把指定数据文件打包成 zip / 从 zip 恢复。
//! 文件名白名单由前端传入（TS 的 BACKUP_FILES），这里只取 basename，防目录穿越。

use std::fs;
use std::io::{Read, Write};
use std::path::Path;

fn basename(name: &str) -> Option<&str> {
    let b = name.rsplit(['/', '\\']).next().unwrap_or("");
    if b.is_empty() || b == "." || b == ".." || b.contains(':') {
        None
    } else {
        Some(b)
    }
}

/// 导出：把 dir 下白名单内的文件压成 dest(zip)，返回实际打包的文件名列表。
#[tauri::command]
pub fn export_user_backup(
    dir: String,
    dest: String,
    names: Vec<String>,
    meta: String,
) -> Result<Vec<String>, String> {
    let file = fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut included: Vec<String> = Vec::new();
    for name in &names {
        let bn = match basename(name) {
            Some(b) => b,
            None => continue,
        };
        let path = Path::new(&dir).join(bn);
        if !path.is_file() {
            continue;
        }
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        zip.start_file(bn.to_string(), opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
        included.push(bn.to_string());
    }

    zip.start_file("backup-meta.json".to_string(), opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(meta.as_bytes()).map_err(|e| e.to_string())?;

    zip.finish().map_err(|e| e.to_string())?;

    if included.is_empty() {
        return Err("没有可备份的数据文件".into());
    }
    Ok(included)
}

/// 导入：从 src(zip) 恢复白名单内的文件到 dir；原文件先备份为 `<name>.pre-import`。
/// 返回恢复的文件名列表。
#[tauri::command]
pub fn import_user_backup(
    dir: String,
    src: String,
    names: Vec<String>,
) -> Result<Vec<String>, String> {
    let allow: std::collections::HashSet<&str> = names.iter().map(|s| s.as_str()).collect();
    let file = fs::File::open(&src).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut restored: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let bn = match basename(entry.name()) {
            Some(b) => b.to_string(),
            None => continue,
        };
        if !allow.contains(bn.as_str()) {
            continue;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;

        let target = Path::new(&dir).join(&bn);
        if target.is_file() {
            let _ = fs::copy(&target, Path::new(&dir).join(format!("{}.pre-import", bn)));
        }
        fs::write(&target, &buf).map_err(|e| e.to_string())?;
        restored.push(bn);
    }

    if restored.is_empty() {
        return Err("压缩包里没有可恢复的数据文件".into());
    }
    Ok(restored)
}
