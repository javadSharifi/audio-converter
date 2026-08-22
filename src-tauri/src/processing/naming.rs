use std::path::{Path, PathBuf};

use crate::types::ConversionOptions;

/// Remove characters illegal in a single path component on any platform,
/// while preserving Unicode (e.g. Persian filenames stay intact).
pub fn sanitize_component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| {
            !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
                && !c.is_control()
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    if trimmed.is_empty() {
        "output".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Return a non-colliding path: appends `(1)`, `(2)`, … before the extension.
/// Never silently overwrites an existing file.
pub fn unique_path(target: &Path) -> PathBuf {
    if !target.exists() {
        return target.to_path_buf();
    }
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let stem = target
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = target
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    for n in 1..10_000u32 {
        let candidate = parent.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    // Practically unreachable; deterministic last resort.
    parent.join(format!("{stem}-{}.{}", std::process::id(), ext.trim_start_matches('.')))
}

/// Decide the final directory for outputs of `source`.
pub fn output_directory(source: &Path, options: &ConversionOptions, multiple_sources: bool) -> PathBuf {
    let parent = source.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();
    let stem = sanitize_component(&
        source
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "output".into()),
    );
    match options.output_mode {
        crate::types::OutputMode::SameAsSource => parent,
        crate::types::OutputMode::CustomFolder => {
            let root = PathBuf::from(options.custom_output_dir.clone().unwrap_or_else(|| ".".into()));
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
    let stem = sanitize_component(&
        source
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
}
