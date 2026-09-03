pub mod artwork;
pub mod models;
pub mod platform;
pub mod scanner;

pub use models::{AudioTrackInfo, LibraryPermissionStatus};

use std::collections::HashSet;
use std::path::PathBuf;

pub fn get_music_permission_status() -> LibraryPermissionStatus {
    platform::android::get_permission_status()
}

pub fn scan_music_library(custom_dirs: Option<Vec<String>>) -> Vec<AudioTrackInfo> {
    // 1. Android MediaStore path
    #[cfg(target_os = "android")]
    {
        if custom_dirs.is_none() || custom_dirs.as_ref().map(|d| d.is_empty()).unwrap_or(true) {
            let media_store_tracks = platform::android::scan_media_store();
            if !media_store_tracks.is_empty() {
                return media_store_tracks;
            }
        }
    }

    // 2. Resolve roots for desktop scanning or custom directory picks
    let mut scan_roots: Vec<PathBuf> = Vec::new();

    if let Some(dirs) = custom_dirs {
        for d in dirs {
            let p = PathBuf::from(d);
            if p.exists() && p.is_dir() {
                scan_roots.push(p);
            }
        }
    }

    if scan_roots.is_empty() {
        #[cfg(target_os = "windows")]
        {
            scan_roots.extend(platform::windows::get_music_directories());
        }

        #[cfg(target_os = "macos")]
        {
            scan_roots.extend(platform::macos::get_music_directories());
        }

        #[cfg(target_os = "linux")]
        {
            scan_roots.extend(platform::linux::get_music_directories());
        }

        #[cfg(target_os = "android")]
        {
            for p in &[
                "/storage/emulated/0/Music",
                "/storage/emulated/0/Download",
                "/sdcard/Music",
                "/sdcard/Download",
            ] {
                let path = PathBuf::from(p);
                if path.exists() {
                    scan_roots.push(path);
                }
            }
        }
    }

    let mut results = Vec::new();
    let mut seen_uris = HashSet::new();

    for root in scan_roots {
        let mut batch = Vec::new();
        scanner::scan_local_directory(&root, 5, &mut batch, 5000);
        for track in batch {
            if seen_uris.insert(track.uri.clone()) {
                results.push(track);
            }
        }
    }

    // Default sort: newest added / modified first
    results.sort_by(|a, b| {
        let time_a = a.created_timestamp_ms.max(a.modified_timestamp_ms);
        let time_b = b.created_timestamp_ms.max(b.modified_timestamp_ms);
        time_b.cmp(&time_a)
    });

    results
}

pub fn delete_audio_track(path_or_uri: &str) -> Result<(), String> {
    if path_or_uri.starts_with("content://") {
        #[cfg(target_os = "android")]
        {
            return platform::android::delete_track(path_or_uri);
        }
        #[cfg(not(target_os = "android"))]
        {
            return Err("Content URIs are only supported on Android.".to_string());
        }
    }

    let local_path = if let Some(stripped) = path_or_uri.strip_prefix("file://") {
        percent_encoding_decode(stripped)
    } else {
        path_or_uri.to_string()
    };

    let p = std::path::Path::new(&local_path);
    if p.exists() {
        std::fs::remove_file(p).map_err(|e| format!("Failed to delete file: {e}"))
    } else {
        Err(format!("File does not exist: {local_path}"))
    }
}

pub fn set_as_ringtone(path_or_uri: &str) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        platform::android::set_ringtone(path_or_uri)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = path_or_uri;
        Err("Ringtone setting is only available on mobile Android devices.".to_string())
    }
}

pub fn share_audio_track(path_or_uri: &str, title: &str, mime_type: &str) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        platform::android::share_track(path_or_uri, title, mime_type)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (path_or_uri, title, mime_type);
        Ok(())
    }
}

pub(crate) fn percent_encoding_decode(input: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = input.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            if let (Some(h1), Some(h2)) = (chars.next(), chars.next()) {
                if let Ok(val) = u8::from_str_radix(
                    &format!("{}{}", h1 as char, h2 as char),
                    16,
                ) {
                    bytes.push(val);
                    continue;
                }
            }
        }
        bytes.push(b);
    }
    String::from_utf8_lossy(&bytes).to_string()
}

pub fn resolve_single_track(path_or_uri: &str) -> Result<AudioTrackInfo, String> {
    if path_or_uri.starts_with("content://") {
        #[cfg(target_os = "android")]
        {
            // Reuse statUri bridge (same protocol as stat_media_paths) for real
            // name/size/duration instead of a stub. No eager staging/copy here;
            // playback stages lazily via ensure_local_path.
            let raw = crate::android_fs::call_static_string_quiet("statUri", path_or_uri);
            let mut parts = raw.splitn(5, '\t');
            let name = parts.next().unwrap_or("");
            let size_bytes = parts
                .next()
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(0)
                .max(0) as u64;
            let duration_secs = parts.next().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0).max(0)
                as f64
                / 1000.0;
            let ok = parts.next().map(|s| s.trim() == "1").unwrap_or(false);
            let perm = parts.next().map(|s| s.trim() == "1").unwrap_or(false);
            if ok && !name.is_empty() {
                let ext = name
                    .rsplit('.')
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let (format, mime_type) = if ext.is_empty() {
                    ("audio".to_string(), "audio/*".to_string())
                } else {
                    (ext.clone(), scanner::mime_for_ext(&ext))
                };
                return Ok(AudioTrackInfo {
                    id: format!("uri_{path_or_uri}"),
                    uri: path_or_uri.to_string(),
                    path: None,
                    name: name.to_string(),
                    title: Some(name.to_string()),
                    artist: None,
                    album: None,
                    duration_secs,
                    size_bytes,
                    modified_timestamp_ms: 0,
                    created_timestamp_ms: 0,
                    format,
                    mime_type,
                    cover_url: None,
                });
            }
            if perm {
                return Err("Permission denied — please grant media access in Settings".to_string());
            }
            return Err("Could not read file info".to_string());
        }
        #[cfg(not(target_os = "android"))]
        {
            return Err("Content URIs are only supported on Android.".to_string());
        }
    }

    let local_path = if let Some(stripped) = path_or_uri.strip_prefix("file://") {
        percent_encoding_decode(stripped)
    } else {
        path_or_uri.to_string()
    };

    let p = std::path::Path::new(&local_path);
    if !p.exists() {
        return Err(format!("File does not exist: {local_path}"));
    }

    let file_name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "track".to_string());

    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp3")
        .to_ascii_lowercase();

    let meta = p.metadata().ok();
    let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified_timestamp_ms = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let created_timestamp_ms = meta
        .as_ref()
        .and_then(|m| m.created().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(modified_timestamp_ms);

    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| file_name.clone());

    let (mut artist, mut title) = if let Some((a, t)) = stem.split_once(" - ") {
        (Some(a.trim().to_string()), Some(t.trim().to_string()))
    } else {
        (None, Some(stem))
    };
    let mut album = None;
    let mut duration_secs = 0.0;

    if let Ok(ffprobe) = crate::ffmpeg::locate::locate("ffprobe") {
        if let Ok(probe) = crate::ffmpeg::probe::probe_file(&ffprobe, &local_path) {
            duration_secs = probe.duration_secs().unwrap_or(0.0);
            if let Some(tags) = probe.format.and_then(|f| f.tags) {
                for (k, v) in tags {
                    match k.to_ascii_lowercase().as_str() {
                        "title" if title.as_deref() != Some(&v) => title = Some(v),
                        "artist" => artist = Some(v),
                        "album" => album = Some(v),
                        _ => {}
                    }
                }
            }
        }
    }

    let cover_url = scanner::find_local_cover_image(p);

    Ok(AudioTrackInfo {
        id: format!("local_{local_path}"),
        uri: format!("file://{local_path}"),
        path: Some(local_path),
        name: file_name,
        title,
        artist,
        album,
        duration_secs,
        size_bytes,
        modified_timestamp_ms,
        created_timestamp_ms,
        format: ext.clone(),
        mime_type: scanner::mime_for_ext(&ext),
        cover_url,
    })
}
