use std::path::PathBuf;
use std::sync::OnceLock;

static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Called once at app startup with the Tauri-resolved data directory.
pub fn init_app_data_dir(dir: PathBuf) {
    let _ = APP_DATA_DIR.set(dir);
}

/// Data dir used by the logger and settings store. Tests fall back to a
/// temp dir so logging never panics outside the app runtime.
pub fn app_data_dir() -> Option<PathBuf> {
    if let Some(d) = APP_DATA_DIR.get() {
        return Some(d.clone());
    }
    // Test/dev fallback.
    std::env::var("AUDIO_CONVERTER_DATA_DIR")
        .ok()
        .map(PathBuf::from)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub language: String, // "en" | "fa"
    pub theme: String,    // "light" | "dark" | "system"
    pub default_format: crate::types::AudioFormat,
    pub default_quality: crate::types::QualityPreset,
    pub default_output_mode: crate::types::OutputMode,
    pub default_output_dir: Option<String>,
    pub auto_open_output_folder: bool,
    pub concurrency: u32,
    pub remove_silence_default: bool,
    pub silence_threshold_db: i32,
    pub silence_min_duration_secs: f64,
    /// Advanced/debug only: override bundled ffmpeg location.
    pub ffmpeg_path_override: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: "en".into(),
            theme: "system".into(),
            default_format: crate::types::AudioFormat::Mp3,
            default_quality: crate::types::QualityPreset::Medium,
            default_output_mode: crate::types::OutputMode::SameAsSource,
            default_output_dir: None,
            auto_open_output_folder: false,
            concurrency: default_concurrency(),
            remove_silence_default: false,
            silence_threshold_db: -30,
            silence_min_duration_secs: 2.0,
            ffmpeg_path_override: None,
        }
    }
}

impl Settings {
    pub fn validate(&mut self) -> Result<(), String> {
        self.concurrency = self.concurrency.clamp(1, max_reasonable_concurrency());
        if !matches!(self.language.as_str(), "en" | "fa") {
            self.language = "en".into();
        }
        if !matches!(self.theme.as_str(), "light" | "dark" | "system") {
            self.theme = "system".into();
        }
        if !(self.silence_min_duration_secs > 0.0 && self.silence_min_duration_secs <= 600.0) {
            self.silence_min_duration_secs = 2.0;
        }
        if !(-90..=-5).contains(&self.silence_threshold_db) {
            self.silence_threshold_db = -30;
        }
        Ok(())
    }

    fn file_path() -> Option<PathBuf> {
        app_data_dir().map(|d| d.join("settings.json"))
    }

    pub fn load() -> Self {
        let Some(path) = Self::file_path() else {
            return Self::default();
        };
        match std::fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<Settings>(&raw) {
                Ok(mut s) => {
                    let _ = s.validate();
                    s
                }
                Err(_) => Self::default(),
            },
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let Some(path) = Self::file_path() else {
            return Err("No data directory available".into());
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut clean = self.clone();
        clean.validate()?;
        let json = serde_json::to_string_pretty(&clean).map_err(|e| e.to_string())?;
        // Atomic write: a crash mid-write must never corrupt settings.json.
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            e.to_string()
        })
    }
}

/// Audio conversion is CPU-bound; more workers than cores only oversubscribes.
pub fn max_reasonable_concurrency() -> u32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4)
        .clamp(1, 32)
}

pub fn default_concurrency() -> u32 {
    ((max_reasonable_concurrency() / 2).max(1)).min(4)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Tests that mutate process-wide env vars must hold this lock.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn defaults_valid() {
        let mut s = Settings::default();
        s.validate().unwrap();
        assert!(s.concurrency >= 1 && s.concurrency <= 4);
    }

    #[test]
    fn clamps_bad_values() {
        let mut s = Settings {
            concurrency: 999,
            language: "xx".into(),
            theme: "neon".into(),
            silence_threshold_db: -500,
            silence_min_duration_secs: -3.0,
            ..Default::default()
        };
        s.validate().unwrap();
        assert_eq!(s.concurrency, max_reasonable_concurrency());
        assert_eq!(s.language, "en");
        assert_eq!(s.theme, "system");
        assert_eq!(s.silence_threshold_db, -30);
        assert_eq!(s.silence_min_duration_secs, 2.0);
    }

    #[test]
    fn round_trips_through_json() {
        let s = Settings {
            language: "fa".into(),
            theme: "dark".into(),
            auto_open_output_folder: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.language, "fa");
        assert_eq!(back.theme, "dark");
        assert!(back.auto_open_output_folder);
    }

    #[test]
    fn load_survives_corrupt_file() {
        // Serialize env-var mutation — unit tests share one process.
        let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let dir = std::env::temp_dir().join(format!(
            "ac-settings-corrupt-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("AUDIO_CONVERTER_DATA_DIR", &dir);
        std::fs::write(dir.join("settings.json"), "{not json").unwrap();
        let s = Settings::load();
        assert_eq!(s, Settings::default());
        let _ = std::fs::remove_dir_all(&dir);
        std::env::remove_var("AUDIO_CONVERTER_DATA_DIR");
    }

    #[test]
    fn save_is_atomic_and_round_trips() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let dir = std::env::temp_dir().join(format!(
            "ac-settings-atomic-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("AUDIO_CONVERTER_DATA_DIR", &dir);

        let mut s = Settings::default();
        s.language = "fa".into();
        s.save().unwrap();
        assert!(dir.join("settings.json").exists());
        assert!(!dir.join("settings.json.tmp").exists());
        assert_eq!(Settings::load(), s);

        let _ = std::fs::remove_dir_all(&dir);
        std::env::remove_var("AUDIO_CONVERTER_DATA_DIR");
    }
}
