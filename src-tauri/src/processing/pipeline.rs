use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::disk;
use crate::error::{AppError, Result};
use crate::ffmpeg::probe;
use crate::ffmpeg::run::{CancelToken, RunSpec};
use crate::processing::{naming, silence, split};
use crate::types::{AudioFormat, ConversionOptions, JobEvent, JobStatus, TrimSpec};

/// Thread-safe event sink owned by the queue; cloned into worker threads.
pub type Emitter = Arc<dyn Fn(JobEvent) + Send + Sync>;

const ENCODE_PHASE_START: f64 = 15.0;

/// Result of one completed job.
#[derive(Debug)]
pub struct JobOutcome {
    pub outputs: Vec<PathBuf>,
    pub warning: Option<String>,
}

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

/// Encoder arguments for the chosen format/quality.
pub fn encoder_args(format: &AudioFormat, bitrate_kbps: Option<u32>) -> Vec<String> {
    match format {
        AudioFormat::Mp3 => vec![
            "-c:a".into(),
            "libmp3lame".into(),
            "-b:a".into(),
            format!("{}k", bitrate_kbps.unwrap_or(192)),
        ],
        AudioFormat::Aac | AudioFormat::M4a => vec![
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            format!("{}k", bitrate_kbps.unwrap_or(128)),
        ],
        AudioFormat::Opus => vec![
            "-c:a".into(),
            "libopus".into(),
            "-b:a".into(),
            format!("{}k", bitrate_kbps.unwrap_or(128)),
        ],
        AudioFormat::Flac => vec!["-c:a".into(), "flac".into()],
        // 16-bit PCM keeps maximum player compatibility for WAV.
        AudioFormat::Wav => vec!["-c:a".into(), "pcm_s16le".into()],
    }
}

/// Build the full FFmpeg argument list for producing `outputs` in ONE pass.
///
/// Strategy: decode the source exactly once. Silence removal and splitting
/// happen inside a single `filter_complex`; each part becomes one muxed
/// output. At most one lossy encode regardless of feature combination.
///
/// Trimming: `-ss` goes strictly BEFORE `-i` (input seeking — fast, skips
/// demux instead of decode); `-to` goes AFTER `-i`. When both are set the
/// `-to` value is rebased to the post-seek timeline by `TrimSpec`.
pub fn build_conversion_args(
    source: &Path,
    options: &ConversionOptions,
    parts: &[Vec<silence::Range>],
    outputs: &[PathBuf],
    use_filters: bool,
    trim: Option<&TrimSpec>,
) -> Vec<String> {
    // Input seeking MUST precede `-i`; output options follow it.
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-y".into(),
        "-loglevel".into(),
        "error".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
    ];
    if let Some(start) = trim.and_then(|t| t.start_time_secs) {
        args.extend(["-ss".to_string(), format!("{start:.3}")]);
    }
    args.extend([
        "-i".to_string(),
        source.to_string_lossy().into_owned(),
    ]);
    if let Some(to) = trim.and_then(|t| t.effective_to()) {
        args.extend(["-to".to_string(), format!("{to:.3}")]);
    }

    let bitrate = options.effective_bitrate();
    let mut codec_args = encoder_args(&options.format, bitrate);

    // libopus only accepts a fixed rate set; silently fall back to 48 kHz
    // (its native rate) rather than failing the job.
    let sample_rate = if options.format == AudioFormat::Opus {
        match options.sample_rate_hz {
            Some(sr) if matches!(sr, 8000 | 12000 | 16000 | 24000 | 48000) => Some(sr),
            _ => Some(48000),
        }
    } else {
        options.sample_rate_hz
    };
    if let Some(sr) = sample_rate {
        codec_args.extend(["-ar".to_string(), sr.to_string()]);
    }
    if let Some(ch) = options.channels {
        codec_args.extend(["-ac".to_string(), ch.to_string()]);
    }

    if !use_filters {
        // Straight transcode: extract main audio track, encode once.
        args.extend([
            "-map".to_string(),
            "0:a:0".to_string(),
            "-vn".to_string(),
            "-map_metadata".to_string(),
            "0".to_string(),
        ]);
        args.extend(codec_args);
        args.push(outputs[0].to_string_lossy().into_owned());
        return args;
    }

    // filter_complex: one concat graph per part over trimmed kept segments.
    let mut chains: Vec<String> = Vec::new();
    for (pi, segs) in parts.iter().enumerate() {
        let mut labels = String::new();
        for (si, &(start, end)) in segs.iter().enumerate() {
            let label = format!("s{pi}_{si}");
            chains.push(format!(
                "[0:a]atrim=start={start:.6}:end={end:.6},asetpts=PTS-STARTPTS[{label}];"
            ));
            labels.push_str(&format!("[{label}]"));
        }
        chains.push(format!("{labels}concat=n={}:v=0:a=1[a{pi}];", segs.len()));
    }

    args.push("-filter_complex".into());
    args.push(chains.concat());

    for (pi, out) in outputs.iter().enumerate() {
        args.extend([
            "-map".to_string(),
            format!("[a{pi}]"),
            // Outputs are audio-only filter sinks, so this is inert — kept
            // for defense-in-depth: every command we emit disables video.
            "-vn".to_string(),
            "-map_metadata".to_string(),
            "0".to_string(),
        ]);
        args.extend(codec_args.clone());
        args.push(out.to_string_lossy().into_owned());
    }
    args
}

fn cleanup_temps(temps: &[PathBuf]) {
    for t in temps {
        let _ = std::fs::remove_file(t);
    }
}

fn join_tail(tail: &[String]) -> String {
    let joined = tail.join("\n");
    if joined.trim().is_empty() {
        "FFmpeg exited with an error but produced no diagnostic output.".into()
    } else {
        joined
    }
}

#[allow(clippy::too_many_arguments)]
pub fn run_job(
    job_id: &str,
    source: &Path,
    options: &ConversionOptions,
    trim: Option<&TrimSpec>,
    multiple_sources: bool,
    ffmpeg: &Path,
    ffprobe: &Path,
    cancel: CancelToken,
    emit: &Emitter,
) -> Result<JobOutcome> {
    options.validate()?;
    if let Some(t) = trim {
        t.validate()?;
    }

    // ---- Phase 0: probe --------------------------------------------------
    if cancel.is_cancelled() {
        return Err(AppError::Cancelled);
    }
    let probed = probe::probe_file(ffprobe, &source.to_string_lossy())?;
    let total = probed.duration_secs().unwrap_or(0.0);
    if total <= 0.01 {
        return Err(AppError::CorruptedFile(format!(
            "Input has zero/near-zero duration: {}",
            source.display()
        )));
    }
    // Clamp the trim window to what the file actually contains so progress
    // math and split planning stay on the real (post-trim) duration.
    let start = trim.and_then(|t| t.start_time_secs).unwrap_or(0.0).min(total);
    let end = trim
        .and_then(|t| t.end_time_secs)
        .map(|e| e.min(total))
        .unwrap_or(total);
    let effective_total = (end - start).max(0.01);
    emit(processing_event(job_id, source, Some(1.0), None, None));

    // ---- Phase 1: silence detection --------------------------------------
    // Runs over the TRIMMED span when a window is set, so detected ranges
    // share the same zero-origin timeline as the encode step below.
    let kept: Vec<silence::Range> = if options.remove_silence {
        detect_silence(
            job_id,
            source,
            effective_total,
            options,
            trim,
            ffmpeg,
            &cancel,
            emit,
        )?
    } else {
        vec![(0.0, effective_total)]
    };

    let post_total = silence::total_kept(&kept);

    // All-silent fallback: valid tiny output instead of an error crash.
    let mut warning: Option<String> = None;
    let kept_final = if kept.is_empty() {
        warning = Some("Entire input is silence — wrote a minimal placeholder instead.".into());
        vec![(0.0, effective_total.min(0.5))]
    } else {
        kept
    };

    // ---- Phase 2: split planning against POST-silence timeline ------------
    let parts: Vec<Vec<silence::Range>> = if options.split_enabled && post_total > 0.0 {
        split::split_windows(post_total, options.split_duration_secs)
            .iter()
            .map(|&w| split::map_window_to_ranges(w, &kept_final))
            .filter(|segs| !segs.is_empty())
            .collect()
    } else {
        vec![kept_final]
    };
    let part_count = parts.len();

    // ---- Phase 3: output paths + collision handling ------------------------
    let finals = naming::build_output_paths(source, options, part_count, multiple_sources);
    for dir in finals.iter().filter_map(|p| p.parent()) {
        std::fs::create_dir_all(dir)?;
    }

    // ---- Phase 4: disk space check BEFORE encoding --------------------------
    let est = disk::estimate_output_bytes(options.effective_bitrate(), post_total) + 8_388_608;
    if let Some(free) = disk::free_bytes(finals[0].parent().unwrap_or(Path::new("."))) {
        if free < est {
            return Err(AppError::InsufficientDiskSpace {
                needed: est,
                available: free,
            });
        }
    }

    // ---- Phase 5: single-pass convert ---------------------------------------
    // Temp names keep the real extension last (`name.part.mp3`) so FFmpeg's
    // muxer auto-detection still works; renamed to final on success.
    let temps: Vec<PathBuf> = finals
        .iter()
        .map(|p| {
            let parent = p.parent().unwrap_or_else(|| Path::new("."));
            let fname = p
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_else(|| "output".into());
            let temp_name = match fname.rsplit_once('.') {
                Some((stem, ext)) if !ext.is_empty() => format!("{stem}.{job_id}.part.{ext}"),
                _ => format!("{fname}.{job_id}.part"),
            };
            parent.join(temp_name)
        })
        .collect();

    let use_filters = options.remove_silence || part_count > 1;

    // Progress plumbing: stdout parser -> shared state -> emitter thread.
    // One ffmpeg invocation PER PART: `-progress` out_time is unreliable when
    // several muxed outputs share one filter_complex (it tracks the shortest
    // sink), which froze UI progress in split mode. Sequential per-part runs
    // give exact per-part fractions; overall percent spans the encode phase.
    let encode_span = 100.0 - ENCODE_PHASE_START;
    let mut last_result: Result<()> = Ok(());
    for (pi, segs) in parts.iter().enumerate() {
        if cancel.is_cancelled() {
            last_result = Err(AppError::Cancelled);
            break;
        }

        let phase_lo = ENCODE_PHASE_START + encode_span * (pi as f64) / (part_count as f64);
        let phase_hi = ENCODE_PHASE_START + encode_span * ((pi + 1) as f64) / (part_count as f64);
        let part_secs: f64 = segs.iter().map(|&(s, e)| e - s).sum();
        let part_us = (part_secs * 1_000_000.0).max(1.0);

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
            let warn = warning.clone();
            std::thread::spawn(move || {
                while !stop.load(Ordering::SeqCst) {
                    let (us, speed) = {
                        let g = reader.lock().unwrap();
                        (g.0, g.1.clone())
                    };
                    let frac = (us as f64 / part_us).clamp(0.0, 1.0);
                    let percent = phase_lo + frac * (phase_hi - phase_lo);
                    emit(processing_event(
                        &job_id,
                        &src,
                        Some(percent.clamp(0.0, 99.9)),
                        Some(speed),
                        warn.clone(),
                    ));
                    std::thread::sleep(Duration::from_millis(250));
                }
            })
        };

        let args = build_conversion_args(
            source,
            options,
            std::slice::from_ref(segs),
            &temps[pi..=pi],
            use_filters,
            trim,
        );
        if std::env::var("AUDIO_CONVERTER_DEBUG_ARGS").is_ok() {
            eprintln!("ARGS[{pi}]={args:?}");
        }
        let spec = RunSpec::new(ffmpeg.to_path_buf(), args)
            .with_stdout_cb(stdout_cb)
            .cancellable(cancel.clone());

        let result = spec.run();
        stop.store(true, Ordering::SeqCst);
        let _ = emitter_thread.join();

        match result {
            Ok(outcome) if outcome.success => continue,
            Err(e @ (AppError::Cancelled | AppError::FFmpeg(_) | AppError::Io(_))) => {
                last_result = Err(e)
            }
            Err(e) => last_result = Err(e),
            Ok(outcome) => last_result = Err(AppError::FFmpeg(join_tail(&outcome.stderr_tail))),
        }
        break;
    }

    if last_result.is_err() {
        cleanup_temps(&temps);
        return Err(last_result.err().unwrap());
    }

    for (t, f) in temps.iter().zip(finals.iter()) {
        if let Err(e) = std::fs::rename(t, f) {
            cleanup_temps(&temps);
            return Err(AppError::Io(format!(
                "Failed to finalize {}: {e}",
                f.display()
            )));
        }
    }
    crate::log_info!("job {job_id} completed: {} file(s)", finals.len());
    Ok(JobOutcome {
        outputs: finals,
        warning,
    })
}

/// Scan the source with `silencedetect`, emitting scan progress on the way.
/// When `trim` is set, the scan covers only that span (same `-ss` before
/// `-i`, `-to` after), so detected ranges are relative to the seek point —
/// identical to what the encode pass sees.
#[allow(clippy::too_many_arguments)]
fn detect_silence(
    job_id: &str,
    source: &Path,
    total: f64,
    options: &ConversionOptions,
    trim: Option<&TrimSpec>,
    ffmpeg: &Path,
    cancel: &CancelToken,
    emit: &Emitter,
) -> Result<Vec<silence::Range>> {
    let mut scan_args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-y".into(),
        "-loglevel".into(),
        "info".into(), // silencedetect prints at info level
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
    ];
    if let Some(start) = trim.and_then(|t| t.start_time_secs) {
        scan_args.extend(["-ss".to_string(), format!("{start:.3}")]);
    }
    scan_args.extend(["-i".to_string(), source.to_string_lossy().into_owned()]);
    if let Some(to) = trim.and_then(|t| t.effective_to()) {
        scan_args.extend(["-to".to_string(), format!("{to:.3}")]);
    }
    scan_args.extend([
        "-vn".to_string(),
        "-af".to_string(),
        format!(
            "silencedetect=noise={}dB:d={}",
            options.silence_threshold_db, options.silence_min_duration_secs
        ),
        "-f".to_string(),
        "null".to_string(),
        "-".to_string(),
    ]);

    let stderr_buf: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let stderr_writer = Arc::clone(&stderr_buf);
    let stderr_cb: Box<dyn FnMut(&str) + Send> = Box::new(move |line: &str| {
        stderr_writer.lock().unwrap().push_str(line);
        stderr_writer.lock().unwrap().push('\n');
    });

    let total_us_scan = (total * 1_000_000.0).max(1.0);
    let shared: Arc<Mutex<u64>> = Arc::new(Mutex::new(0));
    let writer = Arc::clone(&shared);
    let stdout_cb: Box<dyn FnMut(&str) + Send> = Box::new(move |line: &str| {
        if let Some(v) = line.strip_prefix("out_time_us=") {
            *writer.lock().unwrap() = v.trim().parse().unwrap_or(0);
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
                let frac = *reader.lock().unwrap() as f64 / total_us_scan;
                let percent = 2.0 + frac.clamp(0.0, 1.0) * (ENCODE_PHASE_START - 2.0);
                emit(processing_event(&job_id, &src, Some(percent), None, None));
                std::thread::sleep(Duration::from_millis(250));
            }
        })
    };

    let spec = RunSpec::new(ffmpeg.to_path_buf(), scan_args)
        .with_stdout_cb(stdout_cb)
        .with_stderr_cb(stderr_cb)
        .cancellable(cancel.clone());

    let result = spec.run();
    stop.store(true, Ordering::SeqCst);
    let _ = emitter_thread.join();

    match result {
        Err(AppError::Cancelled) => Err(AppError::Cancelled),
        Err(e) => Err(AppError::FFmpeg(format!("Silence analysis failed: {e}"))),
        Ok(outcome) if !outcome.success && outcome.code != Some(0) => {
            Err(AppError::FFmpeg(format!(
                "Silence analysis failed: {}",
                join_tail(&outcome.stderr_tail)
            )))
        }
        Ok(_) => {
            let buf = stderr_buf.lock().unwrap().clone();
            let detected = silence::parse_silencedetect(&buf);
            // Convert detected silence spans into KEPT audio ranges.
            let merge_gap = 0.05f64.max(options.silence_min_duration_secs * 0.02);
            Ok(silence::kept_ranges(total, detected, merge_gap))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{OutputMode, QualityPreset};

    #[test]
    fn straight_transcode_args() {
        let opts = ConversionOptions::default();
        let args = build_conversion_args(
            Path::new("/tmp/in put.mp4"),
            &opts,
            &[],
            &[PathBuf::from("/tmp/out.mp3")],
            false,
            None,
        );
        let s = args.join(" ");
        assert!(s.contains("-map 0:a:0"));
        assert!(s.contains("-b:a 192k"));
        assert!(s.contains("-ar 44100"));
        assert!(!s.contains("filter_complex"));
        assert!(s.contains("-map_metadata 0"));
        // No trim → no seek/stop flags at all.
        assert!(!args.iter().any(|a| a == "-ss" || a == "-to"));
        // Video must always be dropped.
        assert!(args.iter().any(|a| a == "-vn"));
    }

    #[test]
    fn filter_graph_one_part_multi_segment() {
        let opts = ConversionOptions {
            remove_silence: true,
            ..Default::default()
        };
        let parts = vec![vec![(0.0, 10.0), (12.0, 30.0)]];
        let args = build_conversion_args(
            Path::new("/in.mp4"),
            &opts,
            &parts,
            &[PathBuf::from("/out.mp3")],
            true,
            None,
        );
        let s = args.join(" ");
        assert!(s.contains("atrim=start=0.000000:end=10.000000"));
        assert!(s.contains("concat=n=2:v=0:a=1[a0]"));
    }

    #[test]
    fn two_parts_two_outputs_single_graph() {
        let opts = ConversionOptions {
            format: AudioFormat::Opus,
            quality: QualityPreset::Custom,
            custom_bitrate_kbps: Some(96),
            split_enabled: true,
            ..Default::default()
        };
        let parts = vec![vec![(0.0, 600.0)], vec![(600.0, 900.0)]];
        let args = build_conversion_args(
            Path::new("/in.mkv"),
            &opts,
            &parts,
            &[PathBuf::from("/o1.opus"), PathBuf::from("/o2.opus")],
            true,
            None,
        );
        let s = args.join(" ");
        assert!(s.contains("libopus"));
        assert!(s.contains("-b:a 96k"));
        assert_eq!(s.matches("-map [a").count(), 2);
        // -vn on both outputs: video can never leak into any output.
        assert_eq!(s.matches(" -vn").count(), 2);
    }

    /// Spec: `-ss` strictly BEFORE `-i`, `-to` strictly AFTER `-i`,
    /// and the stop value rebased to the post-seek timeline.
    #[test]
    fn trim_flag_ordering_and_rebased_to() {
        let opts = ConversionOptions::default();
        let trim = TrimSpec {
            path: "/in.mp4".into(),
            start_time_secs: Some(10.0),
            end_time_secs: Some(30.0),
        };
        let args = build_conversion_args(
            Path::new("/in.mp4"),
            &opts,
            &[],
            &[PathBuf::from("/out.mp3")],
            false,
            Some(&trim),
        );
        let idx_i = args.iter().position(|a| a == "-i").unwrap();
        let idx_ss = args.iter().position(|a| a == "-ss").unwrap();
        let idx_to = args.iter().position(|a| a == "-to").unwrap();
        assert!(
            idx_ss < idx_i && idx_i < idx_to,
            "want -ss before -i before -to, got {args:?}"
        );
        // -to must be end − start (post-seek origin), i.e. a 20s window.
        let to_val: f64 = args[args.iter().position(|a| a == "-to").unwrap() + 1]
            .parse()
            .unwrap();
        assert!((to_val - 20.0).abs() < 1e-9, "rebased -to should be 20, got {to_val}");
        assert!(args.iter().any(|a| a == "-vn"), "-vn required");
    }

    /// End-only trim: `-ss` absent, absolute `-to` after `-i`.
    #[test]
    fn end_only_trim_uses_absolute_to() {
        let opts = ConversionOptions::default();
        let trim = TrimSpec {
            path: "/in.mp4".into(),
            start_time_secs: None,
            end_time_secs: Some(12.5),
        };
        let args = build_conversion_args(
            Path::new("/in.mp4"),
            &opts,
            &[],
            &[PathBuf::from("/out.wav")],
            false,
            Some(&trim),
        );
        let idx_i = args.iter().position(|a| a == "-i").unwrap();
        assert!(args.iter().take(idx_i).all(|a| a != "-ss"));
        let idx_to = args.iter().position(|a| a == "-to").unwrap();
        assert!(idx_to > idx_i);
        // No start bound → absolute stop position, unrebased.
        assert_eq!(args[idx_to + 1], "12.500");
    }

    /// Start-only trim: `-to` absent entirely.
    #[test]
    fn start_only_trim_has_no_to_flag() {
        let opts = ConversionOptions {
            format: AudioFormat::Flac,
            ..Default::default()
        };
        let trim = TrimSpec {
            path: "/in.mp4".into(),
            start_time_secs: Some(45.0),
            end_time_secs: None,
        };
        let args = build_conversion_args(
            Path::new("/in.mp4"),
            &opts,
            &[],
            &[PathBuf::from("/out.flac")],
            false,
            Some(&trim),
        );
        let idx_i = args.iter().position(|a| a == "-i").unwrap();
        assert_eq!(args[idx_i - 1], "45.000");
        assert!(!args.iter().any(|a| a == "-to"));
        assert!(args.iter().any(|a| a == "-c:a" ) && args.iter().any(|a| a == "flac"));
    }

    #[test]
    fn trim_spec_validation() {
        let ok = TrimSpec {
            path: "x".into(),
            start_time_secs: Some(10.0),
            end_time_secs: Some(20.0),
        };
        assert!(ok.validate().is_ok());
        let inverted = TrimSpec {
            path: "x".into(),
            start_time_secs: Some(25.0),
            end_time_secs: Some(20.0),
        };
        assert!(inverted.validate().is_err());
        let negative_start = TrimSpec {
            path: "x".into(),
            start_time_secs: Some(-1.0),
            end_time_secs: None,
        };
        assert!(negative_start.validate().is_err());
        let zero_end = TrimSpec {
            path: "x".into(),
            start_time_secs: None,
            end_time_secs: Some(0.0),
        };
        assert!(zero_end.validate().is_err());
    }

    #[test]
    fn encoder_map_matches_spec() {
        // Contract from the product spec; guards against accidental drift.
        let want = [
            (AudioFormat::Mp3, "libmp3lame"),
            (AudioFormat::Aac, "aac"),
            (AudioFormat::Flac, "flac"),
            (AudioFormat::Wav, "pcm_s16le"),
            (AudioFormat::Opus, "libopus"),
        ];
        for (fmt, codec) in want {
            let args = encoder_args(&fmt, None);
            assert_eq!(args[0], "-c:a");
            assert_eq!(args[1], codec, "codec mismatch for {fmt:?}");
            assert!(!args.iter().any(|a| a.starts_with("libx264")), "no video encoders allowed");
        }
    }

    #[test]
    fn wav_has_no_bitrate() {
        assert_eq!(
            encoder_args(&AudioFormat::Wav, None),
            vec!["-c:a", "pcm_s16le"]
        );
    }

    #[test]
    fn unicode_paths_flow_through_args() {
        let opts = ConversionOptions {
            output_mode: OutputMode::PerSourceFolder,
            ..Default::default()
        };
        let src = Path::new("/media/فیلم‌ها/جلسه اول.mp4");
        let paths = naming::build_output_paths(src, &opts, 2, false);
        assert!(paths[0].to_string_lossy().contains("جلسه اول_part_01.mp3"));
    }

    #[test]
    fn trim_effective_to_rebasing_matrix() {
        let both = TrimSpec {
            path: "x".into(),
            start_time_secs: Some(10.0),
            end_time_secs: Some(30.0),
        };
        assert!((both.effective_to().unwrap() - 20.0).abs() < 1e-9);
        let end_only = TrimSpec {
            path: "x".into(),
            start_time_secs: None,
            end_time_secs: Some(30.0),
        };
        assert!((end_only.effective_to().unwrap() - 30.0).abs() < 1e-9);
        // Start-only / nothing → no -to flag at all.
        let start_only = TrimSpec {
            path: "x".into(),
            start_time_secs: Some(5.0),
            end_time_secs: None,
        };
        assert!(start_only.effective_to().is_none());
        let none = TrimSpec {
            path: "x".into(),
            start_time_secs: None,
            end_time_secs: None,
        };
        assert!(none.effective_to().is_none());
    }
}
