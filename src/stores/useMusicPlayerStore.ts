import { create } from "zustand";
import type {
  AudioTrackInfo,
  MusicSortOption,
  LibraryPermissionStatus,
  CustomAlbum,
} from "../types";
import * as api from "../utils/tauri";
import {
  loadLikedPaths,
  persistLikedPaths,
  loadSavedSort,
  persistSavedSort,
  loadCustomFolders,
  persistCustomFolders,
  loadCustomAlbums,
  persistCustomAlbums,
  loadCachedTracks,
  persistCachedTracks,
} from "./musicPlayer/persistence";
import {
  bindMusicStore,
  applyGainPercent,
  getGlobalGainNode,
  unifiedPlayTrack,
  unifiedPause,
  unifiedResume,
  unifiedSeekTo,
  unifiedNext,
  unifiedPrevious,
  unifiedSetRepeatMode,
  unifiedSetShuffleMode,
  unifiedSetSpeed,
  unifiedStop,
} from "./musicPlayer/audioEngine";
import { getTrackKey, getTrackAliases, isTrackLiked } from "./musicPlayer/trackUtils";
import { isAndroid } from "../utils/platform";

export { getGlobalAudio, getGlobalGainNode } from "./musicPlayer/audioEngine";
export {
  getTrackKey,
  getTrackAliases,
  isTrackLiked,
  filterAndSortTracks,
  computeAllAlbums,
} from "./musicPlayer/trackUtils";

// ---------------------------------------------------------------------------
// Store Interface & Implementation
// ---------------------------------------------------------------------------

export interface MusicPlayerState {
  tracks: AudioTrackInfo[];
  loading: boolean;
  hasScanned: boolean;
  searchQuery: string;
  sortBy: MusicSortOption;
  likedPaths: Set<string>;
  permissionStatus: LibraryPermissionStatus;
  customFolders: string[];
  customAlbums: CustomAlbum[];

  // Playback state
  currentTrack: AudioTrackInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  currentPlaylist: AudioTrackInfo[];
  repeatMode: "off" | "all" | "one";
  shuffleMode: boolean;
  fullscreenOpen: boolean;
  playbackRate: number;
  volumeGainPercent: number;

  // Multi-select state
  selectedTrackKeys: Set<string>;
  isSelectionMode: boolean;

  checkPermission: () => Promise<void>;
  scanLibrary: (customDirs?: string[]) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSortBy: (sort: MusicSortOption) => void;
  toggleLike: (trackOrKey: AudioTrackInfo | string) => void;
  toggleLikeMultiple: (tracksToToggle: AudioTrackInfo[]) => boolean;
  isLiked: (trackOrKey: AudioTrackInfo | string) => boolean;
  addCustomFolder: (path: string) => Promise<void>;
  removeCustomFolder: (path: string) => Promise<void>;

  // Playback actions
  playTrack: (track: AudioTrackInfo, playlist?: AudioTrackInfo[]) => Promise<void>;
  pauseTrack: () => void;
  resumeTrack: () => void;
  closePlayer: () => void;
  togglePlayTrack: (track: AudioTrackInfo, playlist?: AudioTrackInfo[]) => Promise<void>;
  playNextTrack: (auto?: boolean) => Promise<void>;
  playPreviousTrack: () => Promise<void>;
  seekTo: (timeSecs: number) => void;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
  setFullscreenOpen: (open: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setVolumeGainPercent: (gain: number) => void;

  // Multi-select actions
  enterSelectionMode: (initialTrack?: AudioTrackInfo) => void;
  exitSelectionMode: () => void;
  toggleSelectTrack: (trackOrKey: AudioTrackInfo | string) => void;
  selectAllTracks: (tracks: AudioTrackInfo[]) => void;
  clearSelection: () => void;
  deleteMultipleTracks: (tracks: AudioTrackInfo[]) => Promise<void>;
  addMultipleTracksToAlbum: (albumId: string, tracks: AudioTrackInfo[]) => void;

  // Track management actions
  deleteTrack: (track: AudioTrackInfo) => Promise<void>;
  setRingtone: (track: AudioTrackInfo) => Promise<void>;
  shareTrack: (track: AudioTrackInfo) => Promise<void>;

  // Custom Albums actions
  createCustomAlbum: (name: string) => string;
  renameCustomAlbum: (albumId: string, newName: string) => void;
  deleteCustomAlbum: (albumId: string) => void;
  addTrackToAlbum: (albumId: string, track: AudioTrackInfo) => void;
  removeTrackFromAlbum: (albumId: string, track: AudioTrackInfo) => void;
  isTrackInAlbum: (albumId: string, track: AudioTrackInfo) => boolean;
}

export const useMusicPlayerStore = create<MusicPlayerState>((set, get) => ({
  tracks: loadCachedTracks(),
  loading: false,
  hasScanned: false,
  searchQuery: "",
  sortBy: loadSavedSort(),
  likedPaths: loadLikedPaths(),
  permissionStatus: "granted",
  customFolders: loadCustomFolders(),
  customAlbums: loadCustomAlbums(),

  currentTrack: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  currentPlaylist: [],
  repeatMode: "off",
  shuffleMode: false,
  fullscreenOpen: false,
  playbackRate: 1.0,
  volumeGainPercent: 100,
  selectedTrackKeys: new Set(),
  isSelectionMode: false,

  async checkPermission() {
    try {
      const status = await api.getMusicPermissionStatus();
      set({ permissionStatus: status });
    } catch {
      set({ permissionStatus: "notRequired" });
    }
  },

  async scanLibrary(customDirs) {
    // Keep cached tracks visible while rescanning — the list only swaps
    // once fresh results arrive, so the UI never flashes empty and the
    // permission banner stays hidden when we already have songs.
    if (get().loading) return;
    const hadCached = get().tracks.length > 0;
    const isManual = customDirs !== undefined;
    set({ loading: true });
    try {
      const targetDirs =
        customDirs ?? (get().customFolders.length > 0 ? get().customFolders : undefined);
      const tracks = await api.scanAudioFiles(targetDirs);
      // A background auto-scan that comes back empty (e.g. permission
      // hiccup) must not wipe a good cache — keep showing cached songs.
      if (tracks.length === 0 && hadCached && !isManual) {
        set({ loading: false, hasScanned: true });
        return;
      }
      set({ tracks, loading: false, hasScanned: true });
      // Cache in the background; never let quota errors break the scan.
      try {
        persistCachedTracks(tracks);
      } catch {}
    } catch (err) {
      console.warn("Library scan failed:", err);
      set({ loading: false, hasScanned: true });
    }
  },

  setSearchQuery(query) {
    set({ searchQuery: query });
  },

  setSortBy(sortBy) {
    persistSavedSort(sortBy);
    set({ sortBy });
  },

  toggleLike(trackOrKey) {
    set((state) => {
      const next = new Set(state.likedPaths);
      let aliases: string[] = [];
      let primaryKey: string;

      if (typeof trackOrKey === "string") {
        primaryKey = trackOrKey;
        const matched = state.tracks.find(
          (t) => t.id === trackOrKey || t.uri === trackOrKey || (t.path && t.path === trackOrKey),
        );
        if (matched) {
          aliases = getTrackAliases(matched);
        } else {
          aliases = [trackOrKey];
        }
      } else {
        primaryKey = getTrackKey(trackOrKey);
        aliases = getTrackAliases(trackOrKey);
      }

      // If any alias is currently in likedPaths, remove ALL aliases
      const currentlyLiked = aliases.some((k) => next.has(k));
      if (currentlyLiked) {
        aliases.forEach((k) => next.delete(k));
      } else {
        next.add(primaryKey);
      }

      persistLikedPaths(next);
      return { likedPaths: next };
    });
  },

  toggleLikeMultiple(tracksToToggle) {
    if (tracksToToggle.length === 0) return false;
    let didLike = false;
    set((state) => {
      const next = new Set(state.likedPaths);
      const allLiked = tracksToToggle.every((t) => isTrackLiked(t, state.likedPaths));
      didLike = !allLiked;

      for (const track of tracksToToggle) {
        const aliases = getTrackAliases(track);
        if (allLiked) {
          // Unlike all
          aliases.forEach((k) => next.delete(k));
        } else {
          // Like all
          const primaryKey = getTrackKey(track);
          aliases.forEach((k) => next.delete(k));
          next.add(primaryKey);
        }
      }

      persistLikedPaths(next);
      return { likedPaths: next };
    });
    return didLike;
  },

  isLiked(trackOrKey) {
    return isTrackLiked(trackOrKey, get().likedPaths, get().tracks);
  },

  async addCustomFolder(path) {
    const next = Array.from(new Set([...get().customFolders, path]));
    persistCustomFolders(next);
    set({ customFolders: next });
    await get().scanLibrary(next);
  },

  async removeCustomFolder(path) {
    const next = get().customFolders.filter((f) => f !== path);
    persistCustomFolders(next);
    set({ customFolders: next });
    await get().scanLibrary(next.length > 0 ? next : undefined);
  },

  async playTrack(track, playlist) {
    if (playlist) {
      set({ currentPlaylist: playlist });
    }

    const currentList = playlist || get().currentPlaylist || get().tracks;
    const startIndex = currentList.findIndex(
      (t) => t.id === track.id || t.uri === track.uri || (t.path && t.path === track.path),
    );

    const current = get().currentTrack;
    if (current && (current.id === track.id || current.uri === track.uri) && get().isPlaying) {
      return;
    }

    set({
      currentTrack: track,
      isPlaying: true,
      currentTime: 0,
      duration: track.durationSecs || 0,
    });

    await unifiedPlayTrack(track, currentList, startIndex >= 0 ? startIndex : 0);
  },

  pauseTrack() {
    void unifiedPause();
    set({ isPlaying: false });
  },

  closePlayer() {
    void unifiedStop();
    set({
      currentTrack: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      fullscreenOpen: false,
    });
  },

  resumeTrack() {
    void unifiedResume();
    set({ isPlaying: true });
  },

  async togglePlayTrack(track, playlist) {
    const current = get().currentTrack;
    const isCurrent = current && (current.id === track.id || current.uri === track.uri);
    if (isCurrent) {
      if (get().isPlaying) {
        get().pauseTrack();
      } else {
        get().resumeTrack();
      }
    } else {
      await get().playTrack(track, playlist);
    }
  },

  async playNextTrack(auto = false) {
    const state = get();
    // Android: the native ExoPlayer owns the queue (set via playTrack's
    // playlist+index). Delegate next/prev to it so notification, lock
    // screen, Bluetooth and auto-advance all share one queue — Rhythm does
    // controller.seekToNext() for the same reason. Re-calling playTrack()
    // here would rebuild the whole queue (re-buffer + notification flicker).
    // NOTE: repeat-one only loops on AUTO (track end, handled natively by
    // ExoPlayer REPEAT_MODE_ONE). A MANUAL next must always advance — the
    // previous code restarted the same track on manual next, which disagrees
    // with Rhythm/platform convention.
    if (isAndroid()) {
      try {
        await unifiedNext();
      } catch (e) {
        console.warn("Native next failed, falling back to JS queue:", e);
      }
      // If native has no queue (e.g. single-track cold start or native
      // error), fall through to the JS queue logic below only when the
      // native call clearly could not advance. The push+poll sync adopts
      // the native track quickly; optimistic JS switching here would
      // fight it, so only fall back when there is nothing native to advance.
      // Heuristic: fall back only when the native playlist is empty.
      // (Native queue is populated on every playTrack with a playlist.)
      if (state.currentPlaylist.length > 0) return;
    }
    const list = state.currentPlaylist.length > 0 ? state.currentPlaylist : state.tracks;
    if (list.length === 0) return;

    if (state.repeatMode === "one" && state.currentTrack) {
      state.seekTo(0);
      state.resumeTrack();
      return;
    }

    const currentIndex = list.findIndex(
      (t) =>
        state.currentTrack &&
        (t.id === state.currentTrack.id || t.uri === state.currentTrack.uri),
    );

    let nextIndex = 0;
    if (state.shuffleMode) {
      if (list.length > 1) {
        let rand = Math.floor(Math.random() * list.length);
        while (rand === currentIndex) {
          rand = Math.floor(Math.random() * list.length);
        }
        nextIndex = rand;
      } else {
        nextIndex = 0;
      }
    } else {
      if (currentIndex >= 0 && currentIndex < list.length - 1) {
        nextIndex = currentIndex + 1;
      } else if (currentIndex === list.length - 1) {
        if (auto && state.repeatMode === "off") {
          return;
        }
        nextIndex = 0;
      }
    }

    const nextTrack = list[nextIndex];
    if (nextTrack) {
      await state.playTrack(nextTrack, list);
    }
  },

  async playPreviousTrack() {
    const state = get();
    // Android: delegate to the native queue (see playNextTrack). The >3s
    // restart-vs-previous rule is enforced natively by position: if the
    // native position is past 3s we seek to 0, else we step back.
    if (isAndroid()) {
      if (state.currentTime > 3) {
        state.seekTo(0);
        return;
      }
      try {
        await unifiedPrevious();
      } catch (e) {
        console.warn("Native previous failed, falling back to JS queue:", e);
      }
      if (state.currentPlaylist.length > 0) return;
    }
    const list = state.currentPlaylist.length > 0 ? state.currentPlaylist : state.tracks;
    if (list.length === 0) return;

    // If more than 3 seconds into track, seek to 0 instead of previous track
    if (state.currentTime > 3) {
      state.seekTo(0);
      return;
    }

    const currentIndex = list.findIndex(
      (t) =>
        state.currentTrack &&
        (t.id === state.currentTrack.id || t.uri === state.currentTrack.uri),
    );

    let prevIndex = list.length - 1;
    if (currentIndex > 0) {
      prevIndex = currentIndex - 1;
    }

    const prevTrack = list[prevIndex];
    if (prevTrack) {
      await state.playTrack(prevTrack, list);
    }
  },

  seekTo(timeSecs) {
    if (Number.isFinite(timeSecs)) {
      void unifiedSeekTo(timeSecs);
      set({ currentTime: timeSecs });
    }
  },

  toggleRepeat() {
    const current = get().repeatMode;
    const next = current === "off" ? "all" : current === "all" ? "one" : "off";
    void unifiedSetRepeatMode(next);
    set({ repeatMode: next });
  },

  toggleShuffle() {
    const next = !get().shuffleMode;
    void unifiedSetShuffleMode(next);
    set({ shuffleMode: next });
  },

  setFullscreenOpen(open) {
    set({ fullscreenOpen: open });
  },

  setPlaybackRate(rate) {
    const clamped = Math.max(0.25, Math.min(4.0, rate));
    void unifiedSetSpeed(clamped);
    set({ playbackRate: clamped });
  },

  setVolumeGainPercent(gain) {
    const clamped = Math.max(0, Math.min(400, gain));
    try {
      // Routed through the shared WebAudio graph (with safe fallbacks inside).
      applyGainPercent(clamped);
    } catch (e) {
      console.warn("Failed to set gain value:", e);
      // Last-resort fallback so playback never goes silent.
      try {
        const fallback = getGlobalGainNode();
        if (fallback) fallback.gain.value = clamped / 100;
      } catch {}
    }
    set({ volumeGainPercent: clamped });
  },

  enterSelectionMode(initialTrack) {
    const key = initialTrack
      ? initialTrack.uri || initialTrack.path || initialTrack.id
      : null;
    set({
      isSelectionMode: true,
      selectedTrackKeys: key ? new Set([key]) : new Set(),
    });
  },

  exitSelectionMode() {
    set({ isSelectionMode: false, selectedTrackKeys: new Set() });
  },

  toggleSelectTrack(trackOrKey) {
    const key =
      typeof trackOrKey === "string"
        ? trackOrKey
        : trackOrKey.uri || trackOrKey.path || trackOrKey.id;
    const next = new Set(get().selectedTrackKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    set({
      selectedTrackKeys: next,
      isSelectionMode: next.size > 0 ? true : get().isSelectionMode,
    });
  },

  selectAllTracks(tracks) {
    const keys = new Set(tracks.map((t) => t.uri || t.path || t.id));
    set({ selectedTrackKeys: keys, isSelectionMode: true });
  },

  clearSelection() {
    set({ selectedTrackKeys: new Set() });
  },

  async deleteMultipleTracks(tracksToDelete) {
    if (tracksToDelete.length === 0) return;

    for (const track of tracksToDelete) {
      const targetKey = track.uri || track.path || track.id;
      try {
        await api.deleteAudioTrack(targetKey);
      } catch (e) {
        console.warn("Failed to delete track:", targetKey, e);
      }
    }

    const deleteKeySet = new Set(
      tracksToDelete.map((t) => t.uri || t.path || t.id),
    );

    const current = get().currentTrack;
    if (
      current &&
      (deleteKeySet.has(current.id) ||
        deleteKeySet.has(current.uri) ||
        (current.path && deleteKeySet.has(current.path)))
    ) {
      get().pauseTrack();
      set({ currentTrack: null, isPlaying: false, currentTime: 0 });
    }

    const deleteAliases = new Set(
      tracksToDelete.flatMap((t) => getTrackAliases(t)),
    );

    set((state) => {
      const nextLiked = new Set(state.likedPaths);
      deleteAliases.forEach((k) => nextLiked.delete(k));
      persistLikedPaths(nextLiked);

      const nextTracks = state.tracks.filter(
        (t) =>
          !deleteKeySet.has(t.id) &&
          !deleteKeySet.has(t.uri) &&
          (!t.path || !deleteKeySet.has(t.path)),
      );
      const nextPlaylist = state.currentPlaylist.filter(
        (t) =>
          !deleteKeySet.has(t.id) &&
          !deleteKeySet.has(t.uri) &&
          (!t.path || !deleteKeySet.has(t.path)),
      );

      const nextAlbums = state.customAlbums.map((album) => ({
        ...album,
        trackKeys: album.trackKeys.filter((k) => !deleteKeySet.has(k)),
      }));
      persistCustomAlbums(nextAlbums);

      return {
        tracks: nextTracks,
        currentPlaylist: nextPlaylist,
        customAlbums: nextAlbums,
        likedPaths: nextLiked,
        selectedTrackKeys: new Set(),
        isSelectionMode: false,
      };
    });
    try {
      persistCachedTracks(get().tracks);
    } catch {}
  },

  addMultipleTracksToAlbum(albumId, tracksToAdd) {
    const keys = tracksToAdd.map((t) => t.uri || t.path || t.id);
    set((state) => {
      const next = state.customAlbums.map((a) => {
        if (a.id === albumId) {
          const keySet = new Set(a.trackKeys);
          for (const k of keys) {
            keySet.add(k);
          }
          return { ...a, trackKeys: Array.from(keySet) };
        }
        return a;
      });
      persistCustomAlbums(next);
      return { customAlbums: next };
    });
  },

  async deleteTrack(track) {
    const targetKey = track.uri || track.path || track.id;
    try {
      await api.deleteAudioTrack(targetKey);
    } catch (e) {
      console.warn("Failed to delete track:", targetKey, e);
    }

    // If currently playing, stop playback
    const current = get().currentTrack;
    if (current && (current.id === track.id || current.uri === track.uri)) {
      get().pauseTrack();
      set({ currentTrack: null, isPlaying: false, currentTime: 0 });
    }

    // Remove from tracks and currentPlaylist
    set((state) => {
      const nextTracks = state.tracks.filter(
        (t) => t.id !== track.id && t.uri !== track.uri,
      );
      const nextPlaylist = state.currentPlaylist.filter(
        (t) => t.id !== track.id && t.uri !== track.uri,
      );
      return { tracks: nextTracks, currentPlaylist: nextPlaylist };
    });
    try {
      persistCachedTracks(get().tracks);
    } catch {}

    // Remove from liked if present
    const isLiked = isTrackLiked(track, get().likedPaths);
    if (isLiked) {
      get().toggleLike(track);
    }

    // Remove from custom albums
    const aliases = getTrackAliases(track);
    set((state) => {
      const nextAlbums = state.customAlbums.map((a) => ({
        ...a,
        trackKeys: a.trackKeys.filter((k) => !aliases.includes(k)),
      }));
      persistCustomAlbums(nextAlbums);
      return { customAlbums: nextAlbums };
    });
  },

  async setRingtone(track) {
    const targetKey = track.uri || track.path || track.id;
    await api.setAsRingtone(targetKey);
  },

  async shareTrack(track) {
    const targetKey = track.uri || track.path || track.id;
    const title = track.title || track.name;
    const mime = track.mimeType || "audio/mpeg";

    // Try web navigator.share on platforms that support it
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title,
          text: `${title} - ${track.artist || "Audio Track"}`,
        });
        return;
      } catch {
        // Fallback to native backend command
      }
    }

    await api.shareAudioTrack(targetKey, title, mime);
  },

  // -------------------------------------------------------------------------
  // Custom Albums Actions
  // -------------------------------------------------------------------------

  createCustomAlbum(name) {
    const newAlbum: CustomAlbum = {
      id: `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim() || "Untitled Album",
      trackKeys: [],
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
    const next = [newAlbum, ...get().customAlbums];
    persistCustomAlbums(next);
    set({ customAlbums: next });
    return newAlbum.id;
  },

  renameCustomAlbum(albumId, newName) {
    const next = get().customAlbums.map((a) =>
      a.id === albumId
        ? { ...a, name: newName.trim() || a.name, updatedAtMs: Date.now() }
        : a,
    );
    persistCustomAlbums(next);
    set({ customAlbums: next });
  },

  deleteCustomAlbum(albumId) {
    const next = get().customAlbums.filter((a) => a.id !== albumId);
    persistCustomAlbums(next);
    set({ customAlbums: next });
  },

  addTrackToAlbum(albumId, track) {
    const key = getTrackKey(track);
    const next = get().customAlbums.map((a) => {
      if (a.id === albumId) {
        const exists = a.trackKeys.includes(key);
        const nextKeys = exists ? a.trackKeys : [...a.trackKeys, key];
        return { ...a, trackKeys: nextKeys, updatedAtMs: Date.now() };
      }
      return a;
    });
    persistCustomAlbums(next);
    set({ customAlbums: next });
  },

  removeTrackFromAlbum(albumId, track) {
    const aliases = getTrackAliases(track);
    const next = get().customAlbums.map((a) => {
      if (a.id === albumId) {
        const nextKeys = a.trackKeys.filter((k) => !aliases.includes(k));
        return { ...a, trackKeys: nextKeys, updatedAtMs: Date.now() };
      }
      return a;
    });
    persistCustomAlbums(next);
    set({ customAlbums: next });
  },

  isTrackInAlbum(albumId, track) {
    const album = get().customAlbums.find((a) => a.id === albumId);
    if (!album) return false;
    const aliases = getTrackAliases(track);
    return album.trackKeys.some((k) => aliases.includes(k));
  },
}));

bindMusicStore(useMusicPlayerStore);
