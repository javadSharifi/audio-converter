use std::path::Path;

use super::analyze::VolumeAnalysis;
use super::presets::{build_preset_filter_chain, BoosterPreset};
use crate::processing::pipeline::encoder_args;
use crate::types::{AudioFormat, TrimSpec};

/// Build conversion arguments for exporting a boosted audio file.
pub fn build_boost_args(
    source: &Path,
    output: &Path,
    preset: BoosterPreset,
    manual_gain_percent: Option<f64>,
    format: &AudioFormat,
    bitrate_kbps: Option<u32>,
    sample_rate_hz: Option<u32>,
    channels: Option<u16>,
    trim: Option<&TrimSpec>,
    analysis: Option<&VolumeAnalysis>,
) -> Vec<String> {
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

    // Audio filter chain for Sound Booster
    let filter_chain = build_preset_filter_chain(preset, manual_gain_percent, analysis);
    args.extend(["-af".to_string(), filter_chain]);

    // Map audio only and drop video
    args.extend([
        "-vn".to_string(),
        "-map_metadata".to_string(),
        "0".to_string(),
    ]);

    // Audio codec arguments
    let mut codec = encoder_args(format, bitrate_kbps);
    let sample_rate = if *format == AudioFormat::Opus {
        match sample_rate_hz {
            Some(sr) if matches!(sr, 8000 | 12000 | 16000 | 24000 | 48000) => Some(sr),
            _ => Some(48000),
        }
    } else {
        sample_rate_hz
    };

    if let Some(sr) = sample_rate {
        codec.extend(["-ar".to_string(), sr.to_string()]);
    }
    if let Some(ch) = channels {
        codec.extend(["-ac".to_string(), ch.to_string()]);
    }

    args.extend(codec);
    args.push(output.to_string_lossy().into_owned());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_boost_args_includes_filters_and_limiter() {
        let src = Path::new("/test/input.mp4");
        let out = Path::new("/test/output.mp3");
        let args = build_boost_args(
            src,
            out,
            BoosterPreset::Smart,
            None,
            &AudioFormat::Mp3,
            Some(320),
            Some(44100),
            Some(2),
            None,
            None,
        );

        let cmd = args.join(" ");
        assert!(cmd.contains("-af dynaudnorm="));
        assert!(cmd.contains("alimiter="));
        assert!(cmd.contains("libmp3lame"));
        assert!(cmd.contains("-b:a 320k"));
        assert!(cmd.contains("-vn"));
    }
}
