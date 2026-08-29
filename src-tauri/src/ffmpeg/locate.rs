use std::path::PathBuf;

/// Locate a bundled helper binary (ffmpeg / ffprobe).
///
/// Resolution order:
/// 1. `FFMPEG_PATH` / `FFPROBE_PATH` env override (tests, debugging)
/// 2. Next to the running executable — this is where Tauri places
///    `externalBin` sidecars in both dev and bundled apps.
/// 3. Bare name from `PATH` (dev convenience only; never relied on in prod).
pub fn locate(name: &str) -> Result<PathBuf, crate::error::AppError> {
    let env_key = if name == "ffmpeg" {
        "FFMPEG_PATH"
    } else {
        "FFPROBE_PATH"
    };
    if let Ok(p) = std::env::var(env_key) {
        let path = PathBuf::from(&p);
        if path.exists() {
            return Ok(path);
        }
        return Err(crate::error::AppError::NotFound(format!(
            "{name} not found at {p} (from {env_key})"
        )));
    }

    #[cfg(target_os = "android")]
    {
        // On Android, externalBin binaries are packaged in nativeLibraryDir as lib<name>.so.
        let so_name = format!("lib{name}.so");

        // 1. Check custom env var if injected by MainActivity
        if let Ok(lib_dir) = std::env::var("TAURI_ANDROID_NATIVE_LIB_DIR") {
            let candidate = PathBuf::from(lib_dir).join(&so_name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }

        // 2. Check standard Android app lib paths
        for base in [
            "/data/data/com.audioconverter.app/lib",
            "/data/user/0/com.audioconverter.app/lib",
        ] {
            let candidate = PathBuf::from(base).join(&so_name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }

        // 3. Scan /data/app for package native library dir
        if let Ok(entries) = std::fs::read_dir("/data/app") {
            for entry in entries.flatten() {
                let name_str = entry.file_name().to_string_lossy().into_owned();
                if name_str.contains("com.audioconverter.app") {
                    for arch in ["arm64", "arm64-v8a", "arm", "armeabi-v7a", "x86_64", "x86"] {
                        let candidate = entry.path().join("lib").join(arch).join(&so_name);
                        if candidate.exists() {
                            return Ok(candidate);
                        }
                    }
                }
            }
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            #[cfg(windows)]
            let candidate = dir.join(format!("{name}.exe"));
            #[cfg(not(windows))]
            let candidate = dir.join(name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // Dev convenience: cargo test runs binaries under target/deps.
    if let Ok(cargo_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        for rel in ["binaries", "../binaries"] {
            #[cfg(windows)]
            let candidate = PathBuf::from(&cargo_dir)
                .join(rel)
                .join(format!("{name}.exe"));
            #[cfg(not(windows))]
            let candidate = PathBuf::from(&cargo_dir).join(rel).join(name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Err(crate::error::AppError::NotFound(format!(
        "{name} binary is not bundled with the application"
    )))
}

pub fn ffmpeg_path() -> Result<PathBuf, crate::error::AppError> {
    locate("ffmpeg")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_override_wins() {
        // Point at a file that certainly exists: the manifest itself.
        std::env::set_var("FFMPEG_PATH", env!("CARGO_MANIFEST_DIR"));
        assert!(locate("ffmpeg").is_ok());
        // Bogus override must surface as NotFound naming the bad path.
        std::env::set_var("FFPROBE_PATH", "/nonexistent/ffprobe-tool");
        match locate("ffprobe") {
            Err(crate::error::AppError::NotFound(msg)) => assert!(msg.contains("/nonexistent")),
            other => panic!("expected NotFound, got {other:?}"),
        }
        std::env::remove_var("FFMPEG_PATH");
        std::env::remove_var("FFPROBE_PATH");
    }
}
