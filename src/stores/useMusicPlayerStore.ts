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
} from "./musicPlayer/persistence";
import {
  bindMusicStore,
  getGlobalAudio,
  getGlobalGainNode,
  resolveAudioSource,
} from "./musicPlayer/audioEngine";
import { getTrackKey, getTrackAliases, isTrackLiked } from "./musicPlayer/trackUtils";

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
  isLiked: (trackOrKey: AudioTrackInfo | string) => boolean;
  addCustomFolder: (path: string) => Promise<void>;
  removeCustomFolder: (path: string) => Promise<void>;

  // Playback actions
  playTrack: (track: AudioTrackInfo, playlist?: AudioTrackInfo[]) => Promise<void>;
  pauseTrack: () => void;
  resumeTrack: () => void;
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
  tracks: [],
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
    set({ loading: true });
    try {
      const targetDirs =
        customDirs ?? (get().customFolders.length > 0 ? get().customFolders : undefined);
      const tracks = await api.scanAudioFiles(targetDirs);
      set({ tracks, loading: false, hasScanned: true });
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
    const audio = getGlobalAudio();
    if (playlist) {
      set({ currentPlaylist: playlist });
    }

    const current = get().currentTrack;
    if (current && (current.id === track.id || current.uri === track.uri) && audio && audio.src) {
      if (audio.paused) {
        try {
          const p = audio.play();
          if (p && typeof p.catch === "function") {
            p.catch((err) => console.warn("Audio play error:", err));
          }
        } catch {}
        set({ isPlaying: true });
      }
      return;
    }

    if (audio) {
      try {
        audio.pause();
      } catch {}
      audio.currentTime = 0;
      set({
        currentTrack: track,
        isPlaying: true,
        currentTime: 0,
        duration: track.durationSecs || 0,
      });

      try {
        const src = await resolveAudioSource(track);
        const latest = get().currentTrack;
        if (!latest || getTrackKey(latest) !== getTrackKey(track)) {
          return;
        }
        audio.src = src;
        const p = audio.play();
        if (p && typeof p.catch === "function") {
          p.catch((err) => {
            console.warn("Audio play error:", err);
            set({ isPlaying: false });
          });
        }
      } catch (err) {
        console.warn("Failed to play track:", err);
        set({ isPlaying: false });
      }
    }
  },

  pauseTrack() {
    const audio = getGlobalAudio();
    if (audio) {
      try {
        audio.pause();
      } catch {}
      set({ isPlaying: false });
    }
  },

  resumeTrack() {
    const audio = getGlobalAudio();
    if (audio && audio.src) {
      try {
        const p = audio.play();
        if (p && typeof p.catch === "function") {
          p.catch((err) => console.warn("Audio resume error:", err));
        }
      } catch {}
      set({ isPlaying: true });
    }
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
    const audio = getGlobalAudio();
    if (audio && Number.isFinite(timeSecs)) {
      audio.currentTime = timeSecs;
      set({ currentTime: timeSecs });
    }
  },

  toggleRepeat() {
    const current = get().repeatMode;
    const next = current === "off" ? "all" : current === "all" ? "one" : "off";
    set({ repeatMode: next });
  },

  toggleShuffle() {
    set((s) => ({ shuffleMode: !s.shuffleMode }));
  },

  setFullscreenOpen(open) {
    set({ fullscreenOpen: open });
  },

  setPlaybackRate(rate) {
    const clamped = Math.max(0.25, Math.min(4.0, rate));
    const audio = getGlobalAudio();
    if (audio) {
      audio.playbackRate = clamped;
    }
    set({ playbackRate: clamped });
  },

  setVolumeGainPercent(gain) {
    const clamped = Math.max(0, Math.min(400, gain));
    const gainNode = getGlobalGainNode();
    if (gainNode) {
      try {
        gainNode.gain.value = clamped / 100;
      } catch (e) {
        console.warn("Failed to set gain value:", e);
      }
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
