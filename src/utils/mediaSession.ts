import type { AudioTrackInfo } from "../types";

export interface MediaSessionMetadataPayload {
  track: AudioTrackInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
}

export interface MediaSessionCallbacks {
  onPlay: () => void;
  onPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (timeSecs: number) => void;
  getCurrentTime?: () => number;
}

let isMediaSessionInitialized = false;
let currentCallbacks: MediaSessionCallbacks | null = null;

/**
 * Initializes global navigator.mediaSession action handlers once.
 */
export function initMediaSession(callbacks: MediaSessionCallbacks): void {
  if (typeof window === "undefined" || !("mediaSession" in navigator)) {
    return;
  }

  currentCallbacks = callbacks;
  if (isMediaSessionInitialized) return;

  const actions: Array<[MediaSessionAction, (details: MediaSessionActionDetails) => void]> = [
    [
      "play",
      () => {
        currentCallbacks?.onPlay();
      },
    ],
    [
      "pause",
      () => {
        currentCallbacks?.onPause();
      },
    ],
    [
      "previoustrack",
      () => {
        currentCallbacks?.onPrevious();
      },
    ],
    [
      "nexttrack",
      () => {
        currentCallbacks?.onNext();
      },
    ],
    [
      "seekto",
      (details) => {
        if (typeof details.seekTime === "number") {
          currentCallbacks?.onSeek(details.seekTime);
        }
      },
    ],
    [
      "seekbackward",
      (details) => {
        const offset = details.seekOffset || 10;
        const current = currentCallbacks?.getCurrentTime?.() ?? 0;
        currentCallbacks?.onSeek(Math.max(0, current - offset));
      },
    ],
    [
      "seekforward",
      (details) => {
        const offset = details.seekOffset || 10;
        const current = currentCallbacks?.getCurrentTime?.() ?? 0;
        currentCallbacks?.onSeek(current + offset);
      },
    ],
    [
      "stop",
      () => {
        currentCallbacks?.onPause();
      },
    ],
  ];

  for (const [action, handler] of actions) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (e) {
      // Action might not be supported in this browser/runtime
      console.warn(`MediaSession action ${action} not supported:`, e);
    }
  }

  isMediaSessionInitialized = true;
}

/**
 * Updates navigator.mediaSession metadata, playback state, and position state.
 */
export function syncMediaSession({
  track,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
}: MediaSessionMetadataPayload): void {
  if (typeof window === "undefined" || !("mediaSession" in navigator)) {
    return;
  }

  if (!track) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
    return;
  }

  // 1. Update Metadata
  const artworkList: MediaImage[] = [];
  if (track.coverUrl) {
    artworkList.push(
      { src: track.coverUrl, sizes: "96x96", type: "image/jpeg" },
      { src: track.coverUrl, sizes: "256x256", type: "image/jpeg" },
      { src: track.coverUrl, sizes: "512x512", type: "image/jpeg" },
    );
  }

  try {
    const metaPayload = {
      title: track.title || track.name,
      artist: track.artist || "Unknown Artist",
      album: track.album || "Audio Library",
      artwork: artworkList,
    };

    if (typeof MediaMetadata !== "undefined") {
      navigator.mediaSession.metadata = new MediaMetadata(metaPayload);
    } else {
      (navigator.mediaSession as unknown as { metadata: unknown }).metadata = metaPayload;
    }
  } catch (e) {
    console.warn("Failed to set MediaMetadata:", e);
  }

  // 2. Update Playback State (Lock Screen status)
  try {
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  } catch {}

  // 3. Update Position State (Lock Screen Seekbar)
  try {
    if (
      "setPositionState" in navigator.mediaSession &&
      Number.isFinite(duration) &&
      duration > 0 &&
      Number.isFinite(currentTime) &&
      currentTime >= 0
    ) {
      navigator.mediaSession.setPositionState({
        duration: Math.max(0, duration),
        playbackRate: Math.max(0.25, Math.min(4.0, playbackRate || 1.0)),
        position: Math.min(Math.max(0, currentTime), Math.max(0, duration)),
      });
    }
  } catch {}
}
