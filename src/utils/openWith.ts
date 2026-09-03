import { useAppStore } from "../stores/useAppStore";
import { useMusicPlayerStore } from "../stores/useMusicPlayerStore";
import * as api from "./tauri";
import type { AudioTrackInfo } from "../types";

export const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "flac",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "aiff",
  "alac",
  "wma",
  "weba",
]);

export function isAudioPath(pathOrUri: string): boolean {
  if (pathOrUri.startsWith("content://")) {
    return true;
  }
  const clean = pathOrUri.split("?")[0].toLowerCase();
  const ext = clean.split(".").pop() || "";
  return AUDIO_EXTENSIONS.has(ext);
}

function safeDecodeName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function createFallbackTrack(pathOrUri: string): AudioTrackInfo {
  const isContent = pathOrUri.startsWith("content://");
  const cleanPath = pathOrUri.replace(/^file:\/\//, "");
  const name = safeDecodeName(cleanPath.split(/[\\/]/).pop() || "Audio Track");
  const ext = name.split(".").pop()?.toLowerCase() || "mp3";

  return {
    id: isContent ? `content_${pathOrUri}` : `local_${cleanPath}`,
    uri: isContent || pathOrUri.startsWith("file://") ? pathOrUri : `file://${cleanPath}`,
    path: isContent ? null : cleanPath,
    name,
    title: name,
    artist: null,
    album: null,
    durationSecs: 0,
    sizeBytes: 0,
    modifiedTimestampMs: Date.now(),
    createdTimestampMs: Date.now(),
    format: ext,
    mimeType: "audio/*",
    coverUrl: null,
  };
}

/** Keys of currently running handler invocations (triple delivery guard). */
const inflightKeys = new Set<string>();

/**
 * Handle incoming files opened by the OS (via Open with, double click, or share sheet).
 */
export async function handleIncomingFiles(rawPaths: string[]): Promise<void> {
  const validPaths = rawPaths.filter((p) => typeof p === "string" && p.trim().length > 0);
  if (validPaths.length === 0) return;

  // Same URIs arrive via Tauri event + CustomEvent + cold-start drain.
  // Skip overlapping duplicates; sequential re-opens still run.
  const key = [...validPaths].sort().join("\n");
  if (inflightKeys.has(key)) return;
  inflightKeys.add(key);
  try {
    await handleIncomingFilesInner(validPaths);
  } finally {
    inflightKeys.delete(key);
  }
}

async function handleIncomingFilesInner(validPaths: string[]): Promise<void> {
  const audioPaths: string[] = [];
  const videoPaths: string[] = [];

  for (const p of validPaths) {
    if (isAudioPath(p)) {
      audioPaths.push(p);
    } else {
      videoPaths.push(p);
    }
  }

  // 1. Video files -> switch to converter, add to queue
  if (videoPaths.length > 0) {
    const { setActiveTool, addPaths } = useAppStore.getState();
    setActiveTool("converter");
    await addPaths(videoPaths);
  }

  // 2. Audio files -> switch to player, resolve metadata, play immediately.
  // Last so fullscreen player stays visible on mixed payloads.
  if (audioPaths.length > 0) {
    const { setActiveTool } = useAppStore.getState();
    setActiveTool("player");

    const tracks: AudioTrackInfo[] = [];
    for (const p of audioPaths) {
      const resolved = await api.resolveAudioTrack(p);
      if (resolved) {
        tracks.push(resolved);
      } else {
        tracks.push(createFallbackTrack(p));
      }
    }

    if (tracks.length > 0) {
      const playerStore = useMusicPlayerStore.getState();
      await playerStore.playTrack(tracks[0], tracks);
      playerStore.setFullscreenOpen(true);
    }
  }
}
