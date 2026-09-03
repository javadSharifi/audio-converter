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
let graphInitFailed = false;

/**
 * Ensure the WebAudio gain graph exists BEFORE any src is assigned.
 * Must run before first play so enabling the booster mid-play never
 * re-routes the element (the classic "boost = silence until restart" bug).
 * Sets crossOrigin upfront so asset:// URLs stay CORS-clean once piped
 * through MediaElementSource.
 */
function ensureAudioGraph(): GainNode | null {
  // Android: the native ExoPlayer is the only engine. Building a WebAudio
  // graph (and its HTMLAudioElement below) on Android creates the competing
  // source of truth Rhythm avoids — a second "player" whose listeners fight
  // the native poll/push bridge. Desktop-only by design.
  if (isAndroid()) return null;
  if (typeof window === "undefined" || graphInitFailed) return globalGainNode;
  if (globalGainNode) return globalGainNode;
  const audio = getGlobalAudio();
  if (!audio) return null;
  try {
    // crossOrigin must be set before src — do it here as well as at creation.
    if (!audio.getAttribute("crossorigin")) {
      try {
        audio.crossOrigin = "anonymous";
      } catch {}
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    // Reuse a running context if one already exists.
    if (!globalAudioContext) {
      globalAudioContext = new AudioCtx();
    }
    const source = globalAudioContext.createMediaElementSource(audio);
    globalGainNode = globalAudioContext.createGain();
    // Apply the currently stored boost level immediately so the graph
    // never starts at an unexpected gain.
    try {
      const stored = boundStore?.getState().volumeGainPercent ?? 100;
      globalGainNode.gain.value = Math.max(0, Math.min(400, stored)) / 100;
    } catch {
      globalGainNode.gain.value = 1;
    }
    source.connect(globalGainNode);
    globalGainNode.connect(globalAudioContext.destination);
    // Keep element volume at max — loudness is driven by the GainNode.
    try {
      audio.volume = 1;
    } catch {}
  } catch (e) {
    // createMediaElementSource throws if the element is already bound
    // (e.g. HMR re-init). Don't retry forever; fall back to element volume.
    console.warn("Web Audio GainNode setup skipped:", e);
    if (!globalGainNode) graphInitFailed = true;
  }
  if (globalAudioContext && globalAudioContext.state === "suspended") {
    void globalAudioContext.resume().catch(() => {});
  }
  return globalGainNode;
}

export function getGlobalGainNode(): GainNode | null {
  if (typeof window === "undefined" || isAndroid()) return null;
  const node = ensureAudioGraph();
  if (globalAudioContext && globalAudioContext.state === "suspended") {
    void globalAudioContext.resume().catch(() => {});
  }
  return node;
}

/** Apply a 0-400% boost level to the live graph (with volume fallback). */
export function applyGainPercent(percent: number): void {
  const clamped = Math.max(0, Math.min(400, percent));
  if (isAndroid()) {
    // Route 0-100% to the native ExoPlayer volume so the slider stays
    // functional; >100% needs a native DSP AudioProcessor (Rhythm's
    // RhythmBassBoostProcessor/ReplayGain pattern) and is capped at 1.0
    // rather than faked. Fire-and-forget: the state poll is authoritative.
    try {
      void api.androidPlayerSetVolume(Math.max(0, Math.min(1, clamped / 100))).catch(() => {});
    } catch {}
    return;
  }
  const audio = getGlobalAudio();
  const node = ensureAudioGraph();
  if (node) {
    try {
      // setTargetAtTime avoids clicks when dragging the slider.
      const t = globalAudioContext?.currentTime;
      if (globalAudioContext && typeof t === "number") {
        node.gain.setTargetAtTime(clamped / 100, t, 0.02);
      } else {
        node.gain.value = clamped / 100;
      }
    } catch (e) {
      console.warn("Failed to set gain value:", e);
    }
    if (audio) {
      try {
        audio.volume = 1;
        audio.muted = clamped === 0 ? true : false;
        if (clamped === 0) node.gain.value = 0;
        else if (audio.muted) audio.muted = false;
      } catch {}
    }
  } else if (audio) {
    // WebAudio unavailable — best-effort fallback so sound never goes silent.
    try {
      audio.muted = false;
      audio.volume = Math.max(0, Math.min(1, clamped / 100));
    } catch {}
  }
  if (globalAudioContext && globalAudioContext.state === "suspended") {
    void globalAudioContext.resume().catch(() => {});
  }
}

export function getGlobalAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined" || isAndroid()) return null;
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.preload = "auto";
    try {
      // Must be set before any src assignment for WebAudio CORS to work.
      globalAudio.crossOrigin = "anonymous";
      globalAudio.volume = 1;
    } catch {}

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
// Android Native Jetpack Media3 State Push + Poll Fallback
// ---------------------------------------------------------------------------

type NativePlayerState = Record<string, unknown>;

function applyNativeStateToStore(state: NativePlayerState): void {
  if (!boundStore) return;
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

  // Rhythm pattern: single source of truth lives in the native player.
  // ExoPlayer auto-advances its own queue (track end, notification
  // next/prev, Bluetooth, lock screen), so the UI must adopt the native
  // currentTrack — otherwise the notification shows track B while the UI
  // still shows track A. Match by stable id/uri against the known lists.
  try {
    const rawTrack = state.currentTrack as unknown;
    let nativeTrack: AudioTrackInfo | null = null;
    if (rawTrack && typeof rawTrack === "object") {
      nativeTrack = rawTrack as AudioTrackInfo;
    } else if (typeof rawTrack === "string" && rawTrack.length > 2) {
      try {
        nativeTrack = JSON.parse(rawTrack) as AudioTrackInfo;
      } catch {}
    }
    if (nativeTrack && (nativeTrack.id || nativeTrack.uri)) {
      const nt: AudioTrackInfo = nativeTrack;
      const cur = currentStoreState.currentTrack;
      const same =
        cur != null &&
        ((nt.id && cur.id === nt.id) ||
          (nt.uri && cur.uri === nt.uri));
      if (!same) {
        const pool =
          currentStoreState.currentPlaylist.length > 0
            ? currentStoreState.currentPlaylist
            : currentStoreState.tracks;
        const matched =
          pool.find(
            (t) =>
              (nt.id && t.id === nt.id) ||
              (nt.uri && t.uri === nt.uri),
          ) ?? null;
        // Prefer the full library object (artwork/duration) when known;
        // fall back to the native payload so the UI never shows stale.
        const adopted: AudioTrackInfo = matched ?? {
          ...(cur ?? ({} as AudioTrackInfo)),
          ...nt,
          durationSecs: (nt.durationSecs ?? durSecs) || durSecs,
        };
        patch.currentTrack = adopted as AudioTrackInfo;
        patch.currentTime = 0;
        if (durSecs > 0) patch.duration = durSecs;
        else if (matched?.durationSecs) patch.duration = matched.durationSecs;
      }
    }
  } catch {}

  // Keep repeat/shuffle/rate consistent when changed from system UI
  // (notification, lock screen, Bluetooth) instead of our buttons.
  try {
    const rm = state.repeatMode as unknown;
    if ((rm === "off" || rm === "one" || rm === "all") && currentStoreState.repeatMode !== rm) {
      patch.repeatMode = rm;
    }
    if (typeof state.shuffleMode === "boolean" && currentStoreState.shuffleMode !== state.shuffleMode) {
      patch.shuffleMode = state.shuffleMode as boolean;
    }
    const rate = state.playbackRate as unknown;
    if (typeof rate === "number" && Number.isFinite(rate) && Math.abs(currentStoreState.playbackRate - rate) > 0.01) {
      patch.playbackRate = Math.max(0.25, Math.min(4.0, rate));
    }
  } catch {}

  // Surface native decoder/source failures instead of a silent freeze.
  // Cleared natively on transition/fresh play (see PlaybackService).
  try {
    const errCode = state.errorCode as unknown;
    if (typeof errCode === "string" && errCode.length > 0) {
      const errMsg = typeof state.errorMessage === "string" ? (state.errorMessage as string) : "";
      console.warn(`Android player error ${errCode}: ${errMsg}`);
    }
  } catch {}

  if (Object.keys(patch).length > 0) {
    boundStore.setState(patch);
  }
}

let androidPushSubscribed = false;

function ensureAndroidPushSubscribed(): void {
  if (androidPushSubscribed || typeof window === "undefined") return;
  androidPushSubscribed = true;
  // Pushed by PlaybackService.broadcastStateUpdate via
  // MainActivity.dispatchPlayerState (CustomEvent, same transport as
  // ac:open-files). Shares the parser with the poll fallback below.
  window.addEventListener("ac:player-state", (e: Event) => {
    try {
      const detail = (e as CustomEvent).detail as NativePlayerState | undefined;
      if (detail && typeof detail === "object") applyNativeStateToStore(detail);
    } catch (err) {
      console.warn("Android push-state apply failed:", err);
    }
  });
}

function startAndroidStateSync(): void {
  ensureAndroidPushSubscribed();
  if (androidPollTimer) return;
  const syncOnce = async () => {
    if (!boundStore) return;
    try {
      const state = await api.androidPlayerGetState();
      if (!state || Object.keys(state).length === 0) return;
      applyNativeStateToStore(state);
    } catch (e) {
      console.warn("Android player state sync error:", e);
    }
  };
  // Push is primary (instant on isPlaying/transition/seek); poll is a safety
  // net for missed pushes and cold-start races. 2000ms is enough — Rhythm
  // pushes at 100ms from the service side, we push on every native callback.
  void syncOnce();
  androidPollTimer = setInterval(() => {
    void syncOnce();
  }, 2000);
  // WebView timers are throttled in background; resync immediately when the
  // UI returns so the seekbar never shows a stale position.
  try {
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncOnce();
    };
    document.removeEventListener("visibilitychange", onVisible);
    document.addEventListener("visibilitychange", onVisible);
  } catch {}
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
    // Android is native-only (Rhythm: service player is the single engine).
    // Never fall back to WebAudio here: a WebView element would become a
    // second competing player (seekbar fights, background death) and it
    // cannot play content:// URIs without staging anyway.
    const result = await api.androidPlayerPlay(
      JSON.stringify(track),
      playlist ? JSON.stringify(playlist) : undefined,
      startIndex,
    );
    // PENDING = cold-start queued in PlaybackService.onCreate drain;
    // SERVICE_NOT_READY = transient race. Push+poll adopts the native state
    // once the service is alive.
    if (result === "SERVICE_NOT_READY") {
      console.warn("Android player not ready, will adopt native state via sync");
    }
    startAndroidStateSync();
    return;
  }

  await playViaWebAudio(track);
}

async function playViaWebAudio(track: AudioTrackInfo): Promise<void> {
  const audio = getGlobalAudio();
  if (!audio) return;

  // Build the gain graph BEFORE assigning src so the element never flips
  // from direct output to WebAudio mid-stream (which mutes on Windows).
  ensureAudioGraph();
  if (globalAudioContext && globalAudioContext.state === "suspended") {
    try {
      await globalAudioContext.resume();
    } catch {}
  }

  try {
    audio.pause();
  } catch {}
  try {
    audio.currentTime = 0;
  } catch {}
  // Re-apply the stored boost + speed on every fresh src.
  try {
    const s = boundStore?.getState();
    if (s) {
      applyGainPercent(s.volumeGainPercent);
      if (Number.isFinite(s.playbackRate)) audio.playbackRate = s.playbackRate;
    } else {
      audio.volume = 1;
    }
  } catch {}

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
    // Android: native ExoPlayer is the ONLY engine. Touching the WebView
    // HTMLAudioElement here creates a second "player" whose timeupdate/pause
    // listeners overwrite the store with zeros (seekbar desync) and whose
    // lifecycle dies with the WebView (fake "5-second stop" reports).
    try {
      await api.androidPlayerPause();
    } catch (err) {
      console.warn("Android native pause failed:", err);
    }
    return;
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
    // Native-only; no WebAudio fallback (see unifiedPlayTrack). getGlobalAudio
    // returns null on Android so the desktop path below is a safe no-op, but
    // return explicitly to avoid even touching AudioContext in background.
    try {
      await api.androidPlayerResume();
      startAndroidStateSync();
    } catch (err) {
      console.warn("Android native resume failed:", err);
    }
    return;
  }
  if (globalAudioContext && globalAudioContext.state === "suspended") {
    try {
      await globalAudioContext.resume();
    } catch {}
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
    // Do NOT mirror into HTMLAudioElement on Android (see unifiedPause).
    // Optimistically nudge the store so the seekbar tracks instantly; the
    // next native poll corrects any rounding.
    try {
      if (Number.isFinite(timeSecs) && boundStore) {
        boundStore.setState({ currentTime: Math.max(0, timeSecs) });
      }
    } catch {}
    return;
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
    return;
  }
  const audio = getGlobalAudio();
  if (audio) {
    audio.playbackRate = speed;
  }
}

export async function unifiedSetVolume(volume01: number): Promise<void> {
  if (isAndroid()) {
    try {
      await api.androidPlayerSetVolume(volume01);
    } catch (err) {
      console.warn("Android native setVolume failed:", err);
    }
    return;
  }
  // Desktop: loudness rides the WebAudio GainNode (0-400%).
  try {
    applyGainPercent(Math.max(0, Math.min(400, volume01 * 100)));
  } catch {}
}

export async function unifiedStop(): Promise<void> {
  stopAndroidStateSync();
  if (isAndroid()) {
    try {
      await api.androidPlayerStop();
    } catch (err) {
      console.warn("Android native stop failed:", err);
    }
    return;
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
