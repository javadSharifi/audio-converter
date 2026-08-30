import type { StateCreator } from "zustand";
import type { AppSettings, ConversionOptions } from "../../types";
import type { Lang } from "../../i18n";
import type { ToastSlice } from "./toastSlice";
import { isAndroid } from "../../utils/platform";
import * as api from "../../utils/tauri";

export interface SettingsSlice {
  settings: AppSettings | null;
  options: ConversionOptions;
  lang: Lang;
  theme: "light" | "dark" | "system";

  updateOptions: (patch: Partial<ConversionOptions>) => void;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => void;
  persistSettings: () => Promise<void>;
}

export const defaultOptions: ConversionOptions = {
  format: "mp3",
  quality: "medium",
  customBitrateKbps: null,
  sampleRateHz: 44100,
  channels: 2,
  splitEnabled: false,
  splitDurationSecs: 3600,
  removeSilence: false,
  silenceThresholdDb: -30,
  silenceMinDurationSecs: 2,
  outputMode: "same_as_source",
  customOutputDir: null,
};

export const createSettingsSlice: StateCreator<
  SettingsSlice & ToastSlice,
  [],
  [],
  SettingsSlice
> = (set, get) => ({
  settings: null,
  options: defaultOptions,
  lang: "en",
  theme: "system",

  updateOptions(patch) {
    set((s) => ({ options: { ...s.options, ...patch } }));
  },

  async loadSettings() {
    const settings = await api.getSettings();
    // SAF folder picks are not writable via plain paths on Android; the
    // backend maps all output modes onto its user-visible output root.
    const outputMode =
      isAndroid() && settings.defaultOutputMode === "custom_folder"
        ? "same_as_source"
        : settings.defaultOutputMode;
    set({
      settings,
      lang: settings.language,
      theme: settings.theme,
      options: {
        ...get().options,
        format: settings.defaultFormat,
        quality: settings.defaultQuality,
        removeSilence: settings.removeSilenceDefault,
        silenceThresholdDb: settings.silenceThresholdDb,
        silenceMinDurationSecs: settings.silenceMinDurationSecs,
        outputMode,
        customOutputDir: isAndroid() ? null : settings.defaultOutputDir,
      },
    });
  },

  updateSettings(patch) {
    set((s) => ({
      settings: s.settings ? { ...s.settings, ...patch } : (patch as AppSettings),
    }));
    if (patch.language) set({ lang: patch.language });
    if (patch.theme) set({ theme: patch.theme });
  },

  async persistSettings() {
    const { settings } = get();
    if (!settings) return;
    try {
      await api.saveSettings(settings);
      get().pushToast("info", "settingsSaved");
    } catch {
      /* keep the in-memory state; a failed save must not crash the UI */
    }
  },
});
