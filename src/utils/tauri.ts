import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { AppSettings, ConversionOptions, FileMeta, QueueItem, TrimSpec } from "../types";

/** Thin typed wrappers over the Rust commands. */

export async function probeFiles(paths: string[]): Promise<FileMeta[]> {
  return invoke<FileMeta[]>("probe_files", { paths });
}

export async function startConversion(
  items: TrimSpec[],
  options: ConversionOptions,
  concurrency?: number,
): Promise<string[]> {
  return invoke<string[]>("start_conversion", {
    items,
    options,
    concurrency: concurrency ?? null,
  });
}

/**
 * Waveform peaks ([min, max] per bucket, −1..1) for the trim editor.
 * Decoded from the file's first audio stream by the bundled ffmpeg.
 */
export async function waveformPeaks(path: string, buckets = 1000): Promise<[number, number][]> {
  return invoke<[number, number][]>("waveform_peaks", { path, buckets: buckets ?? null });
}

/** Convert a local path into a streamable asset:// URL (Tauri built-in). */
export function fileToAssetUrl(filePath: string): Promise<string> {
  return Promise.resolve(convertFileSrc(filePath));
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
  await invoke("save_settings", { settings });
}

export async function logFrontend(level: "INFO" | "WARN" | "ERROR", msg: string): Promise<void> {
  await invoke("log_frontend", { level, msg }).catch(() => {});
}

export async function diskFree(path: string): Promise<number> {
  const res = await invoke<{ freeBytes: number }>("disk_free", { path });
  return res.freeBytes;
}
