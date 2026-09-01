import type { StateCreator } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { QueueItem, TrimSpec } from "../../types";
import type { FileSlice } from "./fileSlice";
import type { SettingsSlice } from "./settingsSlice";
import type { ToastSlice } from "./toastSlice";
import * as api from "../../utils/tauri";

export interface QueueSlice {
  jobs: Map<string, QueueItem>;
  starting: boolean;

  startQueue: () => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  cancelAll: () => Promise<void>;
  clearFinishedJobs: () => Promise<void>;
  initEventListeners: () => Promise<() => void>;
}

export const createQueueSlice: StateCreator<
  QueueSlice & FileSlice & SettingsSlice & ToastSlice,
  [],
  [],
  QueueSlice
> = (set, get) => {
  let localUnlistenFns: UnlistenFn[] = [];
  return {
  jobs: new Map<string, QueueItem>(),
  starting: false,

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
    // Blank trim/boost fields → nulls/booleans passed to backend
    const items: TrimSpec[] = valid.map((f) => ({
      path: f.path,
      startTimeSecs: f.trimStartSecs ?? null,
      endTimeSecs: f.trimEndSecs ?? null,
      boostEnabled: f.boostEnabled ?? null,
      boostPreset: f.boostPreset ?? null,
      boostManualGainPercent: f.boostManualGainPercent ?? null,
    }));
    const prevJobs = new Map(get().jobs);
    set({ starting: true, jobs: new Map() });
    void api.logFrontend(
      "INFO",
      `startQueue: starting batch of ${items.length} files: ${items.map((i) => i.path).join(", ")}`,
    );
    const concurrency = get().settings?.concurrency ?? 1;
    try {
      const jobIds = await api.startConversion(items, options, concurrency);
      if (jobIds.length !== items.length) {
        throw new Error(`Job ID count mismatch: expected ${items.length}, got ${jobIds.length}`);
      }
      void api.logFrontend(
        "INFO",
        `startQueue: received jobIds from backend: ${jobIds.join(", ")}`,
      );
      set((s) => {
        const batchJobs = new Map<string, QueueItem>();
        for (let i = 0; i < items.length; i++) {
          const rawId = jobIds[i];
          if (!rawId || typeof rawId !== "string" || rawId.trim() === "") {
            throw new Error(`Invalid job id at index ${i}`);
          }
          const id = rawId;
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
      set({ jobs: prevJobs });
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

  async initEventListeners() {
    for (const un of localUnlistenFns) un();
    localUnlistenFns = [
      await listen<QueueItem>("job-event", (ev) => {
        const raw = ev.payload as Record<string, unknown>;
        const rawId = (raw["id"] as string) ?? (raw["jobId"] as string) ?? "";
        if (!rawId || typeof rawId !== "string" || rawId.trim() === "") return;
        const item: QueueItem = {
          ...(raw as unknown as QueueItem),
          id: String(rawId),
        };
        set((s) => {
          const jobs = new Map(s.jobs);
          jobs.set(item.id, item);
          return { jobs };
        });
      }),
    ];
    return () => {
      for (const un of localUnlistenFns) un();
      localUnlistenFns = [];
    };
  },
  };
};
