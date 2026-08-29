use std::path::PathBuf;

/// Locate a bundled helper binary (ffmpeg / ffprobe).
///
/// Resolution order:
/// 1. `FFMPEG_PATH` / `FFPROBE_PATH` env override (tests, debugging)
/// 2. Platform-specific resolution:
///    - Android: dynamic nativeLibraryDir via `TAURI_ANDROID_NATIVE_LIB_DIR`, app lib paths (`lib<name>.so`)
///    - Desktop: Next to running executable or `CARGO_MANIFEST_DIR/binaries`
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
        locate_android(name)
    }

    #[cfg(not(target_os = "android"))]
    {
        locate_desktop(name)
    }
}

#[cfg(target_os = "android")]
fn locate_android(name: &str) -> Result<PathBuf, crate::error::AppError> {
    let so_name = format!("lib{name}.so");
    let mut checked = Vec::new();

    // 1. Check custom env var if injected by MainActivity (TAURI_ANDROID_NATIVE_LIB_DIR)
    if let Ok(lib_dir) = std::env::var("TAURI_ANDROID_NATIVE_LIB_DIR") {
        let candidate = PathBuf::from(&lib_dir).join(&so_name);
        checked.push(candidate.display().to_string());
        if candidate.exists() {
            crate::log_info!("Android locate {name}: FOUND via TAURI_ANDROID_NATIVE_LIB_DIR at {}", candidate.display());
            return Ok(candidate);
        }
    }

    // 2. Check standard Android app lib paths
    for base in [
        "/data/data/com.audioconverter.app/lib",
        "/data/user/0/com.audioconverter.app/lib",
    ] {
        let candidate = PathBuf::from(base).join(&so_name);
        checked.push(candidate.display().to_string());
        if candidate.exists() {
            crate::log_info!("Android locate {name}: FOUND at {}", candidate.display());
            return Ok(candidate);
        }
    }

    // 3. Check next to running executable if available
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(&so_name);
            checked.push(candidate.display().to_string());
            if candidate.exists() {
                crate::log_info!("Android locate {name}: FOUND next to exe at {}", candidate.display());
                return Ok(candidate);
            }
        }
    }

    crate::log_error!(
        "Android locate {name} FAILED! None of the candidates exist: {:?}",
        checked
    );

    Err(crate::error::AppError::NotFound(format!(
        "Bundled {name} binary (searched {so_name} in {checked:?}) is missing"
    )))
}

#[cfg(not(target_os = "android"))]
fn locate_desktop(name: &str) -> Result<PathBuf, crate::error::AppError> {
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
        let p = locate("ffmpeg").expect("override should resolve");
        assert_eq!(p, PathBuf::from(env!("CARGO_MANIFEST_DIR")));

        // Point at non-existent path
        std::env::set_var("FFMPEG_PATH", "/does/not/exist/ffmpeg_dummy");
        assert!(locate("ffmpeg").is_err());

        std::env::remove_var("FFMPEG_PATH");
    }
}
