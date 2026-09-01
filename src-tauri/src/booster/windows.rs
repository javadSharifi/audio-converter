use super::{clamp_level, AudioSession, BoosterCapability, DesktopVolumeEngine};
use crate::error::{AppError, Result};

/// Windows WASAPI per-session volume via ISimpleAudioVolume (0.0..1.0 → 0..100).
/// Uses the `windows` crate COM bindings. CoInitializeEx is idempotent per thread.
/// `capability()` does a cheap COM probe instead of blindly claiming FullTierA.
pub struct WindowsVolumeEngine;

impl WindowsVolumeEngine {
    pub fn new() -> Self {
        Self
    }
}

/// Convert a COM-owned PWSTR into a String and free the CoTaskMem allocation.
/// Reading then freeing is required: the pointer is only valid until free.
unsafe fn take_pwstr(pw: windows::core::PWSTR) -> String {
    let s = pw.to_string().unwrap_or_default();
    windows::Win32::System::Com::CoTaskMemFree(Some(pw.0 as *const core::ffi::c_void));
    s
}

/// Cheap probe: COM + MMDeviceEnumerator must both come up for WASAPI to work.
fn com_probe() -> std::result::Result<(), String> {
    use windows::Win32::Media::Audio::{IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let _: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("CoCreateInstance MMDeviceEnumerator: {e:?}"))?;
    }
    Ok(())
}

impl DesktopVolumeEngine for WindowsVolumeEngine {
    fn capability(&self) -> BoosterCapability {
        if com_probe().is_ok() {
            BoosterCapability::FullTierA
        } else {
            BoosterCapability::Unsupported
        }
    }

    fn list_sessions(&self) -> Result<Vec<AudioSession>> {
        list_sessions_wasapi().map_err(AppError::Io)
    }

    fn set_session_boost(&self, session_id: String, level: u8) -> Result<()> {
        let lvl = clamp_level(level as u32, 100);
        set_session_volume_wasapi(&session_id, lvl).map_err(AppError::Io)
    }
}

fn list_sessions_wasapi() -> std::result::Result<Vec<AudioSession>, String> {
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IAudioSessionControl, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| format!("CoCreateInstance MMDeviceEnumerator: {e:?}"))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| format!("GetDefaultAudioEndpoint: {e:?}"))?;
        let mgr: IAudioSessionManager2 = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate IAudioSessionManager2: {e:?}"))?;
        let list = mgr.GetSessionEnumerator().map_err(|e| format!("GetSessionEnumerator: {e:?}"))?;
        let count = list.GetCount().map_err(|e| format!("GetCount: {e:?}"))?;
        let mut out = Vec::new();
        for i in 0..count {
            let ctrl: IAudioSessionControl = list.GetSession(i).map_err(|e| format!("GetSession {i}: {e:?}"))?;
            let ctrl2 = ctrl.cast::<IAudioSessionControl2>();
            let display = match &ctrl2 {
                Ok(c2) => {
                    let pw = c2.GetDisplayName().map_err(|e| format!("GetDisplayName: {e:?}"))?;
                    let s = take_pwstr(pw);
                    if s.is_empty() { "Unknown".into() } else { s }
                }
                Err(_) => ctrl
                    .GetDisplayName()
                    .ok()
                    .map(|pw| take_pwstr(pw))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| format!("Session {i}")),
            };
            let volume = ctrl
                .cast::<windows::Win32::Media::Audio::ISimpleAudioVolume>()
                .ok()
                .and_then(|v| v.GetMasterVolume().ok())
                .map(|f| (f * 100.0).round().clamp(0.0, 100.0) as u8)
                .unwrap_or(100);
            // Session instance id is the stable id; fall back to index.
            let sid = ctrl2
                .as_ref()
                .ok()
                .and_then(|c2| c2.GetSessionInstanceIdentifier().ok())
                .map(|pw| take_pwstr(pw))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| i.to_string());
            out.push(AudioSession {
                id: sid,
                name: display,
                volume,
                is_system: false,
            });
        }
        Ok(out)
    }
}

fn set_session_volume_wasapi(session_id: &str, level: u8) -> std::result::Result<(), String> {
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IAudioSessionControl, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| format!("CoCreateInstance: {e:?}"))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| format!("GetDefaultAudioEndpoint: {e:?}"))?;
        let mgr: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None).map_err(|e| format!("Activate: {e:?}"))?;
        let list = mgr.GetSessionEnumerator().map_err(|e| format!("GetSessionEnumerator: {e:?}"))?;
        let count = list.GetCount().map_err(|e| format!("GetCount: {e:?}"))?;
        for i in 0..count {
            let ctrl: IAudioSessionControl = list.GetSession(i).map_err(|e| format!("GetSession {i}: {e:?}"))?;
            let sid = ctrl
                .cast::<IAudioSessionControl2>()
                .ok()
                .and_then(|c2| c2.GetSessionInstanceIdentifier().ok())
                .map(|pw| take_pwstr(pw))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| i.to_string());
            if sid == session_id || i.to_string() == session_id {
                let vol: windows::Win32::Media::Audio::ISimpleAudioVolume =
                    ctrl.cast().map_err(|e| format!("cast ISimpleAudioVolume: {e:?}"))?;
                let f = (level as f32) / 100.0;
                vol.SetMasterVolume(f, std::ptr::null()).map_err(|e| format!("SetMasterVolume: {e:?}"))?;
                return Ok(());
            }
        }
        Err(format!("Session {session_id} not found"))
    }
}
