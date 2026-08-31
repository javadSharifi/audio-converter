import type {
  AudioFormat,
  QualityPreset,
  OutputMode,
  ConversionOptions as GeneratedConversionOptions,
  TrimSpec as GeneratedTrimSpec,
  FileMeta as GeneratedFileMeta,
  JobRecord,
  JobStatus,
  Settings as GeneratedSettings,
  AppError,
  DiskFree,
  BoosterPreset,
  VolumeAnalysis,
  AbPreviewResult,
  BoosterJobSpec,
  LiveBoostStatus,
} from "./generated";

export type {
  AudioFormat,
  QualityPreset,
  OutputMode,
  JobRecord,
  JobStatus,
  AppError,
  DiskFree,
  BoosterPreset,
  VolumeAnalysis,
  AbPreviewResult,
  BoosterJobSpec,
  LiveBoostStatus,
};

export type ConversionOptions = GeneratedConversionOptions;
export type TrimSpec = GeneratedTrimSpec;
export type FileMeta = GeneratedFileMeta;
export type QueueItem = JobRecord;
export type AppSettings = GeneratedSettings & {
  language: "en" | "fa";
  theme: "light" | "dark" | "system";
};

export const LOSSY_FORMATS: AudioFormat[] = ["mp3", "aac", "m4a", "opus"];
export const LOSSLESS_FORMATS: AudioFormat[] = ["wav", "flac"];

export type MediaKind = "audio" | "video";

export interface InputFile {
  path: string;
  name: string;
  sizeBytes: number;
  durationSecs: number;
  formatName: string;
  hasAudio: boolean;
  error: string | null;
  /** audio = pure audio file, video = container with (usually) a video track. */
  kind?: MediaKind;
  /** Optional per-file trim window, seconds. Undefined = whole file. */
  trimStartSecs?: number | null;
  trimEndSecs?: number | null;
  /** Optional per-file sound booster settings */
  boostEnabled?: boolean;
  boostPreset?: BoosterPreset;
  boostManualGainPercent?: number;
}

export const MP3_BITRATES = [64, 96, 128, 160, 192, 256, 320] as const;
export const AAC_OPUS_BITRATES = [48, 64, 96, 128, 160, 192, 256] as const;

export const SILENCE_THRESHOLDS_DB = [-20, -25, -30, -35, -40, -45] as const;
export const SILENCE_MIN_DURATIONS = [0.5, 1, 1.5, 2, 3, 5] as const;

export const SAMPLE_RATES = [8000, 22050, 44100, 48000] as const;

export function isLossy(format: AudioFormat): boolean {
  return LOSSY_FORMATS.includes(format);
}
