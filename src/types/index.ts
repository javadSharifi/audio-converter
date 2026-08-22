export type AudioFormat = "mp3" | "wav" | "aac" | "m4a" | "flac" | "opus";
export type QualityPreset = "low" | "medium" | "high" | "very_high" | "custom";
export type OutputMode = "same_as_source" | "custom_folder" | "per_source_folder";

export const LOSSY_FORMATS: AudioFormat[] = ["mp3", "aac", "m4a", "opus"];
export const LOSSLESS_FORMATS: AudioFormat[] = ["wav", "flac"];

export interface ConversionOptions {
  format: AudioFormat;
  quality: QualityPreset;
  customBitrateKbps: number | null;
  sampleRateHz: number | null;
  channels: number | null;
  splitEnabled: boolean;
  splitDurationSecs: number;
  removeSilence: boolean;
  silenceThresholdDb: number;
  silenceMinDurationSecs: number;
  outputMode: OutputMode;
  customOutputDir: string | null;
}

export interface InputFile {
  path: string;
  name: string;
  sizeBytes: number;
  durationSecs: number;
  formatName: string;
  hasAudio: boolean;
  error: string | null;
}

/** Mirrors backend FileMeta (camelCase serde). */
export type FileMeta = InputFile;

export type JobStatus = "waiting" | "processing" | "completed" | "failed" | "cancelled";

/** Mirrors backend JobRecord (camelCase serde). */
export interface QueueItem {
  id: string;
  sourcePath: string;
  status: JobStatus;
  percent: number | null;
  speed: string | null;
  error: string | null;
  technical: string | null;
  warning: string | null;
  outputs: string[];
}

export interface AppSettings {
  language: "en" | "fa";
  theme: "light" | "dark" | "system";
  defaultFormat: AudioFormat;
  defaultQuality: QualityPreset;
  defaultOutputMode: OutputMode;
  defaultOutputDir: string | null;
  autoOpenOutputFolder: boolean;
  concurrency: number;
  removeSilenceDefault: boolean;
  silenceThresholdDb: number;
  silenceMinDurationSecs: number;
  ffmpegPathOverride: string | null;
}

export const MP3_BITRATES = [64, 96, 128, 160, 192, 256, 320] as const;
export const AAC_OPUS_BITRATES = [48, 64, 96, 128, 160, 192, 256] as const;

export const SILENCE_THRESHOLDS_DB = [-20, -25, -30, -35, -40, -45] as const;
export const SILENCE_MIN_DURATIONS = [0.5, 1, 1.5, 2, 3, 5] as const;

export const SAMPLE_RATES = [8000, 22050, 44100, 48000] as const;

export function isLossy(format: AudioFormat): boolean {
  return LOSSY_FORMATS.includes(format);
}
