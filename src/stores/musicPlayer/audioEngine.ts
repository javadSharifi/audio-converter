import { convertFileSrc } from "@tauri-apps/api/core";
import * as api from "../../utils/tauri";
import { isAndroid } from "../../utils/platform";
import { initMediaSession, syncMediaSession } from "../../utils/mediaSession";
import type { AudioTrackInfo } from "../../types";
import type { useMusicPlayerStore } from "../useMusicPlayerStore";

type MusicStore = typeof useMusicPlayerStore;

let boundStore: MusicStore | null = null;
let androidPollTimer: ReturnType<typeof setInterval> | null = null;

export function bindMusicStore(store: MusicStore): void {
  boundStore = store;
}

let globalAudio: HTMLAudioElement | null = null;
let globalAudioContext: AudioContext | null = null;
let globalGainNode: GainNode | null = null;

export function getGlobalGainNode(): GainNode | null {
  if (typeof window === "undefined") return null;
  const audio = getGlobalAudio();
  if (!audio) return null;

  if (!globalGainNode) {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        globalAudioContext = new AudioCtx();
        const source = globalAudioContext.createMediaElementSource(audio);
        globalGainNode = globalAudioContext.createGain();
        source.connect(globalGainNode);
        globalGainNode.connect(globalAudioContext.destination);
      }
    } catch (e) {
      console.warn("Web Audio GainNode setup skipped:", e);
    }
  }

  if (globalAudioContext && globalAudioContext.state === "suspended") {
    void globalAudioContext.resume();
  }

  return globalGainNode;
}

export function getGlobalAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.preload = "auto";

    const state = () => boundStore?.getState();

    // Initialize Lock Screen / System Media Session listeners (Web / Desktop)
    initMediaSession({
      onPlay: () => state()?.resumeTrack(),
      onPause: () => state()?.pauseTrack(),
      onPrevious: () => void state()?.playPreviousTrack(),
      onNext: () => void state()?.playNextTrack(),
      onSeek: (timeSecs) => state()?.seekTo(timeSecs),
      getCurrentTime: () => state()?.currentTime ?? 0,
    });

    globalAudio.addEventListener("timeupdate", () => {
      if (!globalAudio) return;
      const cur = globalAudio.currentTime;
      const dur =
        Number.isFinite(globalAudio.duration) && globalAudio.duration > 0
          ? globalAudio.duration
          : 0;

      boundStore?.setState({
        currentTime: cur,
        duration: dur,
      });

      const s = state();
      if (!s) return;
      syncMediaSession({
        track: s.currentTrack,
        isPlaying: s.isPlaying,
        currentTime: cur,
        duration: dur,
        playbackRate: s.playbackRate,
      });
    });

    globalAudio.addEventListener("ended", () => {
      void state()?.playNextTrack(true);
    });

    globalAudio.addEventListener("pause", () => {
      boundStore?.setState({ isPlaying: false });
      const s = state();
      if (!s) return;
      syncMediaSession({
        track: s.currentTrack,
        isPlaying: false,
        currentTime: s.currentTime,
        duration: s.duration,
        playbackRate: s.playbackRate,
      });
    });

    globalAudio.addEventListener("play", () => {
      boundStore?.setState({ isPlaying: true });
      const s = state();
      if (!s) return;
      syncMediaSession({
        track: s.currentTrack,
        isPlaying: true,
        currentTime: s.currentTime,
        duration: s.duration,
        playbackRate: s.playbackRate,
      });
    });

    globalAudio.addEventListener("error", (e) => {
      console.warn("Audio playback error:", e);
      boundStore?.setState({ isPlaying: false });
      const s = state();
      if (!s) return;
      syncMediaSession({
        track: s.currentTrack,
        isPlaying: false,
        currentTime: s.currentTime,
        duration: s.duration,
        playbackRate: s.playbackRate,
      });
    });
  }
  return globalAudio;
}

// ---------------------------------------------------------------------------
// Android Native Jetpack Media3 State Polling & Synchronization
// ---------------------------------------------------------------------------

function startAndroidStateSync(): void {
  if (androidPollTimer) return;
  androidPollTimer = setInterval(async () => {
    if (!boundStore) return;
    try {
      const state = await api.androidPlayerGetState();
      if (!state || Object.keys(state).length === 0) return;

      const isPlaying = Boolean(state.isPlaying);
      const currentTimeMs = typeof state.currentTimeMs === "number" ? state.currentTimeMs : 0;
      const durationMs = typeof state.durationMs === "number" ? state.durationMs : 0;

      const curSecs = currentTimeMs / 1000;
      const durSecs = durationMs / 1000;

      const currentStoreState = boundStore.getState();
      const patch: Partial<ReturnType<MusicStore["getState"]>> = {};

      if (currentStoreState.isPlaying !== isPlaying) {
        patch.isPlaying = isPlaying;
      }
      if (Math.abs(currentStoreState.currentTime - curSecs) > 0.3) {
        patch.currentTime = curSecs;
      }
      if (durSecs > 0 && Math.abs(currentStoreState.duration - durSecs) > 0.5) {
        patch.duration = durSecs;
      }

      if (Object.keys(patch).length > 0) {
        boundStore.setState(patch);
      }
    } catch (e) {
      console.warn("Android player state sync error:", e);
    }
  }, 250);
}

function stopAndroidStateSync(): void {
  if (androidPollTimer) {
    clearInterval(androidPollTimer);
    androidPollTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Unified Cross-Platform Playback Operations
// ---------------------------------------------------------------------------

export async function unifiedPlayTrack(
  track: AudioTrackInfo,
  playlist?: AudioTrackInfo[],
  startIndex = 0,
): Promise<void> {
  if (isAndroid()) {
    try {
      await api.androidPlayerPlay(
        JSON.stringify(track),
        playlist ? JSON.stringify(playlist) : undefined,
        startIndex,
      );
      startAndroidStateSync();
    } catch (err) {
      console.warn("Android native playback failed, falling back to WebAudio:", err);
      await playViaWebAudio(track);
    }
    return;
  }

  await playViaWebAudio(track);
}

async function playViaWebAudio(track: AudioTrackInfo): Promise<void> {
  const audio = getGlobalAudio();
  if (!audio) return;

  try {
    audio.pause();
  } catch {}
  audio.currentTime = 0;

  try {
    const src = await resolveAudioSource(track);
    const latest = boundStore?.getState().currentTrack;
    if (!latest || (latest.id !== track.id && latest.uri !== track.uri)) {
      return;
    }
    audio.src = src;
    audio.load();
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch((err) => {
        console.warn("WebAudio play error:", err);
        boundStore?.setState({ isPlaying: false });
      });
    }
  } catch (err) {
    console.warn("Failed to play track via WebAudio:", err);
    boundStore?.setState({ isPlaying: false });
  }
}

export async function unifiedPause(): Promise<void> {
  if (isAndroid()) {
    try {
      await api.androidPlayerPause();
    } catch (err) {
      console.warn("Android native pause failed:", err);
    }
  }
  const audio = getGlobalAudio();
  if (audio) {
    try {
      audio.pause();
    } catch {}
  }
}

export async function unifiedResume(): Promise<void> {
  if (isAndroid()) {
    try {
      await api.androidPlayerResume();
      startAndroidStateSync();
      return;
    } catch (err) {
      console.warn("Android native resume failed, falling back to WebAudio:", err);
    }
  }
  const audio = getGlobalAudio();
  if (audio && audio.src) {
    try {
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch((err) => console.warn("WebAudio resume error:", err));
      }
    } catch {}
  }
}

export async function unifiedSeekTo(timeSecs: number): Promise<void> {
  if (isAndroid()) {
    try {
      await api.androidPlayerSeekTo(timeSecs * 1000);
    } catch (err) {
      console.warn("Android native seek failed:", err);
    }
  }
  const audio = getGlobalAudio();
  if (audio && Number.isFinite(timeSecs)) {
    audio.currentTime = timeSecs;
  }
}

export async function unifiedNext(): Promise<void> {
  if (isAndroid()) {
    try {
      await api.androidPlayerNext();
      return;
    } catch (err) {
      console.warn("Android native next failed:", err);
    }
  }
}

export async function unifiedPrevious(): Promise<void> {
  if (isAndroid()) {
    try {
      await api.androidPlayerPrevious();
      return;
    } catch (err) {
      console.warn("Android native previous failed:", err);
    }
  }
}

export async function unifiedSetRepeatMode(mode: "off" | "one" | "all"): Promise<void> {
  if (isAndroid()) {
    try {
      await api.androidPlayerSetRepeatMode(mode);
    } catch (err) {
      console.warn("Android native setRepeatMode failed:", err);
    }
  }
}

export async function unifiedSetShuffleMode(enabled: boolean): Promise<void> {
  if (isAndroid()) {
    try {
      await api.androidPlayerSetShuffleMode(enabled);
    } catch (err) {
      console.warn("Android native setShuffleMode failed:", err);
    }
  }
}

export async function unifiedSetSpeed(speed: number): Promise<void> {
  if (isAndroid()) {
    try {
      await api.androidPlayerSetSpeed(speed);
    } catch (err) {
      console.warn("Android native setSpeed failed:", err);
    }
  }
  const audio = getGlobalAudio();
  if (audio) {
    audio.playbackRate = speed;
  }
}

export async function unifiedStop(): Promise<void> {
  stopAndroidStateSync();
  if (isAndroid()) {
    try {
      await api.androidPlayerStop();
    } catch (err) {
      console.warn("Android native stop failed:", err);
    }
  }
  const audio = getGlobalAudio();
  if (audio) {
    try {
      audio.pause();
      audio.src = "";
    } catch {}
  }
}

export async function resolveAudioSource(track: AudioTrackInfo): Promise<string> {
  const target = track.uri || track.path || "";
  if (!target) return "";

  if (
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("data:") ||
    target.startsWith("blob:")
  ) {
    return target;
  }

  // 1. Android content URI or device storage path
  if (
    target.startsWith("content://") ||
    target.startsWith("/storage/") ||
    target.startsWith("/sdcard/")
  ) {
    try {
      const resolved = await api.resolveMediaPaths([target]);
      if (
        resolved.length > 0 &&
        resolved[0].resolved &&
        !resolved[0].resolved.startsWith("STAGE_ERROR")
      ) {
        return convertFileSrc(resolved[0].resolved);
      }
    } catch (e) {
      console.warn("Failed to resolve Android media URI:", e);
    }
  }

  // 2. Desktop POSIX / Windows path or file:// URI
  const rawPath =
    track.path ||
    (target.startsWith("file://")
      ? decodeURIComponent(target.replace(/^file:\/\//, ""))
      : target);

  try {
    return convertFileSrc(rawPath);
  } catch {
    return rawPath;
  }
}
