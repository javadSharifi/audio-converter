use std::path::PathBuf;

#[allow(unused_mut)]
pub fn get_music_directories() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // Try Win32 KnownFolders if available, otherwise USERPROFILE
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let p = PathBuf::from(profile);
            for sub in &["Music", "Downloads", "Desktop", "Documents"] {
                let candidate = p.join(sub);
                if candidate.is_dir() {
                    dirs.push(candidate);
                }
            }
        }
    }

    dirs
}
