import type { BoosterPreset, VolumeAnalysis, AbPreviewResult, AudioFormat, QualityPreset, OutputMode } from "../../../types";

export interface PresetInfo {
  id: BoosterPreset;
  labelKey: string;
  descKey: string;
  icon: string;
  badge?: string;
  accentColor: string;
}

export const BOOSTER_PRESETS: PresetInfo[] = [
  {
    id: "smart",
    labelKey: "presetSmart",
    descKey: "presetSmartDesc",
    icon: "✨",
    badge: "recommended",
    accentColor: "from-amber-500 to-orange-500",
  },
  {
    id: "music",
    labelKey: "presetMusic",
    descKey: "presetMusicDesc",
    icon: "🎵",
    accentColor: "from-blue-500 to-indigo-500",
  },
  {
    id: "extreme",
    labelKey: "presetExtreme",
    descKey: "presetExtremeDesc",
    icon: "⚡",
    badge: "loud",
    accentColor: "from-red-500 to-rose-600",
  },
  {
    id: "manual",
    labelKey: "presetManual",
    descKey: "presetManualDesc",
    icon: "🎛️",
    accentColor: "from-zinc-500 to-zinc-700 dark:from-zinc-400 dark:to-zinc-600",
  },
];

export interface FileBoosterState {
  file: {
    path: string;
    name: string;
    sizeBytes: number;
    durationSecs: number;
  } | null;

  preset: BoosterPreset;
  manualGainPercent: number; // 0 to 200 (100 = 0dB original)
  format: AudioFormat;
  quality: QualityPreset;
  outputMode: OutputMode;
  customOutputDir: string | null;

  isAnalyzing: boolean;
  analysis: VolumeAnalysis | null;

  isPreviewGenerating: boolean;
  preview: AbPreviewResult | null;
  previewError: string | null;
  activeAudition: "original" | "boosted" | null;
  isPlaying: boolean;

  isExporting: boolean;
  exportProgress: number | null; // 0-100
  exportSpeed: string | null;
  exportOutputs: string[];
  exportError: string | null;
}

export interface LiveBoosterState {
  isRunning: boolean;
  gain: number;
  isSupported: boolean;
  consentSheetOpen: boolean;
  hasSeenExplainer: boolean;
  error: string | null;
}
