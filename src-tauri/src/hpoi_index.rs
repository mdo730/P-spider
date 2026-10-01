//! hpoi 离线索引导入：从发布的可选种子 zip 里提取预构建索引到 appDataDir/hpoi-index。
//! 只认白名单文件名，取 basename 防目录穿越；种子 jsonl（seed/*.jsonl）会被忽略。

use std::fs;
use std::io::Read;
use std::path::Path;
use tauri::AppHandle;

const ALLOW: [&str; 8] = [
    "hobby.json",
    "company.json",
    "series.json",
    "works.json",
    "charactar.json",
    "person.json",
    "meta.json",
    "delta.json",
];

fn basename(name: &str) -> Option<&str> {
    let b = name.rsplit(['/', '\\']).next().unwrap_or("");
    if b.is_empty() || b == "." || b == ".." || b.contains(':') {
        None
    } else {
        Some(b)
    }
}

/// 从 src(zip) 提取 hpoi 索引到 dest_dir，返回写入的文件名列表。
#[tauri::command]
pub fn import_hpoi_index(dest_dir: String, src: String) -> Result<Vec<String>, String> {
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let file = fs::File::open(&src).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("打开压缩包失败：{}", e))?;

    let mut written: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let bn = match basename(entry.name()) {
            Some(b) => b.to_string(),
            None => continue,
        };
        if !ALLOW.contains(&bn.as_str()) {
            continue;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        fs::write(Path::new(&dest_dir).join(&bn), &buf).map_err(|e| e.to_string())?;
        written.push(bn);
    }

    if !written.iter().any(|n| n == "hobby.json") {
        return Err("压缩包里没有找到 hpoi 索引（缺少 hobby.json）".into());
    }
    Ok(written)
}

/// 首启释放「安装包内置的索引」到 appDataDir/hpoi-index（已存在则跳过）。
/// 返回释放的文件数；未内置/无资源时返回 Err（调用方可忽略）。
#[tauri::command]
pub fn install_bundled_hpoi_index(app: AppHandle) -> Result<usize, String> {
    let resolver = app.path_resolver();
    let dest = resolver
        .app_data_dir()
        .ok_or_else(|| "无法获取应用数据目录".to_string())?
        .join("hpoi-index");
    if dest.join("hobby.json").is_file() {
        return Ok(0); // 已安装
    }
    let res = resolver
        .resource_dir()
        .ok_or_else(|| "无法获取资源目录".to_string())?;
    let src = [res.join("resources").join("hpoi-index"), res.join("hpoi-index")]
        .into_iter()
        .find(|p| p.join("hobby.json").is_file())
        .ok_or_else(|| "安装包内未找到内置索引".to_string())?;
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let mut n = 0usize;
    for name in ALLOW {
        let f = src.join(name);
        if f.is_file() {
            fs::copy(&f, dest.join(name)).map_err(|e| e.to_string())?;
            n += 1;
        }
    }
    Ok(n)
}
