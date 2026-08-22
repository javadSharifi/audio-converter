use serde::Deserialize;

/// Subset of ffprobe JSON we care about.
#[derive(Debug, Deserialize)]
pub struct ProbeResult {
    #[serde(default)]
    pub streams: Vec<StreamInfo>,
    pub format: Option<FormatInfo>,
}

#[derive(Debug, Deserialize)]
pub struct StreamInfo {
    pub codec_type: Option<String>,
    pub codec_name: Option<String>,
    pub sample_rate: Option<String>,
    pub channels: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct FormatInfo {
    pub duration: Option<String>,
    pub format_name: Option<String>,
    pub tags: Option<std::collections::HashMap<String, String>>,
}

pub fn parse_probe_json(stdout: &str) -> Result<ProbeResult, crate::error::AppError> {
    serde_json::from_str(stdout)
        .map_err(|e| crate::error::AppError::CorruptedFile(format!("ffprobe returned invalid JSON: {e}")))
}

impl ProbeResult {
    pub fn audio_stream(&self) -> Option<&StreamInfo> {
        self.streams.iter().find(|s| s.codec_type.as_deref() == Some("audio"))
    }

    pub fn duration_secs(&self) -> Option<f64> {
        self.format
            .as_ref()
            .and_then(|f| f.duration.as_deref())
            .and_then(|d| d.parse::<f64>().ok())
    }
}

/// Run `ffprobe` against `path` and return parsed info. Never panics on bad
/// input; maps every failure to a user-appropriate error.
pub fn probe_file(ffprobe: &std::path::Path, path: &str) -> Result<ProbeResult, crate::error::AppError> {
    use crate::error::AppError;

    if !std::path::Path::new(path).exists() {
        return Err(AppError::NotFound(format!("File does not exist: {path}")));
    }

    // Structured argument array — never a shell string (injection safety).
    let output = std::process::Command::new(ffprobe)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            "--",
        ])
        .arg(path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to launch ffprobe: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let result = parse_probe_json(&stdout)?;

    if result.format.is_none() && result.streams.is_empty() {
        return Err(AppError::CorruptedFile(format!("ffprobe found no media data in {path}")));
    }

    if result.audio_stream().is_none() {
        return Err(AppError::NoAudioTrack(format!("{path} contains no audio stream")));
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_probe_output() {
        let json = r#"{
            "streams": [
                {"codec_type": "video", "codec_name": "h264"},
                {"codec_type": "audio", "codec_name": "aac", "sample_rate": "48000", "channels": 2}
            ],
            "format": {"duration": "123.456000", "format_name": "mov,mp4,m4a"}
        }"#;
        let p = parse_probe_json(json).unwrap();
        assert_eq!(p.audio_stream().unwrap().codec_name.as_deref(), Some("aac"));
        assert!((p.duration_secs().unwrap() - 123.456).abs() < 0.001);
    }

    #[test]
    fn rejects_empty_probe() {
        assert!(parse_probe_json("{}").is_ok()); // valid JSON; emptiness checked by caller
        assert!(parse_probe_json("not json at all").is_err());
    }

    #[test]
    fn detects_missing_audio() {
        let json = r#"{"streams":[{"codec_type":"video"}],"format":{"duration":"10"}}"#;
        let p = parse_probe_json(json).unwrap();
        assert!(p.audio_stream().is_none());
    }
}
