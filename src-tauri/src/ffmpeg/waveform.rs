//! Audio waveform peak extraction for the trim editor.
//!
//! Decodes the source's FIRST audio stream to mono 16 kHz via the bundled
//! FFmpeg (`-ac 1 -ar 16000 -f s16le`), then buckets raw samples into
//! `buckets` peak pairs (min/max) so the frontend can draw a real waveform
//! with zero extra dependencies. The bundled binary is reused — nothing new
//! ships in the app bundle (the <20MB budget stays intact).

/// Decode rate for waveform extraction: 16 kHz mono is ample resolution for
/// a visual aid and keeps the PCM stream small (~2 MB per minute).
const DECODE_RATE: u32 = 16_000;

/// Hard decode cap (seconds) when the real duration is known. Streaming
/// bucketing means this costs CPU only — never memory — but a 4-hour bound
/// keeps absurd inputs (24h radio rips) from burning battery.
const MAX_DECODE_SECS: f64 = 4.0 * 3600.0;

/// Memory-bounded fallback cap (bytes of s16le PCM ≈ 5 min) for the rare
/// case where probing failed and no duration hint is available.
const FALLBACK_CAP_BYTES: usize = 2 * DECODE_RATE as usize * 300;

/// Incremental min/max bucketing over a raw s16le PCM stream.
///
/// Replaces the old "buffer up to N MB then bucket" approach: memory is
/// O(buckets) instead of O(audio), so long files no longer spike RAM
/// (critical on mobile) and bucket boundaries stay aligned to the file's
/// real duration instead of the buffer cap.
///
/// Handles odd-byte chunk boundaries via a 1-byte leftover; unit-testable
/// without spawning FFmpeg.
pub struct StreamingBucketer {
    buckets: usize,
    per_bucket: usize,
    samples_seen: usize,
    mins: Vec<i16>,
    maxs: Vec<i16>,
    leftover: Option<u8>,
}

impl StreamingBucketer {
    /// `expected_samples` is the duration-derived upper bound; it only sets
    /// the bucket width, so being slightly off is harmless.
    pub fn new(buckets: usize, expected_samples: usize) -> Self {
        let buckets = buckets.max(1);
        let per_bucket = (expected_samples / buckets).max(1);
        Self {
            buckets,
            per_bucket,
            samples_seen: 0,
            mins: vec![i16::MAX; buckets],
            maxs: vec![i16::MIN; buckets],
            leftover: None,
        }
    }

    pub fn push_bytes(&mut self, chunk: &[u8]) {
        // Reassemble samples across chunk boundaries: leftover byte first.
        let mut bytes: Vec<u8> = Vec::with_capacity(chunk.len() + 1);
        if let Some(b) = self.leftover.take() {
            bytes.push(b);
        }
        bytes.extend_from_slice(chunk);
        let pairs = bytes.len() / 2;
        self.leftover = (bytes.len() % 2 == 1).then(|| bytes[bytes.len() - 1]);

        for si in 0..pairs {
            let v = i16::from_le_bytes([bytes[si * 2], bytes[si * 2 + 1]]);
            let idx = (self.samples_seen / self.per_bucket).min(self.buckets - 1);
            self.mins[idx] = self.mins[idx].min(v);
            self.maxs[idx] = self.maxs[idx].max(v);
            self.samples_seen += 1;
        }
    }

    pub fn has_samples(&self) -> bool {
        self.samples_seen > 0
    }

    /// Sentinel buckets (no samples seen) inherit the previous bucket's
    /// values so a duration overestimate never renders a flat silent tail.
    pub fn finish(self) -> Vec<(f32, f32)> {
        let mut out = Vec::with_capacity(self.buckets);
        let mut carry: Option<(f32, f32)> = None;
        for i in 0..self.buckets {
            let value = if self.mins[i] == i16::MAX && self.maxs[i] == i16::MIN {
                carry.unwrap_or((0.0, 0.0))
            } else {
                let v = (
                    self.mins[i] as f32 / 32768.0,
                    self.maxs[i] as f32 / 32768.0,
                );
                carry = Some(v);
                v
            };
            out.push(value);
        }
        out
    }
}

/// Bucket PCM samples into interleaved min/max peaks.
///
/// Pure function over raw little-endian i16 bytes; unit-testable without
/// spawning FFmpeg. Returns exactly `buckets` pairs (silent zeros when the
/// input is shorter than the requested resolution).
pub fn bucket_peaks(pcm: &[u8], buckets: usize) -> Vec<(f32, f32)> {
    let mut peaks = vec![(0.0f32, 0.0f32); buckets.max(1)];
    if pcm.len() < 2 || buckets == 0 {
        return peaks;
    }
    // Chunks of 2 bytes; a trailing odd byte is ignored.
    let total_samples = pcm.len() / 2;
    let per_bucket = (total_samples / buckets).max(1);

    for (bi, peak) in peaks.iter_mut().enumerate() {
        let lo = bi * per_bucket;
        let hi = if bi == buckets - 1 {
            total_samples
        } else {
            ((bi + 1) * per_bucket).min(total_samples)
        };
        if lo >= hi {
            continue;
        }
        let mut min = i16::MAX;
        let mut max = i16::MIN;
        for sample_idx in lo..hi {
            let byte = sample_idx * 2;
            let v = i16::from_le_bytes([pcm[byte], pcm[byte + 1]]);
            min = min.min(v);
            max = max.max(v);
        }
        *peak = (min as f32 / 32768.0, max as f32 / 32768.0);
    }
    peaks
}

/// Decode-and-bucket for one media file using the given ffmpeg binary.
/// Only the first audio stream is decoded (`0:a:0`), downmixed to mono.
///
/// With a `duration_hint` (from ffprobe) the peak extraction STREAMS: no
/// PCM buffer is allocated at all and buckets align with the full file
/// duration. Without a hint it falls back to a memory-capped buffered read.
pub fn extract_peaks(
    ffmpeg: &std::path::Path,
    path: &str,
    buckets: usize,
    duration_hint: Option<f64>,
) -> Result<Vec<(f32, f32)>, crate::error::AppError> {
    use crate::error::AppError;
    use std::io::Read;

    if !std::path::Path::new(path).exists() {
        return Err(AppError::NotFound(format!("File does not exist: {path}")));
    }

    let mut args: Vec<String> = [
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        path,
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        &DECODE_RATE.to_string(),
        "-f",
        "s16le",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let expected_samples: Option<usize> = duration_hint.map(|d| {
        let cap_secs = d.min(MAX_DECODE_SECS);
        args.push("-t".into());
        args.push(format!("{cap_secs:.3}"));
        (cap_secs * DECODE_RATE as f64) as usize
    });

    args.extend(["--".to_string(), "pipe:1".to_string()]);

    let mut child = crate::ffmpeg::create_hidden_command(ffmpeg)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Io(format!("Failed to launch ffmpeg: {e}")))?;

    // Drain stderr CONCURRENTLY with stdout from the very start. If ffmpeg
    // floods stderr (corrupt input → thousands of error lines) while only
    // stdout is being read, the stderr pipe buffer fills and ffmpeg blocks —
    // stdout never reaches EOF → permanent deadlock.
    let stderr_pipe = child.stderr.take();
    let stderr_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stderr_pipe {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Io("ffmpeg stdout unavailable".into()))?;

    let (peaks, decoded_any) = match expected_samples {
        Some(expected) => {
            // Streaming path: O(buckets) memory, aligned to real duration.
            let mut bucketer = StreamingBucketer::new(buckets, expected);
            let mut reader = std::io::BufReader::with_capacity(128 * 1024, stdout);
            let mut buf = [0u8; 65_536];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => bucketer.push_bytes(&buf[..n]),
                    Err(e) => {
                        let _ = child.kill();
                        return Err(AppError::Io(format!("Failed reading waveform data: {e}")));
                    }
                }
            }
            let any = bucketer.has_samples();
            (bucketer.finish(), any)
        }
        None => {
            // Fallback (no duration): bounded buffer + offline bucketing.
            const MAX_SAFETY_BYTES: usize = FALLBACK_CAP_BYTES;
            let mut pcm: Vec<u8> = Vec::new();
            let mut reader = std::io::BufReader::with_capacity(128 * 1024, stdout);
            let mut buf = [0u8; 65_536];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let take = n.min(MAX_SAFETY_BYTES.saturating_sub(pcm.len()));
                        pcm.extend_from_slice(&buf[..take]);
                        if pcm.len() >= MAX_SAFETY_BYTES {
                            let _ = child.kill();
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = child.kill();
                        return Err(AppError::Io(format!(
                            "Failed reading waveform data: {e}"
                        )));
                    }
                }
            }
            let any = !pcm.is_empty();
            (bucket_peaks(&pcm, buckets), any)
        }
    };

    let output = child
        .wait()
        .map_err(|e| AppError::Io(format!("ffmpeg wait failed: {e}")))?;
    let stderr_bytes = stderr_thread.join().unwrap_or_default();
    let stderr = String::from_utf8_lossy(&stderr_bytes);
    if !output.success() && !decoded_any {
        return Err(AppError::FFmpeg(format!(
            "Waveform extraction failed: {}",
            stderr.trim()
        )));
    }

    Ok(peaks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buckets_are_exact_count_and_normalized() {
        // 100 samples of alternating ±32768 → every bucket spans full range.
        let mut pcm = Vec::new();
        for i in 0..100 {
            let v: i16 = if i % 2 == 0 { 32767 } else { -32768 };
            pcm.extend_from_slice(&v.to_le_bytes());
        }
        let peaks = bucket_peaks(&pcm, 10);
        assert_eq!(peaks.len(), 10);
        for (min, max) in &peaks {
            assert!((max - 0.99997).abs() < 1e-3, "{max}");
            assert!((min + 1.0).abs() < 1e-3, "{min}");
        }
    }

    #[test]
    fn silent_pcm_gives_flat_zero_waveform() {
        let pcm = vec![0u8; 200];
        let peaks = bucket_peaks(&pcm, 8);
        assert_eq!(peaks.len(), 8);
        assert!(peaks.iter().all(|&(mn, mx)| mn == 0.0 && mx == 0.0));
    }

    #[test]
    fn empty_and_tiny_inputs_never_panic() {
        assert_eq!(bucket_peaks(&[], 4).len(), 4);
        assert_eq!(bucket_peaks(&[0x00], 4).len(), 4); // odd byte count
        assert_eq!(bucket_peaks(&[0u8; 6], 100).len(), 100); // more buckets than samples
    }

    #[test]
    fn last_bucket_takes_remainder_samples() {
        // 7 samples across 3 buckets → 2/2/3 split.
        let vals: [i16; 7] = [100, -200, 300, -400, 500, -600, 700];
        let mut pcm = Vec::new();
        for v in vals {
            pcm.extend_from_slice(&v.to_le_bytes());
        }
        let peaks = bucket_peaks(&pcm, 3);
        assert_eq!(peaks[0], (-200.0 / 32768.0, 100.0 / 32768.0));
        assert_eq!(peaks[1], (-400.0 / 32768.0, 300.0 / 32768.0));
        // Remainder bucket holds the last three samples.
        assert_eq!(peaks[2].0, -600.0 / 32768.0);
        assert_eq!(peaks[2].1, 700.0 / 32768.0);
    }

    #[test]
    fn sine_shape_is_visible_in_peaks() {
        // Half-wave ramp up then down: max should track the envelope.
        let mut pcm = Vec::new();
        for i in 0..64 {
            let env = if i < 32 { i } else { 63 - i } as f32 / 31.0;
            let v = (env * 32000.0) as i16;
            pcm.extend_from_slice(&v.to_le_bytes());
        }
        let peaks = bucket_peaks(&pcm, 4);
        let mids: Vec<f32> = peaks.iter().map(|&(_, mx)| mx).collect();
        assert!(mids[0] < mids[1], "rising edge {mids:?}");
        assert!(mids[3] < mids[2], "falling edge {mids:?}");
    }

    #[test]
    fn streaming_matches_offline_bucketing() {
        let mut pcm = Vec::new();
        for i in 0i32..1000 {
            let v: i16 = ((i * 37) % 65536).wrapping_sub(32768) as i16;
            pcm.extend_from_slice(&v.to_le_bytes());
        }
        let offline = bucket_peaks(&pcm, 16);
        let mut streamer = StreamingBucketer::new(16, 1000);
        // Push in odd-sized chunks to exercise boundary handling.
        for chunk in pcm.chunks(7) {
            streamer.push_bytes(chunk);
        }
        assert_eq!(streamer.finish(), offline);
    }

    #[test]
    fn streaming_shorter_than_expected_carries_forward() {
        // 100 real samples but 1000 expected: no sentinel (flat-zero) tail.
        let mut pcm = Vec::new();
        for i in 0..100 {
            pcm.extend_from_slice(&((i as i16) * 300).to_le_bytes());
        }
        let mut streamer = StreamingBucketer::new(10, 1000);
        streamer.push_bytes(&pcm);
        let peaks = streamer.finish();
        assert_eq!(peaks.len(), 10);
        // Last filled bucket must be propagated, not zeroed.
        assert!(peaks[9].1 != 0.0, "sentinel tail was not carried forward");
        // Every trailing bucket equals the last real bucket.
        for window in peaks[6..].windows(2) {
            assert_eq!(window[0], window[1]);
        }
    }

    #[test]
    fn streaming_empty_input_is_flat_zero() {
        let mut streamer = StreamingBucketer::new(5, 1000);
        streamer.push_bytes(&[]);
        assert!(!streamer.has_samples());
        assert!(streamer.finish().iter().all(|&(mn, mx)| mn == 0.0 && mx == 0.0));
    }

    #[test]
    fn streaming_exact_count_and_odd_bytes() {
        let mut pcm = vec![0u8; 10]; // 5 samples
        pcm.push(0xAB); // trailing odd byte must be tolerated
        let mut streamer = StreamingBucketer::new(4, 1000);
        streamer.push_bytes(&pcm);
        assert!(streamer.has_samples());
        assert_eq!(streamer.finish().len(), 4);
    }
}
