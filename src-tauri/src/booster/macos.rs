use super::{AudioSession, BoosterCapability, DesktopVolumeEngine};
use crate::error::{AppError, Result};

/// macOS has no public per-app volume API (CoreAudio is global).
/// Honest Unsupported rather than fake slider.
pub struct MacosVolumeEngine;

impl MacosVolumeEngine {
    pub fn new() -> Self {
        Self
    }
}

impl DesktopVolumeEngine for MacosVolumeEngine {
    fn capability(&self) -> BoosterCapability {
        BoosterCapability::Unsupported
    }

    fn list_sessions(&self) -> Result<Vec<AudioSession>> {
        Err(AppError::Unsupported(
            "Per-app volume boost is not supported on macOS (system audio is global). Use File Booster instead.".into(),
        ))
    }

    fn set_session_boost(&self, _session_id: String, _level: u8) -> Result<()> {
        Err(AppError::Unsupported("Not supported on macOS".into()))
    }
}
