use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

/// What the current OS can do for per-app volume boost.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BoosterCapability {
    /// Full per-session control (Windows WASAPI, Linux PulseAudio).
    FullTierA,
    /// Can list sessions but not boost (future).
    ReadOnly,
    /// Not supported (macOS).
    Unsupported,
}

/// One audio session (app) visible to the OS mixer.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioSession {
    pub id: String,
    pub name: String,
    /// Current volume percent (0..100 Windows, 0..150 Linux).
    pub volume: u8,
    pub is_system: bool,
}

pub fn clamp_level(level: u32, max: u32) -> u8 {
    level.clamp(0, max) as u8
}

pub trait DesktopVolumeEngine: Send + Sync {
    fn capability(&self) -> BoosterCapability;
    fn list_sessions(&self) -> Result<Vec<AudioSession>>;
    fn set_session_boost(&self, session_id: String, level: u8) -> Result<()>;
}

pub struct UnsupportedEngine {
    reason: String,
}

impl UnsupportedEngine {
    pub fn new(reason: impl Into<String>) -> Self {
        Self { reason: reason.into() }
    }
}

impl DesktopVolumeEngine for UnsupportedEngine {
    fn capability(&self) -> BoosterCapability {
        BoosterCapability::Unsupported
    }
    fn list_sessions(&self) -> Result<Vec<AudioSession>> {
        Err(AppError::Unsupported(self.reason.clone()))
    }
    fn set_session_boost(&self, _session_id: String, _level: u8) -> Result<()> {
        Err(AppError::Unsupported(self.reason.clone()))
    }
}

#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "windows")]
pub fn default_engine() -> Box<dyn DesktopVolumeEngine> {
    Box::new(windows::WindowsVolumeEngine::new())
}
#[cfg(target_os = "linux")]
pub fn default_engine() -> Box<dyn DesktopVolumeEngine> {
    Box::new(linux::LinuxVolumeEngine::new())
}
#[cfg(target_os = "macos")]
pub fn default_engine() -> Box<dyn DesktopVolumeEngine> {
    Box::new(macos::MacosVolumeEngine::new())
}
#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
pub fn default_engine() -> Box<dyn DesktopVolumeEngine> {
    Box::new(UnsupportedEngine::new("Unsupported platform"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_level_bounds() {
        assert_eq!(clamp_level(0, 100), 0);
        assert_eq!(clamp_level(50, 100), 50);
        assert_eq!(clamp_level(200, 100), 100);
        assert_eq!(clamp_level(200, 150), 150);
    }

    #[test]
    fn unsupported_engine_returns_error() {
        let e = UnsupportedEngine::new("macOS not supported");
        assert_eq!(e.capability(), BoosterCapability::Unsupported);
        assert!(e.list_sessions().is_err());
        assert!(e.set_session_boost("x".into(), 50).is_err());
    }
}
