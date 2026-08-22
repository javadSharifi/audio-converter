import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  ConversionOptions,
  InputFile,
  JobStatus,
  QueueItem,
} from "../types";
import * as api from "../utils/tauri";
import type { Lang } from "../i18n";

export interface ToastMessage {
  id: number;
  kind: "error" | "info" | "warning";
  text: string;
}

interface AppState {
  files: InputFile[];
  jobs: Map<string, QueueItem>;
  settings: AppSettings | null;
  options: ConversionOptions;
  lang: Lang;
  theme: "light" | "dark" | "system";
  toasts: ToastMessage[];
  probing: boolean;

  addPaths: (paths: string[]) => Promise<void>;
  removeFile: (path: string) => void;
  clearFiles: () => void;
  updateOptions: (patch: Partial<ConversionOptions>) => void;

  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => void;
  persistSettings: () => Promise<void>;

  startQueue: () => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  cancelAll: () => Promise<void>;
  clearFinishedJobs: () => Promise<void>;

  pushToast: (kind: ToastMessage["kind"], text: string) => void;
  dismissToast: (id: number) => void;

  initEventListeners: () => Promise<() => void>;
}

let toastSeq = 1;
let unlistenFns: UnlistenFn[] = [];

export const useAppStore = create<AppState>((set, get) => ({
  files: [],
  jobs: new Map(),
  settings: null,
  options: {
    format: "mp3",
    quality: "medium",
    customBitrateKbps: null,
    sampleRateHz: 44100,
    channels: 2,
    splitEnabled: false,
    splitDurationSecs: 600,
    removeSilence: false,
    silenceThresholdDb: -30,
    silenceMinDurationSecs: 2,
    outputMode: "same_as_source",
    customOutputDir: null,
  },
  lang: "en",
  theme: "system",
  toasts: [],
  probing: false,

  async addPaths(paths) {
    if (paths.length === 0) return;
    set({ probing: true });
    const existing = new Set(get().files.map((f) => f.path));
    const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
    try {
      const metas = await api.probeFiles(paths);
      const fresh = metas.filter((m) => !existing.has(m.path));
      set((s) => ({ files: [...s.files, ...fresh] }));
      if (fresh.some((f) => f.error)) {
        get().pushToast("warning", "errSomeFilesInvalid");
      }
    } catch (e) {
      // Probe pipeline itself failed (e.g. tool missing): still show the
      // files in the list with the reason, instead of silently dropping them.
      const msg = String(e);
      const fallback: InputFile[] = paths
        .filter((p) => !existing.has(p))
        .map((p) => ({
          path: p,
          name: baseName(p),
          sizeBytes: 0,
          durationSecs: 0,
          formatName: "",
          hasAudio: false,
          error: msg,
        }));
      set((s) => ({ files: [...s.files, ...fallback] }));
      get().pushToast("error", msg);
    } finally {
      set({ probing: false });
    }
  },

  removeFile(path) {
    set((s) => ({ files: s.files.filter((f) => f.path !== path) }));
  },

  clearFiles() {
    set({ files: [] });
  },

  async loadSettings() {
    const settings = await api.getSettings();
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
        outputMode: settings.defaultOutputMode,
        customOutputDir: settings.defaultOutputDir,
      },
    });
  },

  updateOptions(patch) {
    set((s) => ({ options: { ...s.options, ...patch } }));
  },

  updateSettings(patch) {
    set((s) => ({ settings: s.settings ? { ...s.settings, ...patch } : patch as AppSettings }));
    if (patch.language) set({ lang: patch.language });
    if (patch.theme) set({ theme: patch.theme });
  },

  async persistSettings() {
    const { settings } = get();
    if (!settings) return;
    await api.saveSettings(settings);
    get().pushToast("info", "settingsSaved");
  },

  async startQueue() {
    const { files, options } = get();
    const valid = files.filter((f) => !f.error && f.hasAudio);
    if (valid.length === 0) {
      get().pushToast("error", "errNoFiles");
      return;
    }
    const concurrency = get().settings?.concurrency ?? 1;
    try {
      await api.startConversion(
        valid.map((f) => f.path),
        options,
        concurrency,
      );
    } catch (e) {
      get().pushToast("error", String(e));
    }
  },

  async cancelJob(id) {
    await api.cancelJob(id);
  },

  async cancelAll() {
    await api.cancelAll();
  },

  async clearFinishedJobs() {
    await api.clearFinished();
    set((s) => {
      const jobs = new Map(s.jobs);
      for (const [id, j] of jobs) {
        if (!["waiting", "processing"].includes(j.status)) jobs.delete(id);
      }
      return { jobs };
    });
  },

  pushToast(kind, text) {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    window.setTimeout(() => get().dismissToast(id), 6000);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  async initEventListeners() {
    for (const un of unlistenFns) un();
    unlistenFns = [
      await listen<QueueItem>("job-event", (ev) => {
        const item = ev.payload;
        set((s) => {
          const jobs = new Map(s.jobs);
          jobs.set(item.id, item);
          return { jobs };
        });
      }),
    ];
    return () => {
      for (const un of unlistenFns) un();
      unlistenFns = [];
    };
  },
}));

export function statusLabelKey(status: JobStatus): "statusWaiting" | "statusProcessing" | "statusCompleted" | "statusFailed" | "statusCancelled" {
  switch (status) {
    case "waiting": return "statusWaiting";
    case "processing": return "statusProcessing";
    case "completed": return "statusCompleted";
    case "failed": return "statusFailed";
    case "cancelled": return "statusCancelled";
  }
}
