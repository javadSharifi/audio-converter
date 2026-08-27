import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  ConversionOptions,
  InputFile,
  JobStatus,
  QueueItem,
  TrimSpec,
} from "../types";
import * as api from "../utils/tauri";
import { isAudioPath } from "../utils/dialog";
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
  starting: boolean;

  addPaths: (paths: string[]) => Promise<void>;
  removeFile: (path: string) => void;
  clearFiles: () => void;
  setTrim: (path: string, field: "trimStartSecs" | "trimEndSecs", secs: number | null) => void;
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
  starting: false,

  async addPaths(paths) {
    if (paths.length === 0) return;
    set({ probing: true });
    const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
    try {
      const metas = await api.probeFiles(paths);
      // Dedupe AFTER the await against current state — overlapping calls
      // (rapid drops, double dialog submit) must not create dup rows.
      set((s) => {
        const existing = new Set(s.files.map((f) => f.path));
        const fresh = metas
          .filter((m) => !existing.has(m.path))
          .map((m) => ({
            ...m,
            kind: (isAudioPath(m.path) ? "audio" : "video") as InputFile["kind"],
          }));
        if (fresh.length === 0) return {};
        if (fresh.some((f) => f.error)) {
          get().pushToast("warning", "errSomeFilesInvalid");
        }
        return { files: [...s.files, ...fresh] };
      });
    } catch (e) {
      // Probe pipeline itself failed (e.g. tool missing): still show the
      // files in the list with the reason, instead of silently dropping them.
      const msg = String(e);
      set((s) => {
        const existing = new Set(s.files.map((f) => f.path));
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
        if (fallback.length === 0) return {};
        get().pushToast("error", msg);
        return { files: [...s.files, ...fallback] };
      });
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

  setTrim(path, field, secs) {
    set((s) => ({
      files: s.files.map((f) =>
        f.path === path ? { ...f, [field]: secs } : f,
      ),
    }));
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
    const { files, options, pushToast, starting, jobs } = get();
    if (starting) return;
    const busy = Array.from(jobs.values()).some((j) =>
      ["waiting", "processing"].includes(j.status),
    );
    if (busy) return;

    const valid = files.filter((f) => !f.error && f.hasAudio);
    if (valid.length === 0) {
      pushToast("error", "errNoFiles");
      return;
    }
    // Client-side guard mirroring TrimSpec::validate — fail fast before IPC.
    for (const f of valid) {
      const start = f.trimStartSecs ?? null;
      const end = f.trimEndSecs ?? null;
      if (start !== null && start < 0) {
        pushToast("error", "errTrimInvalid");
        return;
      }
      if (end !== null && end <= 0) {
        pushToast("error", "errTrimInvalid");
        return;
      }
      if (start !== null && end !== null && end <= start) {
        pushToast("error", "errTrimOrder");
        return;
      }
    }
    // Blank trim fields → nulls so the backend emits no -ss/-to flags at all.
    const items: TrimSpec[] = valid.map((f) => ({
      path: f.path,
      startTime: f.trimStartSecs ?? null,
      endTime: f.trimEndSecs ?? null,
    }));
    // Fresh run = fresh panel. Purge UI rows.
    set({ starting: true, jobs: new Map() });
    void api.logFrontend(
      "INFO",
      `startQueue: starting batch of ${items.length} files: ${items.map((i) => i.path).join(", ")}`,
    );
    const concurrency = get().settings?.concurrency ?? 1;
    try {
      const jobIds = await api.startConversion(items, options, concurrency);
      void api.logFrontend(
        "INFO",
        `startQueue: received jobIds from backend: ${jobIds.join(", ")}`,
      );
      // Initialize the exact batch jobs in state with the returned IDs
      set((s) => {
        const batchJobs = new Map<string, QueueItem>();
        for (let i = 0; i < items.length; i++) {
          const id = jobIds[i];
          const existing = s.jobs.get(id);
          batchJobs.set(
            id,
            existing ?? {
              id,
              sourcePath: items[i].path,
              status: "waiting",
              percent: null,
              speed: null,
              error: null,
              technical: null,
              warning: null,
              outputs: [],
            },
          );
        }
        return { jobs: batchJobs };
      });
    } catch (e) {
      void api.logFrontend("ERROR", `startQueue failed: ${String(e)}`);
      pushToast("error", String(e));
    } finally {
      set({ starting: false });
    }
  },

  async cancelJob(id) {
    void api.logFrontend("INFO", `cancelJob: ${id}`);
    await api.cancelJob(id);
  },

  async cancelAll() {
    void api.logFrontend("INFO", "cancelAll called");
    await api.cancelAll();
  },

  async clearFinishedJobs() {
    void api.logFrontend("INFO", "clearFinishedJobs called");
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
        const raw = ev.payload as any;
        const item: QueueItem = {
          ...raw,
          id: String(raw.id ?? raw.jobId ?? ""),
        };
        void api.logFrontend(
          "INFO",
          `job-event received: id=${item.id}, status=${item.status}, percent=${item.percent}, error=${item.error ?? "none"}, outputs=${item.outputs.length}`,
        );
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
