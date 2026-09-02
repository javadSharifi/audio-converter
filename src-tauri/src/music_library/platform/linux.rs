use std::path::PathBuf;

#[allow(unused_mut)]
pub fn get_music_directories() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "linux")]
    {
        // 1. Try querying `xdg-user-dir MUSIC`
        if let Ok(output) = std::process::Command::new("xdg-user-dir").arg("MUSIC").output() {
            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let p = PathBuf::from(&path_str);
                if p.is_dir() {
                    dirs.push(p);
                }
            }
        }

        // 2. Try parsing ~/.config/user-dirs.dirs directly
        if let Ok(home) = std::env::var("HOME") {
            let config_file = PathBuf::from(&home).join(".config/user-dirs.dirs");
            if let Ok(content) = std::fs::read_to_string(config_file) {
                for line in content.lines() {
                    if let Some(rest) = line.strip_prefix("XDG_MUSIC_DIR=") {
                        let cleaned = rest.trim_matches('"').replace("$HOME", &home);
                        let p = PathBuf::from(cleaned);
                        if p.is_dir() && !dirs.contains(&p) {
                            dirs.push(p);
                        }
                    }
                }
            }

            // 3. Fallback to ~/Music, ~/Downloads, ~/Desktop
            for sub in &["Music", "Downloads", "Desktop"] {
                let candidate = PathBuf::from(&home).join(sub);
                if candidate.is_dir() && !dirs.contains(&candidate) {
                    dirs.push(candidate);
                }
            }
        }
    }

    dirs
}
