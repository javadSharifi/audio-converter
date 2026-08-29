use std::path::Path;

use serde::Serialize;
use tauri::State;

use crate::error::{AppError, Result};
use crate::ffmpeg::probe;
use crate::queue::{JobRecord, QueueManager};
use crate::settings::Settings;
use crate::types::{ConversionOptions, FileMeta, TrimSpec};

/// Probe files for the UI list. Per-file errors land in `FileMeta.error`
/// instead of failing the whole call.
/// Probe files for the UI list in parallel across threads. Per-file errors land in `FileMeta.error`
/// instead of failing the whole call. Runs asynchronously without blocking Tauri's main loop.
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

        // Parallel probe with thread::scope for instant batch metadata resolution
        std::thread::scope(|s| {
            let mut handles = Vec::with_capacity(paths.len());
            for path in paths {
                let ffprobe_ref = &ffprobe;
                handles.push(s.spawn(move || {
                    match probe_file_meta(ffprobe_ref, &path) {
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
                    }
                }));
            }
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        })
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
        let peaks = crate::ffmpeg::waveform::extract_peaks(&ffmpeg, &path, buckets)?;
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
    for item in &mut items {
        item.path = crate::android_fs::ensure_local_path(&item.path);
    }
    options.validate()?;
    for item in &items {
        item.validate()?;
        let p = &item.path;
        if !Path::new(p).exists() {
            return Err(AppError::NotFound(p.clone()));
        }
    }
    // Reject duplicate sources in one batch — two jobs writing
    // `{stem}.{ext}` next to the same source would collide via unique_path.
    let mut seen = std::collections::HashSet::new();
    for item in &items {
        if !seen.insert(item.path.clone()) {
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

#[tauri::command]
#[specta::specta]
pub fn get_settings() -> Settings {
    Settings::load()
}

#[tauri::command]
#[specta::specta]
pub fn save_settings(settings: Settings) -> Result<()> {
    settings.save().map_err(AppError::Other)?;
    crate::log_info!("settings saved");
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn log_frontend(level: String, msg: String) {
    crate::logger::log(&level, &format!("[FRONTEND] {msg}"));
}

