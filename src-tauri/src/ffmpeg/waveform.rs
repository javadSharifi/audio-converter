//! Audio waveform peak extraction for the trim editor.
//!
//! Decodes the source's FIRST audio stream to mono 16 kHz via the bundled
//! FFmpeg (`-ac 1 -ar 16000 -f s16le`), then buckets raw samples into
//! `buckets` peak pairs (min/max) so the frontend can draw a real waveform
//! with zero extra dependencies. The bundled binary is reused — nothing new
//! ships in the app bundle (the <20MB budget stays intact).

/// Decode rate for waveform extraction: 16 kHz mono is ample resolution for
/// a visual aid and keeps the PCM buffer small (~2 MB per minute).
const DECODE_RATE: u32 = 16_000;

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
pub fn extract_peaks(
    ffmpeg: &std::path::Path,
    path: &str,
    buckets: usize,
) -> Result<Vec<(f32, f32)>, crate::error::AppError> {
    use crate::error::AppError;
    use std::io::Read;

    if !std::path::Path::new(path).exists() {
        return Err(AppError::NotFound(format!("File does not exist: {path}")));
    }

    let mut child = std::process::Command::new(ffmpeg)
        .args([
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
            "--",
            "pipe:1",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Io(format!("Failed to launch ffmpeg: {e}")))?;

    // Read entire audio stream (capped at a generous safety limit of 4 hours ~460MB)
    const MAX_SAFETY_BYTES: usize = 2 * DECODE_RATE as usize * 14_400; // 4 hours
    let mut pcm: Vec<u8> = Vec::new();
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Io("ffmpeg stdout unavailable".into()))?;
    let mut buf = [0u8; 65_536];
    loop {
        match stdout.read(&mut buf) {
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
                return Err(AppError::Io(format!("Failed reading waveform data: {e}")));
            }
        }
    }

    let stderr = {
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Io("ffmpeg stderr unavailable".into()))?;
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = stderr.read_to_end(&mut buf);
            buf
        })
    };

    let output = child
        .wait()
        .map_err(|e| AppError::Io(format!("ffmpeg wait failed: {e}")))?;
    let stderr_bytes = stderr.join().unwrap_or_default();
    let stderr = String::from_utf8_lossy(&stderr_bytes);
    if !output.success() && pcm.is_empty() {
        return Err(AppError::FFmpeg(format!(
            "Waveform extraction failed: {}",
            stderr.trim()
        )));
    }

    Ok(bucket_peaks(&pcm, buckets))
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
}
