/// Parse FFmpeg's `-progress pipe:1` structured key=value stream.
/// This avoids fragile regex parsing of human-readable stderr.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ProgressSnapshot {
    /// Microseconds of output produced so far.
    pub out_time_us: Option<u64>,
    /// e.g. "1.53x"
    pub speed: Option<String>,
    pub fps: Option<String>,
    pub total_size: Option<u64>,
    /// 1 when the run finished.
    pub progress_end: bool,
}

/// Apply a single `key=value` line to the snapshot.
pub fn apply_line(snapshot: &mut ProgressSnapshot, line: &str) {
    let Some((key, value)) = line.split_once('=') else {
        return;
    };
    let value = value.trim();
    match key.trim() {
        "out_time_us" | "out_time_µs" => snapshot.out_time_us = value.parse().ok(),
        // Older builds emit milliseconds.
        "out_time_ms" => {
            if let Ok(ms) = value.parse::<u64>() {
                // ffmpeg's out_time_ms is actually microseconds (historical bug).
                snapshot.out_time_us = Some(ms);
            }
        }
        "speed" => snapshot.speed = Some(value.to_string()),
        "fps" => snapshot.fps = Some(value.to_string()),
        "total_size" => snapshot.total_size = value.parse().ok(),
        "progress" if value == "end" => snapshot.progress_end = true,
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_standard_progress_stream() {
        let input = "\
frame=12
out_time_ms=1530000
speed=1.53x
total_size=48123
progress=continue";
        let mut snap = ProgressSnapshot::default();
        for line in input.lines() {
            apply_line(&mut snap, line);
        }
        assert_eq!(snap.out_time_us, Some(1_530_000));
        assert_eq!(snap.speed.as_deref(), Some("1.53x"));
        assert_eq!(snap.total_size, Some(48123));
        assert!(!snap.progress_end);
    }

    #[test]
    fn detects_end_marker() {
        let mut snap = ProgressSnapshot::default();
        apply_line(&mut snap, "progress=end");
        assert!(snap.progress_end);
    }

    #[test]
    fn ignores_garbage_lines() {
        let mut snap = ProgressSnapshot::default();
        apply_line(&mut snap, "not-a-pair");
        apply_line(&mut snap, "out_time_us=notanumber");
        assert_eq!(snap, ProgressSnapshot::default());
    }
}
