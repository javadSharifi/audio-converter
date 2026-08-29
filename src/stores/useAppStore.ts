import { create } from "zustand";
import type { JobStatus } from "../types";
import { type ToastSlice, createToastSlice, type ToastMessage } from "./slices/toastSlice";
import { type FileSlice, createFileSlice } from "./slices/fileSlice";
import { type SettingsSlice, createSettingsSlice } from "./slices/settingsSlice";
import { type QueueSlice, createQueueSlice } from "./slices/queueSlice";

export type { ToastMessage };
export type AppState = FileSlice & SettingsSlice & QueueSlice & ToastSlice;

export const useAppStore = create<AppState>()((...a) => ({
  ...createToastSlice(...a),
  ...createFileSlice(...a),
  ...createSettingsSlice(...a),
  ...createQueueSlice(...a),
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
