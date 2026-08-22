/// Silence handling: detection via FFmpeg `silencedetect`, removal by
/// segment-and-concat (`atrim` + `concat`) rather than the `silenceremove`
/// filter. Rationale: silenceremove's window/threshold behaviour differs
/// across FFmpeg versions and can clip speech onsets, while explicit
/// atrim ranges are deterministic and let us compute exact post-removal
/// duration for correct split boundaries.
pub type Range = (f64, f64);

/// Parse `silencedetect` stderr output into silence ranges.
/// Lines look like:
///   [silencedetect @ 0x...] silence_start: 12.345
///   [silencedetect @ 0x...] silence_end: 14.567 | silence_duration: 2.222
pub fn parse_silencedetect(stderr: &str) -> Vec<Range> {
    // Pair each start with the next end in emission order.
    let mut events: Vec<(bool, f64)> = Vec::new();
    for line in stderr.lines() {
        if let Some(idx) = line.find("silence_start:") {
            let v = line[idx + "silence_start:".len()..].trim();
            if let Ok(t) = v.parse::<f64>() {
                events.push((true, t));
            }
        } else if let Some(idx) = line.find("silence_end:") {
            let rest = &line[idx + "silence_end:".len()..];
            let v = rest.split('|').next().unwrap_or("").trim();
            if let Ok(t) = v.parse::<f64>() {
                events.push((false, t));
            }
        }
    }
    pair_events(events)
}

fn pair_events(events: Vec<(bool, f64)>) -> Vec<Range> {
    let mut out = Vec::new();
    let mut open: Option<f64> = None;
    for (is_start, t) in events {
        if is_start {
            if open.is_none() {
                open = Some(t.max(0.0));
            }
        } else if let Some(s) = open.take() {
            if t > s {
                out.push((s, t));
            }
        }
    }
    out
}

/// Complement of `silences` within `[0, total]`, merged when the gap between
/// kept segments is below `merge_gap` seconds (avoids pathological filter
/// graphs full of micro-segments around borderline detections).
pub fn kept_ranges(total: f64, mut silences: Vec<Range>, merge_gap: f64) -> Vec<Range> {
    silences.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    silences.retain(|&(s, e)| e > 0.0 && s < total);
    for s in silences.iter_mut() {
        s.0 = s.0.clamp(0.0, total);
        s.1 = s.1.clamp(0.0, total);
    }

    let mut kept: Vec<Range> = Vec::new();
    let mut cursor = 0.0f64;
    for &(ss, se) in &silences {
        if ss - cursor > merge_gap {
            kept.push((cursor, ss));
        }
        cursor = cursor.max(se);
    }
    if total - cursor > merge_gap {
        kept.push((cursor, total));
    }
    kept
}

/// Total duration after removing silence.
pub fn total_kept(kept: &[Range]) -> f64 {
    kept.iter().map(|(s, e)| e - s).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
[silencedetect @ 0x7f8] silence_start: 10
[silencedetect @ 0x7f8] silence_end: 13.5 | silence_duration: 3.5
[silencedetect @ 0x7f8] silence_start: 40.2
[silencedetect @ 0x7f8] silence_end: 42.7 | silence_duration: 2.5
";

    #[test]
    fn parses_detection_lines() {
        let s = parse_silencedetect(SAMPLE);
        assert_eq!(s, vec![(10.0, 13.5), (40.2, 42.7)]);
    }

    #[test]
    fn handles_unterminated_silence_at_eof() {
        let s = parse_silencedetect("[silencedetect @ x] silence_start: 5\n");
        assert!(s.is_empty()); // no end → cannot cut reliably; caller falls back to full range trim
    }

    #[test]
    fn complement_and_merge() {
        let kept = kept_ranges(60.0, vec![(10.0, 20.0), (30.0, 35.0)], 0.05);
        assert_eq!(kept, vec![(0.0, 10.0), (20.0, 30.0), (35.0, 60.0)]);
        assert_eq!(total_kept(&kept), 45.0);
    }

    #[test]
    fn tiny_gaps_between_speech_get_merged_away_only_below_threshold() {
        // Silence removes 10..12; gap 12..12.02 (< merge gap) merges neighbors.
        let kept = kept_ranges(30.0, vec![(10.0, 11.98)], 0.05);
        assert_eq!(kept, vec![(0.0, 10.0), (11.98, 30.0)]);
    }

    #[test]
    fn entire_file_silent_yields_empty_kept() {
        let kept = kept_ranges(100.0, vec![(0.0, 100.0)], 0.05);
        assert!(kept.is_empty());
        assert_eq!(total_kept(&kept), 0.0);
    }

    #[test]
    fn clamps_out_of_bounds() {
        let kept = kept_ranges(50.0, vec![(-5.0, 10.0), (45.0, 80.0)], 0.05);
        assert_eq!(kept, vec![(10.0, 45.0)]);
    }
}
