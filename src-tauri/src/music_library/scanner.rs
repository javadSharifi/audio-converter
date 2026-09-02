use std::path::Path;
use super::models::AudioTrackInfo;

const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "flac", "wav", "aac", "ogg", "opus", "wma", "aiff", "alac", "weba",
];

fn is_audio_ext(ext: &str) -> bool {
    AUDIO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
}

fn mime_for_ext(ext: &str) -> String {
    match ext.to_ascii_lowercase().as_str() {
        "mp3" => "audio/mpeg".to_string(),
        "m4a" => "audio/mp4".to_string(),
        "aac" => "audio/aac".to_string(),
        "flac" => "audio/flac".to_string(),
        "wav" => "audio/wav".to_string(),
        "ogg" => "audio/ogg".to_string(),
        "opus" => "audio/opus".to_string(),
        "wma" => "audio/x-ms-wma".to_string(),
        "aiff" => "audio/aiff".to_string(),
        _ => "audio/mpeg".to_string(),
    }
}

fn find_local_cover_image(audio_path: &Path) -> Option<String> {
    // 1. Check same stem e.g. "Song Name.jpg" / "Song Name.png"
    for img_ext in &["jpg", "jpeg", "png", "webp"] {
        let candidate = audio_path.with_extension(img_ext);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }

    // 2. Check directory artwork e.g. "cover.jpg", "folder.jpg", "album.jpg"
    if let Some(parent) = audio_path.parent() {
        for cover_name in &[
            "cover.jpg",
            "cover.png",
            "cover.jpeg",
            "cover.webp",
            "folder.jpg",
            "folder.png",
            "album.jpg",
            "album.png",
            "front.jpg",
            "front.png",
        ] {
            let candidate = parent.join(cover_name);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }

    None
}

pub fn scan_local_directory(
    dir: &Path,
    max_depth: usize,
    results: &mut Vec<AudioTrackInfo>,
    max_results: usize,
) {
    scan_recursive(dir, 0, max_depth, results, max_results);
}

fn scan_recursive(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    results: &mut Vec<AudioTrackInfo>,
    max_results: usize,
) {
    if depth > max_depth || results.len() >= max_results {
        return;
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        if results.len() >= max_results {
            break;
        }

        let path = entry.path();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();

        // Skip hidden files/directories and common non-music project folders
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "Library"
            || name == "$RECYCLE.BIN"
            || name == ".Trash"
            || name == "AppData"
            || name == "Windows"
        {
            continue;
        }

        if path.is_dir() {
            scan_recursive(&path, depth + 1, max_depth, results, max_results);
        } else if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if is_audio_ext(ext) {
                    let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    let modified_timestamp_ms = entry
                        .metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    let created_timestamp_ms = entry
                        .metadata()
                        .and_then(|m| m.created())
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(modified_timestamp_ms);

                    let stem = path
                        .file_stem()
                        .map(|s| s.to_string_lossy().into_owned())
                        .unwrap_or_else(|| name.clone());

                    // Try to parse "Artist - Title" if formatted with hyphen
                    let (artist, title) = if let Some((a, t)) = stem.split_once(" - ") {
                        (Some(a.trim().to_string()), Some(t.trim().to_string()))
                    } else {
                        (None, Some(stem))
                    };

                    let path_str = path.to_string_lossy().into_owned();
                    let uri = format!("file://{}", path_str);
                    let ext_lower = ext.to_ascii_lowercase();
                    let cover_url = find_local_cover_image(&path);

                    results.push(AudioTrackInfo {
                        id: format!("local_{}", path_str),
                        uri,
                        path: Some(path_str),
                        name,
                        title,
                        artist,
                        album: None,
                        duration_secs: 0.0,
                        size_bytes,
                        modified_timestamp_ms,
                        created_timestamp_ms,
                        format: ext_lower.clone(),
                        mime_type: mime_for_ext(&ext_lower),
                        cover_url,
                    });
                }
            }
        }
    }
}
