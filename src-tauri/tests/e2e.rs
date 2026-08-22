//! End-to-end tests: real generated videos → bundled FFmpeg binaries →
//! verified playable outputs. Skips gracefully when binaries aren't fetched.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use audio_converter::ffmpeg::probe;
use audio_converter::ffmpeg::run::{CancelToken, RunSpec};
use audio_converter::processing::pipeline;
use audio_converter::types::{AudioFormat, ConversionOptions, OutputMode};

fn bin(name: &str) -> Option<PathBuf> {
    let p = std::env::current_dir()
        .ok()?
        .parent()?
        .join("src-tauri/binaries")
        .join(name);
    // cargo test cwd = src-tauri
    let direct = std::env::current_dir().ok()?.join("binaries").join(name);
    [direct, p].into_iter().find(|c| c.exists())
}

fn ffmpeg() -> PathBuf {
    bin("ffmpeg").expect("bundled ffmpeg missing — run scripts/fetch-ffmpeg.mjs first")
}

fn ffprobe() -> PathBuf {
    bin("ffprobe").expect("bundled ffprobe missing — run scripts/fetch-ffmpeg.mjs first")
}

fn temp_case(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("ac-e2e-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Generate a 6-second video: tone(0–2s) → silence(2–3.5s) → tone(3.5–6s).
/// Video codec is native mpeg4 (LGPL build has no x264).
fn gen_video(dir: &Path, name: &str) -> PathBuf {
    let out = dir.join(name);
    let status = Command::new(ffmpeg())
        .args([
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=duration=6:size=160x120:rate=10",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
            "-f", "lavfi", "-i", "sine=frequency=550:duration=2.5",
            "-filter_complex",
            "[1:a]aformat=sample_rates=44100:channel_layouts=mono[t0];\
             [2:a]atrim=duration=1.5,aformat=sample_rates=44100:channel_layouts=mono[t1];\
             [3:a]aformat=sample_rates=44100:channel_layouts=mono[t2];\
             [t0][t1][t2]concat=n=3:v=0:a=1[aout]",
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "mpeg4", "-q:v", "6",
            "-c:a", "aac", "-b:a", "96k",
        ])
        .arg(&out)
        .status()
        .expect("failed to spawn fixture generator");
    assert!(status.success(), "fixture generation failed");
    out
}

/// Generate a video with NO audio track.
fn gen_video_silent(dir: &Path, name: &str) -> PathBuf {
    let out = dir.join(name);
    let status = Command::new(ffmpeg())
        .args([
            "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=duration=3:size=160x120:rate=10",
            "-c:v", "mpeg4", "-q:v", "6",
        ])
        .arg(&out)
        .status()
        .unwrap();
    assert!(status.success());
    out
}

fn probe_duration(path: &Path) -> f64 {
    let probed = probe::probe_file(&ffprobe(), &path.to_string_lossy()).expect("probe output");
    probed.duration_secs().expect("duration")
}

const TOLERANCE: f64 = 0.35;

#[test]
fn e2e_straight_mp3_conversion() {
    if !bin("ffmpeg").is_some() || !bin("ffprobe").is_some() { return; }
    let dir = temp_case("straight");
    let input = gen_video(&dir, "in.mp4");

    let options = ConversionOptions {
        format: AudioFormat::Mp3,
        ..Default::default()
    };
    let emitter: audio_converter::processing::pipeline::Emitter = Arc::new(|_| {});
    let outcome = pipeline::run_job(
        "job-e2e-1",
        &input,
        &options,
        false,
        &ffmpeg(),
        &ffprobe(),
        CancelToken::new(),
        &emitter,
    )
    .expect("pipeline failed");

    assert_eq!(outcome.outputs.len(), 1);
    let out = &outcome.outputs[0];
    assert!(out.extension().unwrap() == "mp3");
    let dur = probe_duration(out);
    assert!(
        (dur - 6.0).abs() < TOLERANCE,
        "expected ~6s, got {dur}"
    );
}

#[test]
fn e2e_split_with_remainder() {
    if !bin("ffmpeg").is_some() || !bin("ffprobe").is_some() { return; }
    let dir = temp_case("split");
    let input = gen_video(&dir, "in.mkv");

    let options = ConversionOptions {
        format: AudioFormat::Flac,
        split_enabled: true,
        split_duration_secs: 4.0, // 6s source → parts of 4s + 2s
        ..Default::default()
    };
    let emitter: audio_converter::processing::pipeline::Emitter = Arc::new(|_| {});
    let outcome = pipeline::run_job(
        "job-e2e-2", &input, &options, false,
        &ffmpeg(), &ffprobe(), CancelToken::new(), &emitter,
    )
    .expect("pipeline failed");

    assert_eq!(outcome.outputs.len(), 2, "want part01 + remainder part02");
    assert!(outcome.outputs[0].to_string_lossy().contains("_part_01.flac"));
    let d1 = probe_duration(&outcome.outputs[0]);
    let d2 = probe_duration(&outcome.outputs[1]);
    assert!((d1 - 4.0).abs() < TOLERANCE, "part1 {d1}");
    assert!((d2 - 2.0).abs() < TOLERANCE, "part2 {d2}");
}

#[test]
fn e2e_silence_removal_shortens_output() {
    if !bin("ffmpeg").is_some() || !bin("ffprobe").is_some() { return; }
    let dir = temp_case("silence");
    let input = gen_video(&dir, "in.mp4"); // 1.5s silence in the middle

    let options = ConversionOptions {
        format: AudioFormat::Wav,
        remove_silence: true,
        silence_threshold_db: -30,
        silence_min_duration_secs: 1.0,
        ..Default::default()
    };
    let emitter: audio_converter::processing::pipeline::Emitter = Arc::new(|_| {});
    let outcome = pipeline::run_job(
        "job-e2e-3", &input, &options, false,
        &ffmpeg(), &ffprobe(), CancelToken::new(), &emitter,
    )
    .expect("pipeline failed");

    assert_eq!(outcome.outputs.len(), 1);
    let dur = probe_duration(&outcome.outputs[0]);
    assert!(
        (dur - 4.5).abs() < TOLERANCE,
        "expected ~4.5s after removing 1.5s silence, got {dur}"
    );
}

#[test]
fn e2e_split_calculated_against_post_silence_timeline() {
    if !bin("ffmpeg").is_some() || !bin("ffprobe").is_some() { return; }
    let dir = temp_case("silence-split");
    let input = gen_video(&dir, "in.mp4");

    // Post-silence total = 4.5s; split at 3s → parts ≈ 3s + 1.5s.
    // Splitting against the ORIGINAL 6s timeline would give 6/3 = 2×3s — wrong.
    let options = ConversionOptions {
        format: AudioFormat::Opus,
        remove_silence: true,
        silence_threshold_db: -30,
        silence_min_duration_secs: 1.0,
        split_enabled: true,
        split_duration_secs: 3.0,
        output_mode: OutputMode::SameAsSource,
        ..Default::default()
    };
    let emitter: audio_converter::processing::pipeline::Emitter = Arc::new(|_| {});
    let outcome = pipeline::run_job(
        "job-e2e-4", &input, &options, false,
        &ffmpeg(), &ffprobe(), CancelToken::new(), &emitter,
    )
    .expect("pipeline failed");

    assert_eq!(outcome.outputs.len(), 2);
    let d1 = probe_duration(&outcome.outputs[0]);
    let d2 = probe_duration(&outcome.outputs[1]);
    assert!((d1 - 3.0).abs() < TOLERANCE, "post-silence part1 {d1}");
    assert!((d2 - 1.5).abs() < TOLERANCE, "post-silence remainder {d2}");
}

#[test]
fn e2e_unicode_persian_filename() {
    if !bin("ffmpeg").is_some() || !bin("ffprobe").is_some() { return; }
    let dir = temp_case("unicode");
    let generated = gen_video(&dir, "raw.mp4");
    let input = dir.join("جلسه اول.mp4");
    std::fs::copy(&generated, &input).unwrap();

    let options = ConversionOptions {
        format: AudioFormat::Mp3,
        ..Default::default()
    };
    let emitter: audio_converter::processing::pipeline::Emitter = Arc::new(|_| {});
    let outcome = pipeline::run_job(
        "job-e2e-5", &input, &options, false,
        &ffmpeg(), &ffprobe(), CancelToken::new(), &emitter,
    )
    .expect("pipeline failed");

    let name = outcome.outputs[0].file_name().unwrap().to_string_lossy();
    assert!(name.contains("جلسه اول"), "got: {name}");
    assert!(outcome.outputs[0].exists());
}

#[test]
fn e2e_no_audio_track_fails_gracefully() {
    if !bin("ffmpeg").is_some() || !bin("ffprobe").is_some() { return; }
    let dir = temp_case("noaudio");
    let input = gen_video_silent(&dir, "muted.mp4");

    let options = ConversionOptions::default();
    let emitter: audio_converter::processing::pipeline::Emitter = Arc::new(|_| {});
    let err = pipeline::run_job(
        "job-e2e-6", &input, &options, false,
        &ffmpeg(), &ffprobe(), CancelToken::new(), &emitter,
    )
    .expect_err("must fail on video-only file");

    assert!(matches!(err, audio_converter::error::AppError::NoAudioTrack(_)));
    // And no partial output left behind.
    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".part"))
        .collect();
    assert!(leftovers.is_empty(), "temp files leaked: {leftovers:?}");
}

#[test]
fn e2e_cancel_kills_running_ffmpeg() {
    if !bin("ffmpeg").is_some() { return; }
    let token = CancelToken::new();
    // Infinite silent source with a huge cap — runs long enough to cancel.
    let spec = RunSpec::new(
        ffmpeg(),
        vec![
            "-hide_banner".into(),
            "-loglevel".into(), "error".into(),
            "-f".into(), "lavfi".into(),
            "-i".into(), "anullsrc=r=44100:cl=mono".into(),
            "-t".into(), "100000".into(),
            "-f".into(), "null".into(),
            "-".into(),
        ],
    )
    .cancellable(token.clone());

    let killer = {
        let token = token.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            token.cancel();
        })
    };

    match spec.run() {
        Err(audio_converter::error::AppError::Cancelled) => {}
        Ok(_) => panic!("long run finished before cancel fired — timing flake"),
        Err(e) => panic!("unexpected error: {e}"),
    }
    killer.join().unwrap();
}
