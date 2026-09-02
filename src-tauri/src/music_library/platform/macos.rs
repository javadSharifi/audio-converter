use std::path::PathBuf;

pub fn get_music_directories() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home_path = PathBuf::from(home);
            for sub in &["Music", "Downloads", "Desktop", "Documents"] {
                let candidate = home_path.join(sub);
                if candidate.is_dir() {
                    dirs.push(candidate);
                }
            }
        }
    }

    dirs
}
