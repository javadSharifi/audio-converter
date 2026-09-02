use crate::music_library::models::{AudioTrackInfo, LibraryPermissionStatus};

#[cfg(target_os = "android")]
pub fn get_permission_status() -> LibraryPermissionStatus {
    let res = crate::android_fs::call_static_string_quiet("checkMusicPermission", "");
    match res.as_str() {
        "granted" => LibraryPermissionStatus::Granted,
        "permanently_denied" => LibraryPermissionStatus::PermanentlyDenied,
        _ => LibraryPermissionStatus::Denied,
    }
}

#[cfg(not(target_os = "android"))]
pub fn get_permission_status() -> LibraryPermissionStatus {
    LibraryPermissionStatus::NotRequired
}

#[cfg(target_os = "android")]
pub fn scan_media_store() -> Vec<AudioTrackInfo> {
    let json_str = crate::android_fs::call_static_string_quiet("queryMediaStoreMusic", "");
    if json_str.is_empty() {
        return Vec::new();
    }
    serde_json::from_str(&json_str).unwrap_or_default()
}

#[cfg(not(target_os = "android"))]
pub fn scan_media_store() -> Vec<AudioTrackInfo> {
    Vec::new()
}

#[cfg(target_os = "android")]
pub fn delete_track(uri: &str) -> Result<(), String> {
    let res = crate::android_fs::call_static_string_quiet("deleteAudioTrack", uri);
    if res == "OK" {
        Ok(())
    } else {
        Err(res)
    }
}

#[cfg(not(target_os = "android"))]
pub fn delete_track(_uri: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "android")]
pub fn set_ringtone(uri: &str) -> Result<(), String> {
    let res = crate::android_fs::call_static_string_quiet("setAsRingtone", uri);
    if res == "OK" {
        Ok(())
    } else if res == "PERMISSION_REQUIRED" {
        Err("PERMISSION_REQUIRED".to_string())
    } else {
        Err(res)
    }
}

#[cfg(not(target_os = "android"))]
pub fn set_ringtone(_uri: &str) -> Result<(), String> {
    Err("Ringtone setting is only available on mobile Android devices.".to_string())
}

#[cfg(target_os = "android")]
pub fn share_track(uri: &str, title: &str, mime_type: &str) -> Result<(), String> {
    let json_arg = serde_json::json!({
        "uri": uri,
        "title": title,
        "mimeType": mime_type,
    });
    let res = crate::android_fs::call_static_string_quiet("shareAudioTrack", &json_arg.to_string());
    if res == "OK" {
        Ok(())
    } else {
        // Fallback calling directly with uri
        let res2 = crate::android_fs::call_static_string_quiet("shareAudioTrack", uri);
        if res2 == "OK" {
            Ok(())
        } else {
            Err(res)
        }
    }
}

#[cfg(not(target_os = "android"))]
pub fn share_track(_uri: &str, _title: &str, _mime_type: &str) -> Result<(), String> {
    Ok(())
}
