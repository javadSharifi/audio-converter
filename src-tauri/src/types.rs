use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum AudioFormat {
    Mp3,
    Wav,
    Aac,
    M4a,
    Flac,
    Opus,
}

impl AudioFormat {
    pub fn extension(&self) -> &'static str {
        match self {
            AudioFormat::Mp3 => "mp3",
            AudioFormat::Wav => "wav",
            AudioFormat::Aac => "aac",
            AudioFormat::M4a => "m4a",
            AudioFormat::Flac => "flac",
            AudioFormat::Opus => "opus",
        }
    }

    pub fn is_lossless(&self) -> bool {
        matches!(self, AudioFormat::Wav | AudioFormat::Flac)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum QualityPreset {
    Low,
    Medium,
    High,
    VeryHigh,
    Custom,
}

impl QualityPreset {
    /// Sensible bitrate (kbps) per format for each preset. Only meaningful
    /// for lossy formats.
    pub fn bitrate_kbps(self, format: AudioFormat) -> u32 {
        match format {
            AudioFormat::Mp3 => match self {
                QualityPreset::Low => 96,
                QualityPreset::Medium => 192,
                QualityPreset::High => 256,
                _ => 320,
            },
            // AAC/Opus/M4A reach comparable perceived quality at lower rates
            AudioFormat::Aac | AudioFormat::M4a | AudioFormat::Opus => match self {
                QualityPreset::Low => 64,
                QualityPreset::Medium => 128,
                QualityPreset::High => 192,
                _ => 256,
            },
            AudioFormat::Wav | AudioFormat::Flac => 0,
        }
    }
}

/// Where output files are written.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum OutputMode {
    /// Next to the source file.
    #[default]
    SameAsSource,
    /// In a user-chosen folder; one subfolder per source when multiple files.
    CustomFolder,
    /// Auto-created per-source-file subfolder next to the source.
    PerSourceFolder,
}

/// Optional per-file trim window, in seconds. Both bounds optional: a `None`
/// bound means "until the start/end of the file". Serialized as
/// `{ path, startTime, endTime }` from the frontend (camelCase, seconds).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TrimSpec {
    pub path: String,
    /// Fast-seek position; inserted BEFORE `-i` when present.
    pub start_time_secs: Option<f64>,
    /// Stop position; inserted AFTER `-i` as `-to` when present.
    pub end_time_secs: Option<f64>,
}

impl TrimSpec {
    pub fn validate(&self) -> Result<()> {
        if let Some(s) = self.start_time_secs {
            if !(s.is_finite() && s >= 0.0) {
                return Err(AppError::InvalidInput(format!(
                    "Start time must be ≥ 0 for {}",
                    self.path
                )));
            }
        }
        if let Some(e) = self.end_time_secs {
            if !(e.is_finite() && e > 0.0) {
                return Err(AppError::InvalidInput(format!(
                    "End time must be positive for {}",
                    self.path
                )));
            }
        }
        if let (Some(s), Some(e)) = (self.start_time_secs, self.end_time_secs) {
            if e <= s {
                return Err(AppError::InvalidInput(format!(
                    "End time ({e}s) must be after start time ({s}s) for {}",
                    self.path
                )));
            }
        }
        Ok(())
    }

    /// `-to` is measured on the POST-`-ss` timeline (input seeking resets the
    /// timestamp origin to the seek point), so rebase it to a relative offset.
    /// Without rebasing, `start=10 end=30` would decode 40s of audio instead
    /// of the requested 20s.
    pub fn effective_to(&self) -> Option<f64> {
        match (self.end_time_secs, self.start_time_secs) {
            (Some(end), Some(start)) => Some((end - start).max(0.001)),
            (Some(end), None) => Some(end),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ConversionOptions {
    pub format: AudioFormat,
    pub quality: QualityPreset,
    /// Used when quality == Custom. kbps.
    pub custom_bitrate_kbps: Option<u32>,
    pub sample_rate_hz: Option<u32>,
    pub channels: Option<u16>,
    pub split_enabled: bool,
    /// Part duration in seconds (accepts minutes*60 or HH:MM:SS from UI).
    pub split_duration_secs: f64,
    pub remove_silence: bool,
    /// Negative dB threshold, e.g. -30.
    pub silence_threshold_db: i32,
    pub silence_min_duration_secs: f64,
    pub output_mode: OutputMode,
    /// Required when output_mode == CustomFolder.
    pub custom_output_dir: Option<String>,
}

impl Default for ConversionOptions {
    fn default() -> Self {
        Self {
            format: AudioFormat::Mp3,
            quality: QualityPreset::Medium,
            custom_bitrate_kbps: None,
            sample_rate_hz: Some(44100),
            channels: Some(2),
            split_enabled: false,
            split_duration_secs: 600.0,
            remove_silence: false,
            silence_threshold_db: -30,
            silence_min_duration_secs: 2.0,
            output_mode: OutputMode::SameAsSource,
            custom_output_dir: None,
        }
    }
}

impl ConversionOptions {
    pub fn effective_bitrate(&self) -> Option<u32> {
        if self.format.is_lossless() {
            return None;
        }
        match self.quality {
            QualityPreset::Custom => self.custom_bitrate_kbps,
            preset => Some(preset.bitrate_kbps(self.format.clone())),
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.split_enabled && self.split_duration_secs <= 0.0 {
            return Err(AppError::InvalidInput(
                "Split duration must be positive".into(),
            ));
        }
        if self.quality == QualityPreset::Custom {
            let br = self.custom_bitrate_kbps.unwrap_or(0);
            if !(16..=1000).contains(&br) {
                return Err(AppError::InvalidInput(
                    "Bitrate must be between 16 and 1000 kbps".into(),
                ));
            }
        }
        if self.remove_silence
            && !(self.silence_min_duration_secs > 0.0 && self.silence_min_duration_secs < 3600.0)
        {
            return Err(AppError::InvalidInput(
                "Minimum silence duration must be between 0 and 3600 seconds".into(),
            ));
        }
        if self.remove_silence && !(-90..=-1).contains(&self.silence_threshold_db) {
            return Err(AppError::InvalidInput(
                "Silence threshold must be between -90 and -1 dB".into(),
            ));
        }
        if self.output_mode == OutputMode::CustomFolder && self.custom_output_dir.is_none() {
            return Err(AppError::InvalidInput("Output folder is required".into()));
        }
        Ok(())
    }
}

use crate::error::{AppError, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Waiting,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub name: String,
    pub path: String,
    #[specta(type = u32)]
    pub size_bytes: u64,
    pub duration_secs: f64,
    pub format_name: String,
    pub has_audio: bool,
    pub error: Option<String>,
}

/// Emitted to frontend on every job state change.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    pub id: String,
    pub source_path: String,
    pub status: JobStatus,
    /// 0..=100 overall for this job.
    pub percent: Option<f64>,
    /// e.g. "12.3x"
    pub speed: Option<String>,
    /// User-readable error message.
    pub error: Option<String>,
    /// Raw stderr tail / technical details.
    pub technical: Option<String>,
    /// Warning surfaced to user without failing the job.
    pub warning: Option<String>,
    /// Output file paths after success.
    pub outputs: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trim_spec_deserializes_start_time_secs() {
        let json = r#"{"path":"/tmp/b.mp4","startTimeSecs":5.0,"endTimeSecs":20.0}"#;
        let spec: TrimSpec = serde_json::from_str(json).unwrap();
        assert_eq!(spec.path, "/tmp/b.mp4");
        assert_eq!(spec.start_time_secs, Some(5.0));
        assert_eq!(spec.end_time_secs, Some(20.0));
    }

    #[test]
    fn trim_spec_deserializes_nulls_as_none() {
        let json = r#"{"path":"/tmp/c.mp4","startTimeSecs":null,"endTimeSecs":null}"#;
        let spec: TrimSpec = serde_json::from_str(json).unwrap();
        assert_eq!(spec.start_time_secs, None);
        assert_eq!(spec.end_time_secs, None);
    }
}
