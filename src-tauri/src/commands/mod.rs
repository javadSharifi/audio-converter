use std::path::Path;

use serde::Serialize;
use tauri::State;

use crate::error::{AppError, Result};
use crate::ffmpeg::probe;
use crate::queue::{JobRecord, QueueManager};
use crate::settings::Settings;
use crate::types::{ConversionOptions, FileMeta};

/// Probe files for the UI list. Per-file errors land in `FileMeta.error`
/// instead of failing the whole call.
#[tauri::command]
pub fn probe_files(paths: Vec<String>) -> Vec<FileMeta> {
    let Ok(ffprobe) = crate::ffmpeg::locate::locate("ffprobe") else {
        return paths
            .into_iter()
            .map(|p| missing_tool_meta(&p, "ffprobe"))
            .collect();
    };
    paths
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
        .collect()
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

/// Enqueue a conversion batch; returns job ids.
#[tauri::command]
pub fn start_conversion(
    queue: State<'_, QueueManager>,
    inputs: Vec<String>,
    options: ConversionOptions,
    concurrency: Option<u32>,
) -> Result<Vec<String>> {
    if inputs.is_empty() {
        return Err(AppError::InvalidInput("No input files selected".into()));
    }
    options.validate()?;
    for p in &inputs {
        if !Path::new(p).exists() {
            return Err(AppError::NotFound(p.clone()));
        }
    }
    let conc = concurrency.unwrap_or_else(|| Settings::load().concurrency);
    crate::log_info!("queue started: {} file(s), concurrency {conc}", inputs.len());
    Ok(queue.enqueue(inputs, options, conc))
}

#[tauri::command]
pub fn cancel_job(queue: State<'_, QueueManager>, job_id: String) {
    queue.cancel(&job_id);
}

#[tauri::command]
pub fn cancel_all_jobs(queue: State<'_, QueueManager>) {
    queue.cancel_all();
}

#[tauri::command]
pub fn clear_finished(queue: State<'_, QueueManager>) {
    queue.clear_finished();
}

#[tauri::command]
pub fn get_queue(queue: State<'_, QueueManager>) -> Vec<JobRecord> {
    queue.snapshot()
}

#[derive(Serialize)]
pub struct DiskFree {
    pub free_bytes: u64,
}

/// Pre-flight disk space query for the chosen output location.
#[tauri::command]
pub fn disk_free(path: String) -> Result<DiskFree> {
    let target = Path::new(&path);
    let dir = if target.is_dir() { target } else { target.parent().unwrap_or(target) };
    crate::disk::free_bytes(dir)
        .map(|free_bytes| DiskFree { free_bytes })
        .ok_or_else(|| AppError::Io(format!("Cannot determine free space for {path}")))
}

#[tauri::command]
pub fn get_settings() -> Settings {
    Settings::load()
}

#[tauri::command]
pub fn save_settings(settings: Settings) -> Result<()> {
    settings.save().map_err(AppError::Other)?;
    crate::log_info!("settings saved");
    Ok(())
}
