import { convertFileSrc } from "@tauri-apps/api/core";
import { commands } from "../types/generated";
import type { AppSettings, ConversionOptions, FileMeta, QueueItem, TrimSpec } from "../types";

function formatAppError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    if ("message" in err) {
      const msg = (err as { message: unknown }).message;
      if (typeof msg === "string") return msg;
      if (typeof msg === "object" && msg !== null) {
        if ("needed" in msg && "available" in msg) {
          const needed = ((msg as { needed: number }).needed / 1048576).toFixed(1);
          const available = ((msg as { available: number }).available / 1048576).toFixed(1);
          return `Not enough disk space. Need about ${needed} MB, only ${available} MB available.`;
        }
        return JSON.stringify(msg);
      }
    }
    if ("kind" in err) {
      return String((err as { kind: unknown }).kind);
    }
  }
  return String(err);
}

export async function probeFiles(paths: string[]): Promise<FileMeta[]> {
  return commands.probeFiles(paths);
}

export async function startConversion(
  items: TrimSpec[],
  options: ConversionOptions,
  concurrency?: number,
): Promise<string[]> {
  const res = await commands.startConversion(items, options, concurrency ?? null);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

/**
 * Waveform peaks ([min, max] per bucket, −1..1) for the trim editor.
 * Decoded from the file's first audio stream by the bundled ffmpeg.
 */
export async function waveformPeaks(path: string, buckets = 1000): Promise<[number, number][]> {
  const res = await commands.waveformPeaks(path, buckets);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data.map(([mn, mx]) => [mn ?? 0, mx ?? 0]);
}

/** Convert a local path into a streamable asset:// URL (Tauri built-in). */
export function fileToAssetUrl(filePath: string): Promise<string> {
  return Promise.resolve(convertFileSrc(filePath));
}

export async function cancelJob(jobId: string): Promise<void> {
  await commands.cancelJob(jobId);
}

export async function cancelAll(): Promise<void> {
  await commands.cancelAllJobs();
}

export async function cancelAllJobs(): Promise<void> {
  await commands.cancelAllJobs();
}

export async function clearFinished(): Promise<void> {
  await commands.clearFinished();
}

export async function getQueue(): Promise<QueueItem[]> {
  return commands.getQueue();
}

export async function getSettings(): Promise<AppSettings> {
  return commands.getSettings() as Promise<AppSettings>;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const res = await commands.saveSettings(settings);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
}

export async function logFrontend(level: "INFO" | "WARN" | "ERROR", msg: string): Promise<void> {
  await commands.logFrontend(level, msg).catch(() => {});
}

export async function diskFree(path: string): Promise<number> {
  const res = await commands.diskFree(path);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data.free_bytes;
}
