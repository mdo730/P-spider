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
/// text 非空时同一会话再追加文本格式（CF_UNICODETEXT）；
/// html 非空时再追加 HTML 格式（CF_HTML，含内联图片+文本），富文本框可一次贴出「图片 + 文本」。
#[tauri::command]
pub fn copy_files_to_clipboard(
    paths: Vec<String>,
    text: Option<String>,
    html: Option<String>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use clipboard_win::{formats, raw, Clipboard};
        let _clip = Clipboard::new_attempts(10).map_err(|e| e.to_string())?;
        raw::set_file_list(&paths).map_err(|e| e.to_string())?;
        if let Some(t) = text {
            if !t.is_empty() {
                // CF_UNICODETEXT：UTF-16LE，末尾 NUL；set_without_clear 以免清掉刚写入的文件列表
                let mut utf16: Vec<u16> = t.encode_utf16().collect();
                utf16.push(0);
                let bytes: Vec<u8> = utf16.iter().flat_map(|u| u.to_le_bytes()).collect();
                raw::set_without_clear(formats::CF_UNICODETEXT, &bytes)
                    .map_err(|e| e.to_string())?;
            }
        }
        if let Some(h) = html {
            if !h.is_empty() {
                if let Some(fmt) = raw::register_format("HTML Format") {
                    raw::set_without_clear(fmt.get(), h.as_bytes())
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = (paths, text, html);
        Err("仅支持 Windows".into())
    }
}

/// 找 ffmpeg：优先 PATH，其次常见固定位置（用户机器上实测在 C:\Windows\ffmpeg.exe）
fn ffmpeg_candidates() -> Vec<String> {
    let mut v = vec!["ffmpeg".to_string()];
    if let Ok(pf) = std::env::var("ProgramFiles") {
        v.push(format!("{pf}\\ffmpeg\\bin\\ffmpeg.exe"));
    }
    v.push("C:\\Windows\\ffmpeg.exe".to_string());
    v.push("C:\\ffmpeg\\bin\\ffmpeg.exe".to_string());
    v
}

/// 用系统 ffmpeg 抽视频首帧为 jpg 缩略图（`size`×`size` 居中裁剪）。
/// 优先取 0.5s 处（避开纯黑首帧），太短/失败则退回第 0 帧。
#[tauri::command]
pub fn video_thumbnail(src: String, dst: String, size: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let vf = format!(
            "scale={s}:{s}:force_original_aspect_ratio=increase,crop={s}:{s}",
            s = size
        );
        let mut last_err = String::from("未找到 ffmpeg");
        for exe in ffmpeg_candidates() {
            // 先试 0.5s；没有产出再试第 0 帧
            for seek in [Some("0.5"), None] {
                let mut args: Vec<String> = vec![
                    "-y".into(),
                    "-hide_banner".into(),
                    "-loglevel".into(),
                    "error".into(),
                ];
                if let Some(t) = seek {
                    args.push("-ss".into());
                    args.push(t.into());
                }
                args.push("-i".into());
                args.push(src.clone());
                args.push("-frames:v".into());
                args.push("1".into());
                args.push("-vf".into());
                args.push(vf.clone());
                args.push(dst.clone());

                match std::process::Command::new(&exe)
                    .args(&args)
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                {
                    Ok(o) => {
                        if o.status.success() && std::path::Path::new(&dst).is_file() {
                            return Ok(());
                        }
                        last_err = String::from_utf8_lossy(&o.stderr).trim().to_string();
                        if last_err.is_empty() {
                            last_err = format!("ffmpeg 退出码 {:?}", o.status.code());
                        }
                    }
                    Err(e) => {
                        last_err = format!("{exe} 调用失败：{e}");
                        break; // 这个 exe 不存在，换下一个
                    }
                }
            }
        }
        return Err(last_err);
    }
    #[cfg(not(windows))]
    {
        let _ = (src, dst, size);
        Err("仅支持 Windows".into())
    }
}

/// 用系统 ffmpeg 把视频（GIF 的 mp4）转成真实 .gif（“下载即转”用）。
/// 需要系统 PATH 中有 ffmpeg；没有则返回错误，调用方保留 mp4。
#[tauri::command]
pub fn convert_video_to_gif(src: String, dst: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let status = std::process::Command::new("ffmpeg")
            .args([
                "-y",
                "-i",
                &src,
                "-vf",
                "fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
                "-loop",
                "0",
                &dst,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| format!("未能运行 ffmpeg（请确认已安装并在 PATH 中）：{e}"))?;
        if !status.success() {
            return Err(format!("ffmpeg 退出码 {:?}", status.code()));
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = (src, dst);
        Err("仅支持 Windows".into())
    }
}

/// 下载 pixiv ugoira 的 zip → 解压帧序列 → 用系统 ffmpeg 合成 mp4（或 gif）。
/// `frames_json`：[{"file":"000000.jpg","delay":100}]（delay 毫秒）。
/// 供 pixiv 动图下载（默认 mp4；勾选「GIF 转真 gif」时 format=gif）。
#[tauri::command]
pub async fn download_and_convert_ugoira(
    url: String,
    headers: std::collections::HashMap<String, String>,
    enable_proxy: bool,
    proxy_url: String,
    frames_json: String,
    out_path: String,
    format: String,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::io::Write;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        // 1) 下载 zip（走应用代理；带 Referer 破防盗链）
        let mut b = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(120));
        if enable_proxy && !proxy_url.is_empty() {
            let ph = reqwest::Proxy::http(proxy_url.clone()).map_err(|e| e.to_string())?;
            let ps = reqwest::Proxy::https(proxy_url.clone()).map_err(|e| e.to_string())?;
            b = b.proxy(ph).proxy(ps);
        } else if !enable_proxy {
            b = b.no_proxy();
        }
        let client = b.build().map_err(|e| e.to_string())?;
        let mut req = client.get(&url);
        for (k, v) in headers {
            req = req.header(k, v);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("下载 ugoira zip 失败：HTTP {}", resp.status().as_u16()));
        }
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

        // 2) 临时目录
        let nanos = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let tmp = std::env::temp_dir().join(format!(
            "p-spider-ugoira-{}-{}",
            std::process::id(),
            nanos
        ));
        std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
        let zip_path = tmp.join("ugoira.zip");
        std::fs::write(&zip_path, &bytes).map_err(|e| e.to_string())?;

        let result = (|| -> Result<(), String> {
            // 3) 解压（只取文件名，平铺到临时目录）
            let zip_file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(zip_file).map_err(|e| e.to_string())?;
            for i in 0..archive.len() {
                let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
                let name = entry.name().to_string();
                if name.ends_with('/') {
                    continue;
                }
                let safe = name.rsplit('/').next().unwrap_or(&name).to_string();
                if safe.is_empty() {
                    continue;
                }
                let mut out = std::fs::File::create(tmp.join(&safe)).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            }

            // 4) 生成 concat 清单
            #[derive(serde::Deserialize)]
            struct Frame {
                file: String,
                delay: u64,
            }
            let frames: Vec<Frame> = serde_json::from_str(&frames_json).unwrap_or_default();
            let mut seq: Vec<(String, u64)> = Vec::new();
            for f in &frames {
                let p = tmp.join(&f.file);
                if p.is_file() {
                    seq.push((p.to_string_lossy().replace('\\', "/"), f.delay.max(20)));
                }
            }
            if seq.is_empty() {
                let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&tmp)
                    .map_err(|e| e.to_string())?
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| {
                        p.is_file()
                            && p.extension()
                                .and_then(|x| x.to_str())
                                .map(|x| !x.eq_ignore_ascii_case("zip"))
                                .unwrap_or(false)
                    })
                    .collect();
                files.sort();
                for p in files {
                    seq.push((p.to_string_lossy().replace('\\', "/"), 100));
                }
            }
            if seq.is_empty() {
                return Err("ugoira 解压后没有帧".into());
            }

            let list_path = tmp.join("frames.txt");
            {
                let mut f = std::fs::File::create(&list_path).map_err(|e| e.to_string())?;
                for (p, delay) in &seq {
                    writeln!(f, "file '{}'", p.replace('\'', "'\\''")).map_err(|e| e.to_string())?;
                    writeln!(f, "duration {:.3}", *delay as f64 / 1000.0)
                        .map_err(|e| e.to_string())?;
                }
                if let Some((p, _)) = seq.last() {
                    writeln!(f, "file '{}'", p.replace('\'', "'\\''")).map_err(|e| e.to_string())?;
                }
            }

            // 5) ffmpeg 合成
            let list_arg = list_path.to_string_lossy().replace('\\', "/");
            let scale = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
            let is_gif = format.eq_ignore_ascii_case("gif");
            let mut last_err = String::from("未找到 ffmpeg");
            for exe in ffmpeg_candidates() {
                let mut cmd = std::process::Command::new(&exe);
                cmd.creation_flags(CREATE_NO_WINDOW);
                if is_gif {
                    let vf = format!(
                        "fps=12,{},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
                        scale
                    );
                    cmd.args([
                        "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
                        "-i", &list_arg, "-vf", &vf, "-loop", "0", &out_path,
                    ]);
                } else {
                    cmd.args([
                        "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
                        "-i", &list_arg, "-vsync", "vfr", "-pix_fmt", "yuv420p", "-vf", scale,
                        &out_path,
                    ]);
                }
                match cmd.output() {
                    Ok(o) => {
                        if o.status.success() && std::path::Path::new(&out_path).is_file() {
                            return Ok(());
                        }
                        last_err = String::from_utf8_lossy(&o.stderr).trim().to_string();
                        if last_err.is_empty() {
                            last_err = format!("ffmpeg 退出码 {:?}", o.status.code());
                        }
                    }
                    Err(e) => {
                        last_err = format!("{exe} 调用失败：{e}");
                        break;
                    }
                }
            }
            Err(last_err)
        })();

        let _ = std::fs::remove_dir_all(&tmp);
        result
    }
    #[cfg(not(windows))]
    {
        let _ = (
            url,
            headers,
            enable_proxy,
            proxy_url,
            frames_json,
            out_path,
            format,
        );
        Err("仅支持 Windows".into())
    }
}

