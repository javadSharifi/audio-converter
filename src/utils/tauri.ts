import { convertFileSrc } from "@tauri-apps/api/core";
import { commands } from "../types/generated";
import type { AppSettings, ConversionOptions, FileMeta, QueueItem, TrimSpec } from "../types";
import type { ResolvedMediaPath, StatMediaPath } from "../types/generated";

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

export async function resolveMediaPaths(paths: string[]): Promise<ResolvedMediaPath[]> {
  return commands.resolveMediaPaths(paths);
}

/**
 * Lightweight metadata (name/size/duration) for picked paths — NO copying.
 * Used to fill the file list; staging happens lazily per conversion job.
 */
export async function statMediaPaths(paths: string[]): Promise<StatMediaPath[]> {
  return commands.statMediaPaths(paths);
}

/** Whether required media permissions are granted (always true on desktop). */
export async function hasMediaPermissions(): Promise<boolean> {
  try {
    return await commands.hasMediaPermissions();
  } catch {
    return true;
  }
}

/** Trigger the Android runtime permission dialog (no-op on desktop). */
export function requestMediaPermissions(): void {
  void commands.requestMediaPermissions().catch(() => {});
}

/** Open the system app settings page for this app (no-op on desktop). */
export function openAppSettings(): void {
  void commands.openAppSettings().catch(() => {});
}

/**
 * Delete an Android staged input file (user removed the row / cleared the
 * list). No-op on desktop and for paths outside the app staging dir.
 */
export function deleteStagedInput(path: string): Promise<void> {
  return commands.deleteStagedInput(path).catch(() => {});
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

export async function analyzeAudioVolume(
  path: string,
  startSecs: number | null = null,
  durationSecs: number | null = null,
): Promise<import("../types").VolumeAnalysis> {
  const res = await commands.analyzeAudioVolume(path, startSecs, durationSecs);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function generateAbPreview(
  path: string,
  preset: import("../types").BoosterPreset,
  manualGainPercent: number | null = null,
  startTimeSecs: number | null = null,
  durationSecs: number | null = null,
): Promise<import("../types").AbPreviewResult> {
  const res = await commands.generateAbPreview(
    path,
    preset,
    manualGainPercent,
    startTimeSecs,
    durationSecs,
  );
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function startSoundBoost(
  items: import("../types").BoosterJobSpec[],
  options: ConversionOptions,
  concurrency?: number,
): Promise<string[]> {
  const res = await commands.startSoundBoost(items, options, concurrency ?? null);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function scanAudioFiles(customDirs?: string[]): Promise<import("../types").AudioTrackInfo[]> {
  try {
    return await commands.scanAudioFiles(customDirs ?? null);
  } catch (err) {
    console.warn("scanAudioFiles failed:", err);
    return [];
  }
}

export async function getMusicPermissionStatus(): Promise<import("../types").LibraryPermissionStatus> {
  try {
    return await commands.getMusicPermissionStatus();
  } catch {
    return "notRequired";
  }
}

/** Whether system notifications are allowed (media notification + lock-screen player depend on it). Fail-open on desktop/errors. */
export async function hasNotificationPermission(): Promise<boolean> {
  try {
    return await commands.getNotificationPermissionStatus();
  } catch {
    return true;
  }
}

/**
 * Lazily resolve one track's embedded cover to a streamable asset:// URL.
 * Returns null when the file has no embedded picture (UI shows placeholder).
 */
export async function getTrackArtworkUrl(pathOrUri: string): Promise<string | null> {
  try {
    const cachedPath = await commands.getTrackArtwork(pathOrUri);
    if (!cachedPath) return null;
    try {
      return convertFileSrc(cachedPath);
    } catch {
      return null;
    }
  } catch (err) {
    console.warn("getTrackArtwork failed:", err);
    return null;
  }
}

export async function deleteAudioTrack(pathOrUri: string): Promise<void> {
  const res = await commands.deleteAudioTrack(pathOrUri);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
}

export async function setAsRingtone(pathOrUri: string): Promise<void> {
  const res = await commands.setAsRingtone(pathOrUri);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
}

export async function shareAudioTrack(
  pathOrUri: string,
  title: string,
  mimeType: string,
): Promise<void> {
  const res = await commands.shareAudioTrack(pathOrUri, title, mimeType);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
}

// --- Jetpack Media3 Android Audio Player Bridge Helpers ---

export async function androidPlayerPlay(
  trackJson: string,
  playlistJson?: string,
  startIndex?: number,
): Promise<string> {
  const res = await commands.androidPlayerPlay(
    trackJson,
    playlistJson ?? null,
    startIndex ?? null,
  );
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function androidPlayerPause(): Promise<string> {
  const res = await commands.androidPlayerPause();
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function androidPlayerResume(): Promise<string> {
  const res = await commands.androidPlayerResume();
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function androidPlayerSeekTo(positionMs: number): Promise<string> {
  const res = await commands.androidPlayerSeekTo(Math.max(0, Math.round(positionMs)));
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function androidPlayerNext(): Promise<string> {
  const res = await commands.androidPlayerNext();
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function androidPlayerPrevious(): Promise<string> {
  const res = await commands.androidPlayerPrevious();
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function androidPlayerSetRepeatMode(mode: "off" | "one" | "all"): Promise<string> {
  const res = await commands.androidPlayerSetRepeatMode(mode);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function androidPlayerSetShuffleMode(enabled: boolean): Promise<string> {
  const res = await commands.androidPlayerSetShuffleMode(enabled);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function androidPlayerSetSpeed(speed: number): Promise<string> {
  const res = await commands.androidPlayerSetSpeed(speed);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function androidPlayerSetVolume(volume01: number): Promise<string> {
  const clamped = Math.max(0, Math.min(1, volume01));
  const res = await commands.androidPlayerSetVolume(clamped);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function androidPlayerSetBoosterGain(gainDb: number): Promise<string> {
  const clamped = Math.max(0, Math.min(12, gainDb));
  const res = await commands.androidPlayerSetBoosterGain(clamped);
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function androidPlayerStop(): Promise<string> {
  const res = await commands.androidPlayerStop();
  if (res.status === "error") {
    throw new Error(formatAppError(res.error));
  }
  return res.data;
}

export async function androidPlayerGetState(): Promise<Record<string, unknown>> {
  try {
    const raw = await commands.androidPlayerGetState();
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function getPendingOpenFiles(): Promise<string[]> {
  try {
    const res = await commands.getPendingOpenFiles();
    if (res.status === "error") {
      console.warn("getPendingOpenFiles error:", res.error);
      return [];
    }
    return res.data;
  } catch (e) {
    console.warn("getPendingOpenFiles failed:", e);
    return [];
  }
}

export async function resolveAudioTrack(pathOrUri: string): Promise<import("../types").AudioTrackInfo | null> {
  try {
    const res = await commands.resolveAudioTrack(pathOrUri);
    if (res.status === "error") {
      console.warn("resolveAudioTrack error:", res.error);
      return null;
    }
    return res.data;
  } catch (e) {
    console.warn("resolveAudioTrack failed:", e);
    return null;
  }
}

/** Exit the app (Android double-back-to-exit, no-op fallback on web). */
export async function exitApp(): Promise<void> {
  try {
    await commands.exitApp();
  } catch (e) {
    console.warn("exitApp failed:", e);
  }
}





