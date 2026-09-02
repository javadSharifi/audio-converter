import { convertFileSrc } from "@tauri-apps/api/core";
import * as api from "../../utils/tauri";
import { initMediaSession, syncMediaSession } from "../../utils/mediaSession";
import type { AudioTrackInfo } from "../../types";
import type { useMusicPlayerStore } from "../useMusicPlayerStore";

type MusicStore = typeof useMusicPlayerStore;

let boundStore: MusicStore | null = null;

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

    // Initialize Lock Screen / System Media Session listeners
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

export async function resolveAudioSource(track: AudioTrackInfo): Promise<string> {
  // 1. Android content:// URI
  if (track.uri.startsWith("content://")) {
    try {
      const resolved = await api.resolveMediaPaths([track.uri]);
      if (
        resolved.length > 0 &&
        resolved[0].resolved &&
        !resolved[0].resolved.startsWith("STAGE_ERROR")
      ) {
        return convertFileSrc(resolved[0].resolved);
      }
    } catch (e) {
      console.warn("Failed to resolve Android content URI:", e);
    }
  }

  // 2. Desktop POSIX / Windows path or file:// URI
  const rawPath =
    track.path ||
    (track.uri.startsWith("file://")
      ? decodeURIComponent(track.uri.replace(/^file:\/\//, ""))
      : track.uri);

  if (
    rawPath.startsWith("http://") ||
    rawPath.startsWith("https://") ||
    rawPath.startsWith("data:") ||
    rawPath.startsWith("blob:")
  ) {
    return rawPath;
  }

  try {
    return convertFileSrc(rawPath);
  } catch {
    return rawPath;
  }
}
