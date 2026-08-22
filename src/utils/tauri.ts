import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, ConversionOptions, FileMeta, QueueItem } from "../types";

/** Thin typed wrappers over the Rust commands. */

export async function probeFiles(paths: string[]): Promise<FileMeta[]> {
  return invoke<FileMeta[]>("probe_files", { paths });
}

export async function startConversion(
  inputs: string[],
  options: ConversionOptions,
  concurrency?: number,
): Promise<string[]> {
  return invoke<string[]>("start_conversion", {
    inputs,
    options,
    concurrency: concurrency ?? null,
  });
}

export async function cancelJob(jobId: string): Promise<void> {
  await invoke("cancel_job", { jobId });
}

export async function cancelAll(): Promise<void> {
  await invoke("cancel_all_jobs");
}

export async function cancelAllJobs(): Promise<void> {
  await invoke("cancel_all_jobs");
}

export async function clearFinished(): Promise<void> {
  await invoke("clear_finished");
}

export async function getQueue(): Promise<QueueItem[]> {
  return invoke<QueueItem[]>("get_queue");
}

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke<void>("save_settings", { settings });
}

export async function diskFree(path: string): Promise<number> {
  const res = await invoke<{ freeBytes: number }>("disk_free", { path });
  return res.freeBytes;
}
