use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::analyze::analyze_volume;
use super::boost::build_boost_args;
use super::presets::BoosterPreset;
use crate::disk;
use crate::error::{AppError, Result};
use crate::ffmpeg::probe;
use crate::ffmpeg::run::{CancelToken, RunSpec};
use crate::processing::naming;
use crate::processing::pipeline::{Emitter, JobOutcome};
use crate::types::{ConversionOptions, JobEvent, JobStatus, TrimSpec};

const PROGRESS_POLL_INTERVAL: Duration = Duration::from_millis(200);

fn processing_event(
    job_id: &str,
    source: &Path,
    percent: Option<f64>,
    speed: Option<String>,
    warning: Option<String>,
) -> JobEvent {
    JobEvent {
        id: job_id.to_string(),
        source_path: source.to_string_lossy().into_owned(),
        status: JobStatus::Processing,
        percent,
        speed,
        error: None,
        technical: None,
        warning,
        outputs: vec![],
    }
}

/// Run an offline Sound Booster job.
#[allow(clippy::too_many_arguments)]
pub fn run_boost_job(
    job_id: &str,
    source: &Path,
    preset: BoosterPreset,
    manual_gain_percent: Option<f64>,
    options: &ConversionOptions,
    trim: Option<&TrimSpec>,
    multiple_sources: bool,
    ffmpeg: &Path,
    ffprobe: &Path,
    cancel: CancelToken,
    emit: &Emitter,
) -> Result<JobOutcome> {
    if cancel.is_cancelled() {
        return Err(AppError::Cancelled);
    }

    // 1. Probe input
    let probed = probe::probe_file(ffprobe, &source.to_string_lossy())?;
    let total = probed.duration_secs().unwrap_or(0.0);
    if total <= 0.01 {
        return Err(AppError::CorruptedFile(format!(
            "Input has zero/near-zero duration: {}",
            source.display()
        )));
    }

    let start = trim.and_then(|t| t.start_time_secs).unwrap_or(0.0).min(total);
    let end = trim
        .and_then(|t| t.end_time_secs)
        .map(|e| e.min(total))
        .unwrap_or(total);
    let effective_total = (end - start).max(0.01);

    emit(processing_event(job_id, source, Some(1.0), None, None));

    // 2. Volume analysis: only required for Music preset (others use dynamic normalizer or explicit gains)
    let analysis = if preset == BoosterPreset::Music {
        analyze_volume(ffmpeg, source, Some(start), Some(effective_total), &cancel).ok()
    } else {
        None
    };

    // 3. Determine output destination
    let finals = naming::build_output_paths(source, options, 1, multiple_sources);
    let final_path = &finals[0];
    if let Some(dir) = final_path.parent() {
        std::fs::create_dir_all(dir)?;
    }

    // 4. Disk space pre-check
    let est = disk::estimate_output_bytes(options.effective_bitrate(), effective_total)
        + (8 * 1024 * 1024);
    if let Some(free) = disk::free_bytes(final_path.parent().unwrap_or(Path::new("."))) {
        if free < est {
            return Err(AppError::InsufficientDiskSpace {
                needed: est,
                available: free,
            });
        }
    }

    // 5. Temporary atomic file name
    let fname = final_path
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_else(|| "output".into());
    let temp_name = match fname.rsplit_once('.') {
        Some((stem, ext)) if !ext.is_empty() => format!("{stem}.{job_id}.part.{ext}"),
        _ => format!("{fname}.{job_id}.part"),
    };
    let temp_path = final_path.parent().unwrap_or(Path::new(".")).join(temp_name);

    // 6. Build boost args
    let args = build_boost_args(
        source,
        &temp_path,
        preset,
        manual_gain_percent,
        &options.format,
        options.effective_bitrate(),
        options.sample_rate_hz,
        options.channels,
        trim,
        analysis.as_ref(),
    );

    // 7. Execute FFmpeg with progress tracking
    let total_us = (effective_total * 1_000_000.0).max(1.0);
    let shared: Arc<Mutex<(u64, String)>> = Arc::new(Mutex::new((0, String::new())));
    let writer = Arc::clone(&shared);
    let stdout_cb: Box<dyn FnMut(&str) + Send> = Box::new(move |line: &str| {
        let mut g = writer.lock().unwrap();
        if let Some(v) = line.strip_prefix("out_time_us=") {
            g.0 = v.trim().parse().unwrap_or(g.0);
        } else if let Some(v) = line.strip_prefix("speed=") {
            g.1 = v.trim().to_string();
        }
    });

    let stop = Arc::new(AtomicBool::new(false));
    let emitter_thread = {
        let reader = Arc::clone(&shared);
        let stop = Arc::clone(&stop);
        let emit = Arc::clone(emit);
        let job_id = job_id.to_string();
        let src = source.to_path_buf();
        std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                let (us, speed) = {
                    let g = reader.lock().unwrap();
                    (g.0, g.1.clone())
                };
                let frac = (us as f64 / total_us).clamp(0.0, 1.0);
                let percent = 5.0 + frac * 94.0;
                emit(processing_event(
                    &job_id,
                    &src,
                    Some(percent.clamp(0.0, 99.9)),
                    Some(speed),
                    None,
                ));
                std::thread::sleep(PROGRESS_POLL_INTERVAL);
            }
        })
    };

    let spec = RunSpec::new(ffmpeg.to_path_buf(), args)
        .with_stdout_cb(stdout_cb)
        .cancellable(cancel.clone());

    let result = spec.run();
    stop.store(true, Ordering::SeqCst);
    let _ = emitter_thread.join();

    match result {
        Ok(outcome) if outcome.success => {
            if let Err(e) = std::fs::rename(&temp_path, final_path) {
                let _ = std::fs::remove_file(&temp_path);
                return Err(AppError::Io(format!(
                    "Failed to finalize output {}: {e}",
                    final_path.display()
                )));
            }
            let warning = if preset == BoosterPreset::Extreme {
                Some("High gain (Extreme mode) applied — audio may have minor compression artifacts.".into())
            } else {
                None
            };
            Ok(JobOutcome {
                outputs: vec![final_path.clone()],
                warning,
            })
        }
        Ok(outcome) => {
            let _ = std::fs::remove_file(&temp_path);
            let tail = outcome.stderr_tail.join("\n");
            Err(AppError::FFmpeg(format!("Sound booster conversion failed: {tail}")))
        }
        Err(e) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(e)
        }
    }
}
