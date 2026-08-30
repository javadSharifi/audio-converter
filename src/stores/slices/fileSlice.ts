import type { StateCreator } from "zustand";
import type { InputFile } from "../../types";
import type { QueueSlice } from "./queueSlice";
import type { ToastSlice } from "./toastSlice";
import { isAndroid } from "../../utils/platform";
import * as api from "../../utils/tauri";
import { isAudioPath } from "../../utils/dialog";

export interface FileSlice {
  files: InputFile[];
  probing: boolean;

  addPaths: (paths: string[]) => Promise<void>;
  removeFile: (path: string) => void;
  clearFiles: () => void;
  setTrim: (path: string, field: "trimStartSecs" | "trimEndSecs", secs: number | null) => void;
  updateFileMeta: (
    path: string,
    patch: Partial<Pick<InputFile, "durationSecs" | "formatName" | "sizeBytes">>,
  ) => void;
}

const IS_WINDOWS = typeof navigator !== "undefined" && /win/i.test(navigator.userAgent);
const pathKey = (p: string): string => (IS_WINDOWS ? p.toLowerCase() : p);

/** True when any job is still referencing the given source path. */
function hasActiveJob(jobs: QueueSlice["jobs"], path: string): boolean {
  return Array.from(jobs.values()).some(
    (j) => j.sourcePath === path && (j.status === "waiting" || j.status === "processing"),
  );
}

export const createFileSlice: StateCreator<
  FileSlice & QueueSlice & ToastSlice,
  [],
  [],
  FileSlice
> = (set, get) => ({
  files: [],
  probing: false,

  async addPaths(paths) {
    if (paths.length === 0) return;
    set({ probing: true });
    const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
    try {
      let fresh: InputFile[] = [];
      if (isAndroid()) {
        // Android: lightweight URI metadata ONLY — no copying. The file is
        // staged lazily inside the worker right before its conversion runs.
        const stats = await api.statMediaPaths(paths);
        set((s) => {
          const existing = new Set(s.files.map((f) => pathKey(f.path)));
          fresh = stats
            .filter((m) => !existing.has(pathKey(m.input)))
            .map((m) => ({
              path: m.input,
              name: m.name || baseName(m.input),
              sizeBytes: m.sizeBytes,
              durationSecs: m.durationSecs ?? 0,
              formatName: "",
              hasAudio: !m.error,
              error: m.error,
              kind: (isAudioPath(m.name || m.input) ? "audio" : "video") as InputFile["kind"],
            }));
          if (fresh.length === 0) return {};
          if (fresh.some((f) => f.error)) {
            get().pushToast("warning", "errSomeFilesInvalid");
            // A permission-shaped stat failure → ask the user to grant access.
            if (
              isAndroid() &&
              fresh.some((f) => (f.error ?? "").toLowerCase().includes("permission"))
            ) {
              window.dispatchEvent(new CustomEvent("ac:show-permission-modal"));
            }
          }
          return { files: [...s.files, ...fresh] };
        });
      } else {
        // Desktop: real paths → probe directly (fast, no copies involved).
        const resolved = await api.resolveMediaPaths(paths);
        const failedMetas: InputFile[] = resolved
          .filter((r) => r.error)
          .map((r) => ({
            path: r.resolved,
            name: baseName(r.input),
            sizeBytes: 0,
            durationSecs: 0,
            formatName: "",
            hasAudio: false,
            error: r.error ?? "Could not read file",
          }));
        const okResolved = resolved.filter((r) => !r.error).map((r) => r.resolved);
        const metas = okResolved.length > 0 ? await api.probeFiles(okResolved) : [];
        // Dedupe AFTER the await against current state — overlapping calls
        // (rapid drops, double dialog submit) must not create dup rows.
        set((s) => {
          const existing = new Set(s.files.map((f) => pathKey(f.path)));
          fresh = [...failedMetas, ...metas]
            .filter((m) => !existing.has(pathKey(m.path)))
            .map((m) => ({
              ...m,
              durationSecs: m.durationSecs ?? 0,
              kind: (isAudioPath(m.path) ? "audio" : "video") as InputFile["kind"],
            }));
          if (fresh.length === 0) return {};
          if (fresh.some((f) => f.error)) {
            get().pushToast("warning", "errSomeFilesInvalid");
          }
          return { files: [...s.files, ...fresh] };
        });
      }
    } catch (e) {
      // Probe pipeline itself failed (e.g. tool missing): still show the
      // files in the list with the reason, instead of silently dropping them.
      const msg = String(e);
      set((s) => {
        const existing = new Set(s.files.map((f) => pathKey(f.path)));
        const fallback: InputFile[] = paths
          .filter((p) => !existing.has(pathKey(p)))
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
    // Android: free the staged cache copy backing this row (no-op elsewhere).
    // Never delete while a job is still reading the staged file.
    if (!hasActiveJob(get().jobs, path)) api.deleteStagedInput(path);
    set((s) => ({ files: s.files.filter((f) => f.path !== path) }));
  },

  clearFiles() {
    const jobs = get().jobs;
    for (const f of get().files) {
      if (!hasActiveJob(jobs, f.path)) api.deleteStagedInput(f.path);
    }
    set({ files: [] });
  },

  setTrim(path, field, secs) {
    set((s) => ({
      files: s.files.map((f) =>
        f.path === path ? { ...f, [field]: secs } : f,
      ),
    }));
  },

  updateFileMeta(path, patch) {
    set((s) => ({
      files: s.files.map((f) => (f.path === path ? { ...f, ...patch } : f)),
    }));
  },
});
