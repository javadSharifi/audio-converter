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

fn percent_encoding_decode(input: &str) -> String {
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
