use crate::booster::{AudioSession, BoosterCapability};
use crate::error::Result;

#[tauri::command]
#[specta::specta]
pub fn list_audio_sessions() -> Result<Vec<AudioSession>> {
    let engine = crate::booster::default_engine();
    engine.list_sessions()
}

#[tauri::command]
#[specta::specta]
pub fn set_session_boost(session_id: String, level: u32) -> Result<()> {
    let engine = crate::booster::default_engine();
    let max = match engine.capability() {
        BoosterCapability::FullTierA => {
            #[cfg(target_os = "linux")]
            { 150 }
            #[cfg(not(target_os = "linux"))]
            { 100 }
        }
        _ => 100,
    };
    let lvl = crate::booster::clamp_level(level, max);
    engine.set_session_boost(session_id, lvl)
}

#[tauri::command]
#[specta::specta]
pub fn get_booster_capability() -> BoosterCapability {
    let engine = crate::booster::default_engine();
    engine.capability()
}
