/// Cross-platform free-disk-space check without heavyweight deps.
#[cfg(unix)]
pub fn free_bytes(path: &std::path::Path) -> Option<u64> {
    use std::ffi::CString;
    let c = CString::new(path.to_string_lossy().as_bytes()).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statvfs(c.as_ptr(), &mut stat) };
    if rc != 0 {
        return None;
    }
    // f_bavail = blocks available to unprivileged users.
    Some(stat.f_bavail as u64 * stat.f_frsize as u64)
}

#[cfg(windows)]
pub fn free_bytes(path: &std::path::Path) -> Option<u64> {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    use windows_sys::Win32::Foundation::ULARGE_INTEGER;

    let wide: Vec<u16> = path
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut avail = ULARGE_INTEGER { u: Default::default() };
    let ok = unsafe {
        GetDiskFreeSpaceExW(wide.as_ptr(), &mut avail, std::ptr::null_mut(), std::ptr::null_mut())
    };
    if ok == 0 {
        return None;
    }
    Some(unsafe { *avail.QuadPart() })
}

/// Estimate encoded output size in bytes for the given duration.
pub fn estimate_output_bytes(bitrate_kbps: Option<u32>, duration_secs: f64) -> u64 {
    // Lossless fallbacks: WAV ~1411 kbps stereo 44.1k; FLAC ~60% of WAV.
    let kbps = bitrate_kbps.unwrap_or(1411) as f64;
    (kbps * 1000.0 / 8.0 * duration_secs.max(0.0)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimation_sane() {
        // 128kbps × 60s = 960_000 bytes
        assert_eq!(estimate_output_bytes(Some(128), 60.0), 960_000);
        assert!(estimate_output_bytes(None, 10.0) > 0);
    }

    #[test]
    fn current_volume_has_space() {
        assert!(free_bytes(std::path::Path::new(".")).unwrap_or(0) > 0);
    }
}
