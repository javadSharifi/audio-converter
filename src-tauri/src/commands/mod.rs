use std::path::Path;

use serde::Serialize;
use tauri::State;

use crate::error::{AppError, Result};
use crate::ffmpeg::probe;
use crate::queue::{JobRecord, QueueManager};
use crate::settings::Settings;
use crate::types::{ConversionOptions, FileMeta, TrimSpec};

/// Result of pre-resolving one input path (e.g. Android Content URIs to
/// cached local files). `resolved` equals `input` when no staging happened
/// or when staging failed (the error field then explains why).
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedMediaPath {
    pub input: String,
    pub resolved: String,
    pub error: Option<String>,
}

/// Pre-resolve media paths (e.g. Android Content URIs to cached files).
/// Never fails wholesale — each path carries its own optional error so one
/// bad URI cannot blank out the whole batch.
#[tauri::command]
#[specta::specta]
pub async fn resolve_media_paths(paths: Vec<String>) -> Vec<ResolvedMediaPath> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|input| {
                let resolved = crate::android_fs::ensure_local_path(&input);
                let error = (resolved == input && input.starts_with("content://"))
                    .then(|| "Could not copy the selected file into app storage".to_string());
                ResolvedMediaPath {
                    input,
                    resolved,
                    error,
                }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Explicitly delete a previously staged Android input file (user removed
/// the row / cleared the list). No-op on desktop and for any path outside
/// the app's staging directory.
#[tauri::command]
#[specta::specta]
pub fn delete_staged_input(path: String) {
    crate::android_fs::delete_staged_input(&path);
}

/// One entry of `stat_media_paths`: lightweight metadata for a picked URI —
/// NO file copying (staging happens lazily right before each conversion).
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StatMediaPath {
    pub input: String,
    pub name: String,
    #[specta(type = u32)]
    pub size_bytes: u64,
    pub duration_secs: f64,
    pub error: Option<String>,
}

/// Lightweight metadata lookup (name / size / duration) for the picked
/// paths/URIs. Never fails wholesale — each path carries its own error.
#[tauri::command]
#[specta::specta]
pub async fn stat_media_paths(paths: Vec<String>) -> Vec<StatMediaPath> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "android")]
        {
            let joined = paths.join("\n");
            let raw = crate::android_fs::call_static_string_quiet("statUri", &joined);
            let mut lines = raw.split('\n').filter(|l| !l.is_empty());
            paths
                .into_iter()
                .map(|input| {
                    let line = lines.next().unwrap_or("");
                    let mut parts = line.splitn(3, '\t');
                    let name = parts.next().unwrap_or("");
                    let size = parts.next().and_then(|s| s.parse::<i64>().ok());
                    let dur_ms = parts.next().and_then(|s| s.parse::<i64>().ok());
                    match (size, dur_ms) {
                        (Some(size), Some(dur_ms)) if size >= 0 => StatMediaPath {
                            name: if name.is_empty() {
                                file_name_of(&input)
                            } else {
                                name.to_string()
                            },
                            size_bytes: size as u64,
                            duration_secs: dur_ms.max(0) as f64 / 1000.0,
                            input,
                            error: None,
                        },
                        _ => StatMediaPath {
                            name: file_name_of(&input),
                            size_bytes: 0,
                            duration_secs: 0.0,
                            input,
                            error: Some("Could not read file info".into()),
                        },
                    }
                })
                .collect()
        }
        #[cfg(not(target_os = "android"))]
        {
            paths
                .into_iter()
                .map(|input| match std::fs::metadata(&input) {
                    Ok(m) => StatMediaPath {
                        name: file_name_of(&input),
                        size_bytes: m.len(),
                        duration_secs: 0.0,
                        input,
                        error: None,
                    },
                    Err(_) => StatMediaPath {
                        name: file_name_of(&input),
                        size_bytes: 0,
                        duration_secs: 0.0,
                        input,
                        error: Some("Could not read file info".into()),
                    },
                })
                .collect()
        }
    })
    .await
    .unwrap_or_default()
}

/// Whether the required media permissions are granted (Android). Always true
/// on desktop.
#[tauri::command]
#[specta::specta]
pub fn has_media_permissions() -> bool {
    #[cfg(target_os = "android")]
    return crate::android_fs::call_static_bool("hasMediaPermissions");
    #[cfg(not(target_os = "android"))]
    true
}

/// Trigger the Android runtime permission dialog (no-op on desktop).
#[tauri::command]
#[specta::specta]
pub fn request_media_permissions() {
    #[cfg(target_os = "android")]
    let _ = crate::android_fs::call_static_void("requestMediaPermissions");
}

/// Open the system app-settings page so the user can grant permissions.
#[tauri::command]
#[specta::specta]
pub fn open_app_settings() {
    #[cfg(target_os = "android")]
    let _ = crate::android_fs::call_static_void("openAppSettings");
}

/// Probe files for the UI list in parallel with a bounded worker pool.
/// Per-file errors land in `FileMeta.error` instead of failing the whole
/// call. Runs asynchronously without blocking Tauri's main loop.
#[tauri::command]
#[specta::specta]
pub async fn probe_files(paths: Vec<String>) -> Vec<FileMeta> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths: Vec<String> = paths
            .into_iter()
            .map(|p| crate::android_fs::ensure_local_path(&p))
            .collect();

        let Ok(ffprobe) = crate::ffmpeg::locate::locate("ffprobe") else {
            return paths
                .into_iter()
                .map(|p| missing_tool_meta(&p, "ffprobe"))
                .collect();
        };

        if paths.len() <= 1 {
            return paths
                .into_iter()
                .map(|path| match probe_file_meta(&ffprobe, &path) {
                    Ok(meta) => meta,
                    Err(e) => FileMeta {
                        name: file_name_of(&path),
                        path,
                        size_bytes: 0,
                        duration_secs: 0.0,
                        format_name: String::new(),
                        has_audio: false,
                        error: Some(e.to_string()),
                    },
                })
                .collect();
        }

        // Parallel probe with a bounded worker pool — one thread + one ffprobe
        // process per file would thrash on large drops (300 files = 300 spawns).
        let max_workers = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(1, 8);
        let workers = max_workers.min(paths.len());
        let next = std::sync::atomic::AtomicUsize::new(0);
        let results: std::sync::Mutex<Vec<Option<FileMeta>>> =
            std::sync::Mutex::new(vec![None; paths.len()]);

        std::thread::scope(|s| {
            for _ in 0..workers {
                s.spawn(|| loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    if i >= paths.len() {
                        break;
                    }
                    let path = &paths[i];
                    let meta = match probe_file_meta(&ffprobe, path) {
                        Ok(meta) => meta,
                        Err(e) => FileMeta {
                            name: file_name_of(path),
                            path: path.clone(),
                            size_bytes: 0,
                            duration_secs: 0.0,
                            format_name: String::new(),
                            has_audio: false,
                            error: Some(e.to_string()),
                        },
                    };
                    results.lock().unwrap()[i] = Some(meta);
                });
            }
        });

        results
            .into_inner()
            .unwrap()
            .into_iter()
            .map(|m| m.expect("every probe slot filled"))
            .collect()
    })
    .await
    .unwrap_or_default()
}

fn probe_file_meta(ffprobe: &Path, path: &str) -> Result<FileMeta> {
    let probed = probe::probe_file(ffprobe, path)?;
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    Ok(FileMeta {
        name: file_name_of(path),
        path: path.to_string(),
        size_bytes: size,
        duration_secs: probed.duration_secs().unwrap_or(0.0),
        format_name: probed
            .format
            .as_ref()
            .and_then(|f| f.format_name.clone())
            .unwrap_or_default(),
        has_audio: true,
        error: None,
    })
}

fn missing_tool_meta(path: &str, tool: &str) -> FileMeta {
    FileMeta {
        name: file_name_of(path),
        path: path.to_string(),
        size_bytes: 0,
        duration_secs: 0.0,
        format_name: String::new(),
        has_audio: false,
        error: Some(format!("Bundled {tool} binary is missing")),
    }
}

fn file_name_of(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

/// Waveform peaks for the trim editor UI. Decodes only the first audio
/// stream (audio-only decode; no video work) into `buckets` min/max pairs.
/// Runs in a dedicated background task to prevent any UI freezing.
#[tauri::command]
#[specta::specta]
pub async fn waveform_peaks(path: String, buckets: Option<u32>) -> Result<Vec<[f32; 2]>> {
    let path = crate::android_fs::ensure_local_path(&path);
    let buckets = (buckets.unwrap_or(1000) as usize).clamp(16, 4000);
    tauri::async_runtime::spawn_blocking(move || {
        let ffmpeg = crate::ffmpeg::locate::ffmpeg_path()
            .map_err(|_| AppError::Other("Bundled ffmpeg binary is missing".into()))?;
        // A duration hint lets the peak extractor stream: buckets are aligned
        // to the FULL file duration and no large PCM buffer is allocated.
        let duration = probe::probe_file(
            &crate::ffmpeg::locate::locate("ffprobe")
                .map_err(|_| AppError::Other("Bundled ffprobe binary is missing".into()))?,
            &path,
        )
        .ok()
        .and_then(|p| p.duration_secs())
        .filter(|d| *d > 0.0);
        let peaks =
            crate::ffmpeg::waveform::extract_peaks(&ffmpeg, &path, buckets, duration)?;
        // Tauri IPC can't carry tuples directly — flatten to [min, max] arrays.
        Ok(peaks.into_iter().map(|(mn, mx)| [mn, mx]).collect())
    })
    .await
    .map_err(|e| AppError::Other(format!("Async task failed: {e}")))?
}

/// Enqueue a conversion batch; returns job ids. Each input carries its own
/// optional trim window (`startTime`/`endTime` in seconds, both nullable).
#[tauri::command]
#[specta::specta]
pub async fn start_conversion(
    queue: State<'_, QueueManager>,
    items: Vec<TrimSpec>,
    options: ConversionOptions,
    concurrency: Option<u32>,
) -> Result<Vec<String>> {
    if items.is_empty() {
        return Err(AppError::InvalidInput("No input files selected".into()));
    }
    let mut items = items;
    // NOTE: no staging here — Android content URIs are resolved lazily by the
    // worker right before each conversion runs, so picking 20 files never
    // copies 20 files upfront.
    options.validate()?;
    for item in &items {
        item.validate()?;
        let p = &item.path;
        let is_uri = p.starts_with("content://") || p.starts_with("file://");
        if !is_uri && !Path::new(p).exists() {
            return Err(AppError::NotFound(p.clone()));
        }
    }
    // Reject duplicate sources in one batch — two jobs writing
    // `{stem}.{ext}` next to the same source would collide via unique_path.
    // Windows paths are case-insensitive, so fold case there.
    let mut seen = std::collections::HashSet::new();
    for item in &items {
        let key = if cfg!(windows) {
            item.path.to_lowercase()
        } else {
            item.path.clone()
        };
        if !seen.insert(key) {
            return Err(AppError::InvalidInput(format!(
                "Duplicate input file: {}",
                item.path
            )));
        }
    }
    let conc = concurrency.unwrap_or_else(|| Settings::load().concurrency);
    crate::log_info!(
        "queue started: {} file(s), concurrency {conc}, {} trimmed",
        items.len(),
        items
            .iter()
            .filter(|i| i.start_time_secs.is_some() || i.end_time_secs.is_some())
            .count()
    );
    Ok(queue.enqueue(items, options, conc))
}

// In-memory, microsecond-fast — kept sync on purpose (async commands taking
// State must return Result in Tauri 2; not worth the churn here).
#[tauri::command]
#[specta::specta]
pub fn cancel_job(queue: State<'_, QueueManager>, job_id: String) {
    queue.cancel(&job_id);
}

#[tauri::command]
#[specta::specta]
pub fn cancel_all_jobs(queue: State<'_, QueueManager>) {
    queue.cancel_all();
}

#[tauri::command]
#[specta::specta]
pub fn clear_finished(queue: State<'_, QueueManager>) {
    queue.clear_finished();
}

#[tauri::command]
#[specta::specta]
pub fn get_queue(queue: State<'_, QueueManager>) -> Vec<JobRecord> {
    queue.snapshot()
}

#[derive(Serialize, serde::Deserialize, specta::Type)]
pub struct DiskFree {
    #[specta(type = u32)]
    pub free_bytes: u64,
}

/// Pre-flight disk space query for the chosen output location.
#[tauri::command]
#[specta::specta]
pub async fn disk_free(path: String) -> Result<DiskFree> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = Path::new(&path);
        let dir = if target.is_dir() {
            target
        } else {
            target.parent().unwrap_or(target)
        };
        crate::disk::free_bytes(dir)
            .map(|free_bytes| DiskFree { free_bytes })
            .ok_or_else(|| AppError::Io(format!("Cannot determine free space for {path}")))
    })
    .await
    .map_err(|e| AppError::Other(format!("Async task failed: {e}")))?
}

#[tauri::command(async)]
#[specta::specta]
pub fn get_settings() -> Settings {
    Settings::load()
}

#[tauri::command(async)]
#[specta::specta]
pub fn save_settings(settings: Settings) -> Result<()> {
    settings.save().map_err(AppError::Other)?;
    crate::log_info!("settings saved");
    Ok(())
}

#[tauri::command(async)]
#[specta::specta]
pub fn log_frontend(level: String, msg: String) {
    crate::logger::log(&level, &format!("[FRONTEND] {msg}"));
}

