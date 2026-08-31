use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::error::{AppError, Result};
use crate::ffmpeg::run::{CancelToken, RunSpec};

/// Results of audio volume analysis via `volumedetect`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VolumeAnalysis {
    /// Peak volume in dB (e.g. -6.5 dB). 0 dB represents full scale digital max.
    pub max_volume_db: f64,
    /// Mean volume in dB (e.g. -22.3 dB).
    pub mean_volume_db: f64,
    /// Calculated safe boost gain in dB to reach close to peak without compression.
    pub suggested_gain_db: f64,
}

/// Parse volumedetect output from FFmpeg stderr stream.
pub fn parse_volumedetect(stderr: &str) -> Option<VolumeAnalysis> {
    let mut max_vol: Option<f64> = None;
    let mut mean_vol: Option<f64> = None;

    for line in stderr.lines() {
        if let Some(pos) = line.find("max_volume:") {
            let rest = &line[pos + "max_volume:".len()..];
            if let Some(db_pos) = rest.find("dB") {
                if let Ok(v) = rest[..db_pos].trim().parse::<f64>() {
                    max_vol = Some(v);
                }
            }
        }
        if let Some(pos) = line.find("mean_volume:") {
            let rest = &line[pos + "mean_volume:".len()..];
            if let Some(db_pos) = rest.find("dB") {
                if let Ok(v) = rest[..db_pos].trim().parse::<f64>() {
                    mean_vol = Some(v);
                }
            }
        }
    }

    let max_v = max_vol?;
    let mean_v = mean_vol.unwrap_or(max_v - 15.0);

    // Safe boost to bring peak to around -0.5 dB
    let suggested_gain = if max_v.is_finite() {
        (-0.5 - max_v).clamp(0.0, 24.0)
    } else {
        6.0
    };

    Some(VolumeAnalysis {
        max_volume_db: if max_v.is_finite() { max_v } else { -6.0 },
        mean_volume_db: if mean_v.is_finite() { mean_v } else { -20.0 },
        suggested_gain_db: suggested_gain,
    })
}

/// Run volumedetect pass on an audio/video source.
pub fn analyze_volume(
    ffmpeg: &Path,
    source: &Path,
    start_secs: Option<f64>,
    duration_secs: Option<f64>,
    cancel: &CancelToken,
) -> Result<VolumeAnalysis> {
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-y".into(),
        "-loglevel".into(),
        "info".into(), // volumedetect prints at info level
    ];

    if let Some(s) = start_secs {
        args.extend(["-ss".to_string(), format!("{s:.3}")]);
    }

    args.extend([
        "-i".to_string(),
        source.to_string_lossy().into_owned(),
    ]);

    if let Some(d) = duration_secs {
        args.extend(["-t".to_string(), format!("{d:.3}")]);
    }

    args.extend([
        "-vn".to_string(),
        "-af".to_string(),
        "volumedetect".to_string(),
        "-f".to_string(),
        "null".to_string(),
        "-".to_string(),
    ]);

    let stderr_buf: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let stderr_writer = Arc::clone(&stderr_buf);
    let stderr_cb: Box<dyn FnMut(&str) + Send> = Box::new(move |line: &str| {
        let mut g = stderr_writer.lock().unwrap();
        g.push_str(line);
        g.push('\n');
    });

    let spec = RunSpec::new(ffmpeg.to_path_buf(), args)
        .with_stderr_cb(stderr_cb)
        .cancellable(cancel.clone());

    let outcome = spec.run()?;
    if !outcome.success && outcome.code != Some(0) {
        let err_tail = outcome.stderr_tail.join("\n");
        return Err(AppError::FFmpeg(format!("Volume analysis failed: {err_tail}")));
    }

    let raw_stderr = stderr_buf.lock().unwrap().clone();
    parse_volumedetect(&raw_stderr).ok_or_else(|| {
        AppError::FFmpeg("Could not extract volume metrics from audio stream".into())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_volumedetect_standard() {
        let sample = r#"
[Parsed_volumedetect_0 @ 0x123456] n_samples: 441000
[Parsed_volumedetect_0 @ 0x123456] mean_volume: -23.8 dB
[Parsed_volumedetect_0 @ 0x123456] max_volume: -5.4 dB
[Parsed_volumedetect_0 @ 0x123456] histogram_5db: 123
"#;
        let analysis = parse_volumedetect(sample).expect("should parse");
        assert_eq!(analysis.max_volume_db, -5.4);
        assert_eq!(analysis.mean_volume_db, -23.8);
        assert!((analysis.suggested_gain_db - 4.9).abs() < 1e-6);
    }

    #[test]
    fn test_parse_volumedetect_zero_headroom() {
        let sample = r#"
[Parsed_volumedetect_0 @ 0x123456] mean_volume: -12.0 dB
[Parsed_volumedetect_0 @ 0x123456] max_volume: 0.0 dB
"#;
        let analysis = parse_volumedetect(sample).expect("should parse");
        assert_eq!(analysis.max_volume_db, 0.0);
        assert_eq!(analysis.suggested_gain_db, 0.0);
    }
}
