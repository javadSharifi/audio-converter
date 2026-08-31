import { create } from "zustand";
import type { BoosterPreset, AudioFormat, QualityPreset, OutputMode, VolumeAnalysis, AbPreviewResult } from "../../../types";
import type { FileBoosterState } from "../shared/boosterTypes";

export interface FileBoosterStore extends FileBoosterState {
  setFile: (file: FileBoosterState["file"]) => void;
  clearFile: () => void;
  setPreset: (preset: BoosterPreset) => void;
  setManualGainPercent: (percent: number) => void;
  setFormat: (format: AudioFormat) => void;
  setQuality: (quality: QualityPreset) => void;
  setOutputMode: (mode: OutputMode) => void;
  setCustomOutputDir: (dir: string | null) => void;

  setAnalysis: (analysis: VolumeAnalysis | null) => void;
  setIsAnalyzing: (val: boolean) => void;

  setPreview: (preview: AbPreviewResult | null) => void;
  setIsPreviewGenerating: (val: boolean) => void;
  setPreviewError: (err: string | null) => void;

  setActiveAudition: (audition: "original" | "boosted" | null) => void;
  setIsPlaying: (val: boolean) => void;

  setIsExporting: (val: boolean) => void;
  setExportProgress: (percent: number | null, speed?: string | null) => void;
  setExportOutputs: (outputs: string[]) => void;
  setExportError: (err: string | null) => void;

  reset: () => void;
}

const initialState: FileBoosterState = {
  file: null,
  preset: "smart",
  manualGainPercent: 100, // Default 100% (0 dB)
  format: "mp3",
  quality: "medium",
  outputMode: "same_as_source",
  customOutputDir: null,

  isAnalyzing: false,
  analysis: null,
  isPreviewGenerating: false,
  preview: null,
  previewError: null,
  activeAudition: "boosted",
  isPlaying: false,

  isExporting: false,
  exportProgress: null,
  exportSpeed: null,
  exportOutputs: [],
  exportError: null,
};

export const useFileBoosterStore = create<FileBoosterStore>((set) => ({
  ...initialState,

  setFile: (file) =>
    set({
      file,
      analysis: null,
      preview: null,
      previewError: null,
      activeAudition: "boosted",
      isPlaying: false,
      exportOutputs: [],
      exportError: null,
      exportProgress: null,
    }),

  clearFile: () =>
    set({
      file: null,
      analysis: null,
      preview: null,
      previewError: null,
      activeAudition: "boosted",
      isPlaying: false,
      exportOutputs: [],
      exportError: null,
      exportProgress: null,
    }),

  setPreset: (preset) => set({ preset }),
  setManualGainPercent: (manualGainPercent) => set({ manualGainPercent }),
  setFormat: (format) => set({ format }),
  setQuality: (quality) => set({ quality }),
  setOutputMode: (outputMode) => set({ outputMode }),
  setCustomOutputDir: (customOutputDir) => set({ customOutputDir }),

  setAnalysis: (analysis) => set({ analysis }),
  setIsAnalyzing: (isAnalyzing) => set({ isAnalyzing }),

  setPreview: (preview) => set({ preview, previewError: null }),
  setIsPreviewGenerating: (isPreviewGenerating) => set({ isPreviewGenerating }),
  setPreviewError: (previewError) => set({ previewError }),

  setActiveAudition: (activeAudition) => set({ activeAudition }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),

  setIsExporting: (isExporting) => set({ isExporting }),
  setExportProgress: (exportProgress, exportSpeed = null) =>
    set({ exportProgress, exportSpeed }),
  setExportOutputs: (exportOutputs) => set({ exportOutputs }),
  setExportError: (exportError) => set({ exportError, isExporting: false }),

  reset: () => set(initialState),
}));
