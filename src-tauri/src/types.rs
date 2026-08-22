use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
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
            return Err(AppError::InvalidInput("Split duration must be positive".into()));
        }
        if self.quality == QualityPreset::Custom {
            let br = self.custom_bitrate_kbps.unwrap_or(0);
            if !(16..=1000).contains(&br) {
                return Err(AppError::InvalidInput("Bitrate must be between 16 and 1000 kbps".into()));
            }
        }
        if self.remove_silence && !(self.silence_min_duration_secs > 0.0 && self.silence_min_duration_secs < 3600.0) {
            return Err(AppError::InvalidInput("Minimum silence duration must be between 0 and 3600 seconds".into()));
        }
        if self.remove_silence && !(-90..=-1).contains(&self.silence_threshold_db) {
            return Err(AppError::InvalidInput("Silence threshold must be between -90 and -1 dB".into()));
        }
        if self.output_mode == OutputMode::CustomFolder && self.custom_output_dir.is_none() {
            return Err(AppError::InvalidInput("Output folder is required".into()));
        }
        Ok(())
    }
}

use crate::error::{AppError, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Waiting,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub duration_secs: f64,
    pub format_name: String,
    pub has_audio: bool,
    pub error: Option<String>,
}

/// Emitted to frontend on every job state change.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    pub job_id: String,
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
