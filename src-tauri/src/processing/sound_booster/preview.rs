use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::analyze::{analyze_volume, VolumeAnalysis};
use super::presets::{build_preset_filter_chain, BoosterPreset};
use crate::error::{AppError, Result};
use crate::ffmpeg::probe;
use crate::ffmpeg::run::{CancelToken, RunSpec};
use crate::ffmpeg::waveform;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AbPreviewResult {
    pub original_path: String,
    pub boosted_path: String,
    pub snippet_start_secs: f64,
    pub snippet_duration_secs: f64,
    pub original_peaks: Vec<[f32; 2]>,
    pub boosted_peaks: Vec<[f32; 2]>,
    pub analysis: VolumeAnalysis,
}

static PREVIEW_SEQ: AtomicU64 = AtomicU64::new(0);

fn sweep_old_previews(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        let now = SystemTime::now();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if ext == "wav" || ext == "mp3" {
                    if let Ok(meta) = entry.metadata() {
                        if let Ok(modified) = meta.modified() {
                            if let Ok(elapsed) = now.duration_since(modified) {
                                if elapsed.as_secs() > 300 {
                                    let _ = std::fs::remove_file(path);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

fn preview_cache_dir() -> PathBuf {
    #[cfg(target_os = "android")]
    let p = {
        if let Ok(c) = std::env::var("TAURI_ANDROID_CACHE_DIR") {
            PathBuf::from(c).join("booster_previews")
        } else {
            std::env::temp_dir().join("audio-converter-previews")
        }
    };
    #[cfg(not(target_os = "android"))]
    let p = std::env::temp_dir().join("audio-converter-previews");

    let _ = std::fs::create_dir_all(&p);
    sweep_old_previews(&p);
    p
}

/// Generate a fast 10-15s audition sample for A/B comparison (Original vs Boosted).
pub fn generate_ab_preview(
    ffmpeg: &Path,
    ffprobe: &Path,
    source: &Path,
    preset: BoosterPreset,
    manual_gain_percent: Option<f64>,
    start_time_secs: Option<f64>,
    requested_duration: Option<f64>,
    cancel: &CancelToken,
) -> Result<AbPreviewResult> {
    if !source.exists() {
        return Err(AppError::NotFound(source.to_string_lossy().into_owned()));
    }

    let probed = probe::probe_file(ffprobe, &source.to_string_lossy())?;
    let total_duration = probed.duration_secs().unwrap_or(0.0);

    let snippet_len = requested_duration.unwrap_or(15.0).clamp(3.0, 30.0);
    let start_pos = match start_time_secs {
        Some(s) if s >= 0.0 && s < total_duration => {
            s.min((total_duration - snippet_len).max(0.0))
        }
        _ => 0.0,
    };
    let effective_duration = if total_duration > 0.0 {
        (total_duration - start_pos).min(snippet_len).max(1.0)
    } else {
        snippet_len
    };

    // Fast volume analysis on the snippet
    let analysis = analyze_volume(
        ffmpeg,
        source,
        Some(start_pos),
        Some(effective_duration),
        cancel,
    )
    .unwrap_or(VolumeAnalysis {
        max_volume_db: -6.0,
        mean_volume_db: -20.0,
        suggested_gain_db: 5.5,
    });

    let seq = PREVIEW_SEQ.fetch_add(1, Ordering::SeqCst);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let dir = preview_cache_dir();
    let orig_file = dir.join(format!("orig_{ts}_{seq}.mp3"));
    let boost_file = dir.join(format!("boost_{ts}_{seq}.mp3"));

    // 1. Generate Original snippet (fast 192k MP3 for lightweight cross-platform streaming)
    let orig_args = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-y".into(),
        "-loglevel".into(),
        "error".into(),
        "-ss".into(),
        format!("{start_pos:.3}"),
        "-i".into(),
        source.to_string_lossy().into_owned(),
        "-t".into(),
        format!("{effective_duration:.3}"),
        "-avoid_negative_ts".into(),
        "make_zero".into(),
        "-vn".into(),
        "-c:a".into(),
        "libmp3lame".into(),
        "-b:a".into(),
        "192k".into(),
        "-ar".into(),
        "44100".into(),
        "-ac".into(),
        "2".into(),
        orig_file.to_string_lossy().into_owned(),
    ];

    let spec_orig = RunSpec::new(ffmpeg.to_path_buf(), orig_args).cancellable(cancel.clone());
    let outcome_orig = spec_orig.run()?;
    if !outcome_orig.success {
        return Err(AppError::FFmpeg(format!(
            "Failed to extract original preview: {}",
            outcome_orig.stderr_tail.join("\n")
        )));
    }

    // 2. Generate Boosted snippet
    let filter_chain = build_preset_filter_chain(preset, manual_gain_percent, Some(&analysis));
    let boost_args = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-y".into(),
        "-loglevel".into(),
        "error".into(),
        "-ss".into(),
        format!("{start_pos:.3}"),
        "-i".into(),
        source.to_string_lossy().into_owned(),
        "-t".into(),
        format!("{effective_duration:.3}"),
        "-af".into(),
        filter_chain,
        "-avoid_negative_ts".into(),
        "make_zero".into(),
        "-vn".into(),
        "-c:a".into(),
        "libmp3lame".into(),
        "-b:a".into(),
        "192k".into(),
        "-ar".into(),
        "44100".into(),
        "-ac".into(),
        "2".into(),
        boost_file.to_string_lossy().into_owned(),
    ];

    let spec_boost = RunSpec::new(ffmpeg.to_path_buf(), boost_args).cancellable(cancel.clone());
    let outcome_boost = spec_boost.run()?;
    if !outcome_boost.success {
        return Err(AppError::FFmpeg(format!(
            "Failed to extract boosted preview: {}",
            outcome_boost.stderr_tail.join("\n")
        )));
    }

    // 3. Extract waveform peaks for both snippets
    let buckets = 300;
    let orig_peaks_tuples = waveform::extract_peaks(
        ffmpeg,
        &orig_file.to_string_lossy(),
        buckets,
        Some(effective_duration),
    )
    .unwrap_or_else(|_| vec![(0.0, 0.0); buckets]);

    let boost_peaks_tuples = waveform::extract_peaks(
        ffmpeg,
        &boost_file.to_string_lossy(),
        buckets,
        Some(effective_duration),
    )
    .unwrap_or_else(|_| vec![(0.0, 0.0); buckets]);

    let original_peaks = orig_peaks_tuples.into_iter().map(|(mn, mx)| [mn, mx]).collect();
    let boosted_peaks = boost_peaks_tuples.into_iter().map(|(mn, mx)| [mn, mx]).collect();

    Ok(AbPreviewResult {
        original_path: orig_file.to_string_lossy().into_owned(),
        boosted_path: boost_file.to_string_lossy().into_owned(),
        snippet_start_secs: start_pos,
        snippet_duration_secs: effective_duration,
        original_peaks,
        boosted_peaks,
        analysis,
    })
}
