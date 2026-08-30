use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::types::ConversionOptions;

static RESERVED: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

pub fn clear_reserved_paths() {
    let mut guard = RESERVED.lock().unwrap();
    if let Some(set) = guard.as_mut() {
        set.clear();
    }
}

const WINDOWS_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Remove characters illegal in a single path component on any platform,
/// while preserving Unicode (e.g. Persian filenames stay intact) and protecting
/// against Windows reserved device names (CON, NUL, AUX, etc.).
pub fn sanitize_component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| {
            !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control()
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    if trimmed.is_empty() {
        "output".to_string()
    } else if WINDOWS_RESERVED.contains(&trimmed.to_uppercase().as_str()) {
        format!("{trimmed}_audio")
    } else {
        trimmed.to_string()
    }
}

/// Return a non-colliding path: appends `(1)`, `(2)`, … before the extension.
/// Thread-safe and atomic across concurrent workers.
pub fn unique_path(target: &Path) -> PathBuf {
    let mut guard = RESERVED.lock().unwrap();
    let reserved = guard.get_or_insert_with(HashSet::new);
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let stem = target
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = target
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();

    if !target.exists() && !reserved.contains(target) {
        reserved.insert(target.to_path_buf());
        return target.to_path_buf();
    }

    for n in 1..10_000u32 {
        let candidate = parent.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() && !reserved.contains(&candidate) {
            reserved.insert(candidate.clone());
            return candidate;
        }
    }
    let fallback = parent.join(format!(
        "{stem}-{}.{}",
        std::process::id(),
        ext.trim_start_matches('.')
    ));
    reserved.insert(fallback.clone());
    fallback
}

/// Decide the final directory for outputs of `source`.
pub fn output_directory(
    source: &Path,
    options: &ConversionOptions,
    multiple_sources: bool,
) -> PathBuf {
    let parent = source
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    let stem = sanitize_component(
        &source
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "output".into()),
    );

    // Android: sources are always staged in app-private cache, so "next to
    // the source" would hide outputs from the user. All modes resolve into
    // the internal converted root, which is published to the shared
    // Music/AudioConverter media collection after each job succeeds. SAF
    // content:// folder picks are not writable via plain file paths, so
    // CustomFolder degrades to the shared root with a log note.
    #[cfg(target_os = "android")]
    if let Some(root) = crate::android_fs::output_root() {
        return match options.output_mode {
            crate::types::OutputMode::PerSourceFolder => root.join(&stem),
            _ => {
                if matches!(options.output_mode, crate::types::OutputMode::CustomFolder) {
                    crate::log_warn!(
                        "Android: custom output folder ignored, writing to {}",
                        root.display()
                    );
                }
                root
            }
        };
    }

    match options.output_mode {
        crate::types::OutputMode::SameAsSource => parent,
        crate::types::OutputMode::CustomFolder => {
            let root = PathBuf::from(
                options
                    .custom_output_dir
                    .clone()
                    .unwrap_or_else(|| ".".into()),
            );
            if multiple_sources {
                root.join(&stem)
            } else {
                root
            }
        }
        crate::types::OutputMode::PerSourceFolder => parent.join(&stem),
    }
}

/// Final output paths for one source producing `part_count` files.
/// Names follow `{stem}_part_01.{ext}` when splitting into several parts,
/// otherwise just `{stem}.{ext}`.
pub fn build_output_paths(
    source: &Path,
    options: &ConversionOptions,
    part_count: usize,
    multiple_sources: bool,
) -> Vec<PathBuf> {
    let dir = output_directory(source, options, multiple_sources);
    let stem = sanitize_component(
        &source
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "output".into()),
    );
    let ext = options.format.extension();

    let names: Vec<String> = if part_count > 1 {
        (1..=part_count)
            .map(|i| format!("{stem}_part_{:02}.{ext}", i))
            .collect()
    } else {
        vec![format!("{stem}.{ext}")]
    };

    names
        .into_iter()
        .map(|n| unique_path(&dir.join(n)))
        .collect()
}

/// Delete leftover `.part` temp files from crashed/killed runs inside `dirs`.
///
/// Only names matching this app's exact temp pattern are removed —
/// `<stem>.job-<digits>-<digits>.part` or `<stem>.job-<digits>-<digits>.part.<ext>`
/// — so unrelated user files (even `movie.part.mp3`) are never touched.
pub fn sweep_orphan_temps(dirs: &[PathBuf]) {
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_app_temp_name(&name) {
                crate::log_info!("sweeping orphan temp: {}", entry.path().display());
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

/// Match `{stem}.job-{ts}-{seq}.part[.{ext}]` (the name produced by the
/// pipeline's temp-file staging).
fn is_app_temp_name(name: &str) -> bool {
    let Some((stem, tail)) = name.rsplit_once(".part") else {
        return false;
    };
    // Tail must be empty (`*.part`) or a plain extension (`*.part.mp3`).
    if !tail.is_empty() && !(tail.starts_with('.') && !tail.contains(['\\', '/'])) {
        return false;
    }
    let Some((prefix, job_id)) = stem.rsplit_once(".job-") else {
        return false;
    };
    if prefix.is_empty() {
        return false;
    }
    let Some((ts, seq)) = job_id.split_once('-') else {
        return false;
    };
    !ts.is_empty()
        && ts.bytes().all(|b| b.is_ascii_digit())
        && !seq.is_empty()
        && seq.bytes().all(|b| b.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::OutputMode;

    fn opts(mode: OutputMode, dir: Option<&str>) -> ConversionOptions {
        ConversionOptions {
            output_mode: mode,
            custom_output_dir: dir.map(String::from),
            ..Default::default()
        }
    }

    #[test]
    fn sanitizes_but_keeps_unicode() {
        assert_eq!(sanitize_component("جلسه اول"), "جلسه اول");
        assert_eq!(sanitize_component("bad:name*here?"), "badnamehere");
        assert_eq!(sanitize_component("  "), "output");
        assert_eq!(sanitize_component("trailing."), "trailing");
        assert_eq!(sanitize_component("CON"), "CON_audio");
        assert_eq!(sanitize_component("nul"), "nul_audio");
    }

    #[test]
    fn collision_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("ac-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("song.mp3");
        std::fs::write(&target, b"x").unwrap();
        let u1 = unique_path(&target);
        assert_eq!(u1.file_name().unwrap(), "song (1).mp3");
        std::fs::write(&u1, b"x").unwrap();
        let u2 = unique_path(&target);
        assert_eq!(u2.file_name().unwrap(), "song (2).mp3");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn part_names_and_single_output_name() {
        let src = Path::new("/tmp/Movie_A.mp4");
        let o = opts(OutputMode::SameAsSource, None);
        let paths = build_output_paths(src, &o, 3, false);
        assert_eq!(paths.len(), 3);
        assert!(paths[0].ends_with("Movie_A_part_01.mp3"));
        assert!(paths[2].ends_with("Movie_A_part_03.mp3"));
        let single = build_output_paths(src, &o, 1, false);
        assert!(single[0].ends_with("Movie_A.mp3"));
    }

    #[test]
    fn multi_source_custom_folder_uses_subfolder() {
        let src = Path::new("/tmp/Movie_B.mkv");
        let o = opts(OutputMode::CustomFolder, Some("/out"));
        let p = build_output_paths(src, &o, 1, true);
        assert!(p[0].starts_with("/out/Movie_B"));
    }

    #[test]
    fn app_temp_name_detection() {
        assert!(is_app_temp_name("song.job-1730000000000-0.part.mp3"));
        assert!(is_app_temp_name("song.job-1730000000000-0.part"));
        assert!(is_app_temp_name("جلسه اول.job-1730000000000-12.part.opus"));
        assert!(!is_app_temp_name("song.mp3"));
        assert!(!is_app_temp_name("song.part.mp3"));
        assert!(!is_app_temp_name("job-1730000000000-0.part.mp3"));
        assert!(!is_app_temp_name("song.job-abc-0.part.mp3"));
        assert!(!is_app_temp_name("song.job-1730000000000-.part.mp3"));
        assert!(!is_app_temp_name("song.job-1730000000000-0.party"));
    }

    #[test]
    fn sweep_removes_only_orphan_temps() {
        let dir = std::env::temp_dir().join(format!("ac-sweep-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let keep = dir.join("song.mp3");
        let lookalike = dir.join("movie.part.mp3");
        let orphan = dir.join("song.job-1730000000000-0.part.mp3");
        for f in [&keep, &lookalike, &orphan] {
            std::fs::write(f, b"x").unwrap();
        }
        sweep_orphan_temps(&[dir.clone()]);
        assert!(keep.exists());
        assert!(lookalike.exists());
        assert!(!orphan.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
