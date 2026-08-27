import type { AudioFormat, ConversionOptions, InputFile } from "../types";
import { isLossy } from "../types";

/**
 * Effective bitrate (kbps) used for size estimation.
 * Mirrors the Rust-side presets; lossless uses typical rates
 * (WAV = 16-bit stereo @ chosen rate ≈ 1411k, FLAC ≈ 60% of WAV).
 */
export function estimateKbps(
  format: AudioFormat,
  options: Pick<ConversionOptions, "quality" | "customBitrateKbps">,
): number {
  const q = options.quality;
  const custom = options.customBitrateKbps;
  switch (format) {
    case "wav":
      return 1411;
    case "flac":
      return 900;
    case "mp3":
      return q === "custom" ? custom ?? 192 : { low: 96, medium: 192, high: 256, very_high: 320 }[q] ?? 192;
    default: // aac / m4a / opus
      return q === "custom" ? custom ?? 128 : { low: 64, medium: 128, high: 192, very_high: 256 }[q] ?? 128;
  }
}

/**
 * Duration actually encoded for one file: honors its optional trim window,
 * clamped to the file duration — mirrors the backend's post-trim planning.
 */
function effectiveDuration(file: InputFile): number {
  const start =
    file.trimStartSecs != null ? Math.min(Math.max(0, file.trimStartSecs), file.durationSecs) : 0;
  const end =
    file.trimEndSecs != null && file.trimEndSecs > 0
      ? Math.min(file.trimEndSecs, file.durationSecs)
      : file.durationSecs;
  return Math.max(0, end - start);
}

/** Total estimated output size in bytes across all valid files, or null. */
export function estimateOutputBytes(
  files: InputFile[],
  format: AudioFormat,
  options: Pick<ConversionOptions, "quality" | "customBitrateKbps">,
): number | null {
  const usable = files.filter((f) => !f.error && f.hasAudio);
  const duration = usable.reduce((acc, f) => acc + effectiveDuration(f), 0);
  if (duration <= 0) return null;
  const kbps = estimateKbps(format, options);
  return Math.round((kbps * 1000) / 8 * duration);
}

/** Human "+x%" / "-y%" delta vs total source size, when comparable. */
export function growthHint(
  files: InputFile[],
  estimatedBytes: number | null,
): string | null {
  if (estimatedBytes === null) return null;
  const source = files.reduce((acc, f) => acc + f.sizeBytes, 0);
  if (source <= 0) return null;
  const pct = Math.round(((estimatedBytes - source) / source) * 100);
  if (Math.abs(pct) < 1) return "±0%";
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

// Re-export so callers don't need two imports for one check.
export { isLossy };
