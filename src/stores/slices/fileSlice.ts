import type { StateCreator } from "zustand";
import type { InputFile } from "../../types";
import type { ToastSlice } from "./toastSlice";
import * as api from "../../utils/tauri";
import { isAudioPath } from "../../utils/dialog";

export interface FileSlice {
  files: InputFile[];
  probing: boolean;

  addPaths: (paths: string[]) => Promise<void>;
  removeFile: (path: string) => void;
  clearFiles: () => void;
  setTrim: (path: string, field: "trimStartSecs" | "trimEndSecs", secs: number | null) => void;
}

export const createFileSlice: StateCreator<
  FileSlice & ToastSlice,
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
      const resolvedPaths = await api.resolveMediaPaths(paths);
      const metas = await api.probeFiles(resolvedPaths);
      // Dedupe AFTER the await against current state — overlapping calls
      // (rapid drops, double dialog submit) must not create dup rows.
      set((s) => {
        const existing = new Set(s.files.map((f) => f.path));
        const fresh: InputFile[] = metas
          .filter((m) => !existing.has(m.path))
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
});
