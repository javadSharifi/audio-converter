use std::process::Command;

use super::{clamp_level, AudioSession, BoosterCapability, DesktopVolumeEngine};
use crate::error::{AppError, Result};

/// Linux PulseAudio via `pactl` CLI. Range 0..150% (Pulse allows >100%).
/// Falls back to text parse if JSON unavailable; guards numeric IDs.
pub struct LinuxVolumeEngine;

impl LinuxVolumeEngine {
    pub fn new() -> Self {
        Self
    }

    fn pactl_available(&self) -> bool {
        Command::new("pactl").arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
    }
}

impl DesktopVolumeEngine for LinuxVolumeEngine {
    fn capability(&self) -> BoosterCapability {
        if self.pactl_available() {
            BoosterCapability::FullTierA
        } else {
            BoosterCapability::Unsupported
        }
    }

    fn list_sessions(&self) -> Result<Vec<AudioSession>> {
        if !self.pactl_available() {
            return Err(AppError::Unsupported("pactl not found — install PulseAudio".into()));
        }

        // Try JSON first (pactl >= 15), fallback to text parse
        let json_out = Command::new("pactl")
            .args(["-f", "json", "list", "sink-inputs"])
            .output();

        if let Ok(out) = json_out {
            if out.status.success() {
                if let Ok(txt) = String::from_utf8(out.stdout) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&txt) {
                        if let Some(arr) = val.as_array() {
                            let mut sessions = Vec::new();
                            for item in arr {
                                let id = item.get("index").and_then(|v| v.as_u64()).map(|n| n.to_string()).unwrap_or_default();
                                // Guard: numeric id only
                                if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
                                    continue;
                                }
                                let name = item
                                    .get("properties")
                                    .and_then(|p| p.get("application.name"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Unknown")
                                    .to_string();
                                // volume percent: average of channels or 100
                                let vol = item
                                    .get("volume")
                                    .and_then(|v| v.get("front-left"))
                                    .and_then(|v| v.get("value_percent"))
                                    .and_then(|v| v.as_str())
                                    .and_then(|s| s.trim_end_matches('%').parse::<u32>().ok())
                                    .unwrap_or(100);
                                sessions.push(AudioSession {
                                    id,
                                    name,
                                    volume: clamp_level(vol, 150),
                                    is_system: false,
                                });
                            }
                            if !sessions.is_empty() {
                                return Ok(sessions);
                            }
                        }
                    }
                }
            }
        }

        // Text fallback: `pactl list sink-inputs`
        let out = Command::new("pactl")
            .args(["list", "sink-inputs"])
            .output()
            .map_err(|e| AppError::Io(format!("pactl failed: {e}")))?;
        if !out.status.success() {
            return Err(AppError::Io("pactl list failed".into()));
        }
        let txt = String::from_utf8_lossy(&out.stdout);
        let mut sessions = Vec::new();
        let mut cur_id: Option<String> = None;
        let mut cur_name = String::from("Unknown");
        let mut cur_vol: u32 = 100;
        for line in txt.lines() {
            let t = line.trim();
            if t.starts_with("Sink Input #") {
                if let Some(id) = cur_id.take() {
                    sessions.push(AudioSession {
                        id,
                        name: cur_name.clone(),
                        volume: clamp_level(cur_vol, 150),
                        is_system: false,
                    });
                    cur_name = "Unknown".into();
                    cur_vol = 100;
                }
                let id = t.trim_start_matches("Sink Input #").trim().to_string();
                if id.chars().all(|c| c.is_ascii_digit()) {
                    cur_id = Some(id);
                }
            } else if t.starts_with("application.name =") {
                let v = t.split('=').nth(1).unwrap_or("").trim().trim_matches('"').to_string();
                if !v.is_empty() {
                    cur_name = v;
                }
            } else if t.contains("Volume:") && t.contains('%') {
                if let Some(pct) = t.split('%').next().and_then(|s| s.rsplit('/').next()).and_then(|s| s.trim().trim_end_matches('%').parse::<u32>().ok()) {
                    cur_vol = pct;
                } else if let Some(num) = t.split_whitespace().find(|w| w.ends_with('%')).and_then(|w| w.trim_end_matches('%').parse::<u32>().ok()) {
                    cur_vol = num;
                }
            }
        }
        if let Some(id) = cur_id {
            sessions.push(AudioSession {
                id,
                name: cur_name,
                volume: clamp_level(cur_vol, 150),
                is_system: false,
            });
        }
        Ok(sessions)
    }

    fn set_session_boost(&self, session_id: String, level: u8) -> Result<()> {
        if !session_id.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::InvalidInput("Invalid session id".into()));
        }
        let lvl = clamp_level(level as u32, 150);
        let out = Command::new("pactl")
            .args(["set-sink-input-volume", &session_id, &format!("{lvl}%")])
            .output()
            .map_err(|e| AppError::Io(format!("pactl set failed: {e}")))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(AppError::Io(format!("pactl set failed: {}", err.trim())));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_linux_range() {
        assert_eq!(clamp_level(0, 150), 0);
        assert_eq!(clamp_level(150, 150), 150);
        assert_eq!(clamp_level(200, 150), 150);
    }

    #[test]
    fn rejects_non_numeric_id() {
        let e = LinuxVolumeEngine::new();
        assert!(e.set_session_boost("abc".into(), 100).is_err());
        assert!(e.set_session_boost("../1".into(), 100).is_err());
    }
}
