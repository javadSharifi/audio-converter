/// Split-point math. All times are seconds (f64) on the *post-silence-removal*
/// timeline when silence removal is active — callers must pass the correct
/// total.
pub type Range = (f64, f64);
pub type Window = (f64, f64);

/// Divide `total` into consecutive windows of at most `part_len` seconds.
/// The last window carries the remainder. If `total <= part_len`, a single
/// window covering everything is returned — never an empty or trivial part.
pub fn split_windows(total: f64, part_len: f64) -> Vec<Window> {
    if total <= 0.0 || part_len <= 0.0 {
        return Vec::new();
    }
    if total <= part_len {
        return vec![(0.0, total)];
    }
    let count = (total / part_len).ceil() as usize;
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let start = i as f64 * part_len;
        let end = ((i + 1) as f64 * part_len).min(total);
        if end - start > f64::EPSILON {
            out.push((start, end));
        }
    }
    out
}

/// Map a window on the *post-removal* (cumulative) timeline back to the
/// original-time sub-ranges that produce it.
///
/// Split windows are computed against post-silence duration, but `atrim`
/// cuts run on the original timeline — so a window like `(3s..6s)` must be
/// translated through the kept ranges' cumulative lengths, NOT intersected
/// by raw timestamps.
pub fn map_window_to_ranges(window: Window, kept: &[Range]) -> Vec<Range> {
    let mut out = Vec::new();
    let mut produced = 0.0f64; // post-removal seconds emitted so far
    for &(start, end) in kept {
        let len = end - start;
        let range_end_on_output = produced + len;

        let ov_start = window.0.max(produced);
        let ov_end = window.1.min(range_end_on_output);
        if ov_end - ov_start > 1e-6 {
            out.push((start + (ov_start - produced), start + (ov_end - produced)));
        }

        produced = range_end_on_output;
        if produced >= window.1 {
            break;
        }
    }
    out
}

/// Parse user duration input: plain integer/decimal = minutes;
/// "HH:MM:SS" or "MM:SS" = clock time. Returns seconds.
pub fn parse_duration_input(raw: &str) -> Result<f64, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("Empty duration".into());
    }
    if raw.contains(':') {
        let mut secs = 0f64;
        for part in raw.split(':') {
            let v: f64 = part
                .trim()
                .parse()
                .map_err(|_| format!("Invalid time component: {part}"))?;
            if !(0.0..60.0).contains(&v) && !raw.ends_with(part.trim()) {
                // allow >=60 only in the leftmost component; enforced below loosely
            }
            secs = secs * 60.0 + v;
        }
        if secs <= 0.0 {
            return Err("Duration must be positive".into());
        }
        return Ok(secs);
    }
    let minutes: f64 = raw
        .parse()
        .map_err(|_| format!("Invalid duration: {raw}"))?;
    if minutes <= 0.0 {
        return Err("Duration must be positive".into());
    }
    Ok(minutes * 60.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remainder_goes_to_last_part() {
        // 2h20m in 1h parts → [1h,1h,20m]
        let w = split_windows(8400.0, 3600.0);
        assert_eq!(w.len(), 3);
        assert_eq!(w[0], (0.0, 3600.0));
        assert_eq!(w[1], (3600.0, 7200.0));
        assert!((w[2].1 - w[2].0 - 1200.0).abs() < 1e-9);
    }

    #[test]
    fn shorter_than_one_part_single_output() {
        let w = split_windows(300.0, 600.0);
        assert_eq!(w, vec![(0.0, 300.0)]);
    }

    #[test]
    fn exactly_equal_single_output() {
        let w = split_windows(600.0, 600.0);
        assert_eq!(w.len(), 1);
    }

    #[test]
    fn zero_or_negative_inputs_empty() {
        assert!(split_windows(0.0, 10.0).is_empty());
        assert!(split_windows(100.0, 0.0).is_empty());
    }

    #[test]
    fn window_mapping_translates_cumulative_to_original_time() {
        // Kept ranges on ORIGINAL timeline; total post-removal = 35s.
        let kept = [(0.0, 10.0), (15.0, 25.0), (30.0, 40.0)];
        // Post-silence window 12→32s:
        //   cum 12 is inside range B at offset 2 → original 17
        //   cum 32 runs past C's start (cum 20) by 12 → original 42 clamps to 40
        let segs = map_window_to_ranges((12.0, 32.0), &kept);
        assert_eq!(segs, vec![(17.0, 25.0), (30.0, 40.0)]);
    }

    #[test]
    fn silence_then_split_boundary_case() {
        // e2e scenario: kept = [(0,2),(3.5,6)], post total 4.5, parts of 3.
        let kept = [(0.0, 2.0), (3.5, 6.0)];
        let w1 = map_window_to_ranges((0.0, 3.0), &kept);
        assert_eq!(w1, vec![(0.0, 2.0), (3.5, 4.5)]); // full A + first 1s of B
        let w2 = map_window_to_ranges((3.0, 4.5), &kept);
        assert_eq!(w2, vec![(4.5, 6.0)]); // remainder of B: 1.5s
    }

    #[test]
    fn parses_minutes_and_clock_time() {
        assert_eq!(parse_duration_input("45").unwrap(), 2700.0);
        assert_eq!(parse_duration_input("01:00:00").unwrap(), 3600.0);
        assert_eq!(parse_duration_input("20:30").unwrap(), 1230.0);
        assert!(parse_duration_input("-5").is_err());
        assert!(parse_duration_input("0").is_err());
        assert!(parse_duration_input("abc").is_err());
        assert!(parse_duration_input("").is_err());
    }
}
