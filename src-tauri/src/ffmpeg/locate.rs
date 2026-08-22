use std::path::PathBuf;

/// Locate a bundled helper binary (ffmpeg / ffprobe).
///
/// Resolution order:
/// 1. `FFMPEG_PATH` / `FFPROBE_PATH` env override (tests, debugging)
/// 2. Next to the running executable — this is where Tauri places
///    `externalBin` sidecars in both dev and bundled apps.
/// 3. Bare name from `PATH` (dev convenience only; never relied on in prod).
pub fn locate(name: &str) -> Result<PathBuf, crate::error::AppError> {
    let env_key = if name == "ffmpeg" { "FFMPEG_PATH" } else { "FFPROBE_PATH" };
    if let Ok(p) = std::env::var(env_key) {
        let path = PathBuf::from(&p);
        if path.exists() {
            return Ok(path);
        }
        return Err(crate::error::AppError::NotFound(format!(
            "{name} not found at {p} (from {env_key})"
        )));
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
            let candidate = PathBuf::from(&cargo_dir).join(rel).join(format!("{name}.exe"));
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
