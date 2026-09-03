import type { AudioTrackInfo, CustomAlbum, MusicSortOption } from "../../types";

const LIKED_STORAGE_KEY = "player-liked-tracks";
const FOLDERS_STORAGE_KEY = "player-custom-folders";
const SORT_STORAGE_KEY = "player-sort-by";
const ALBUMS_STORAGE_KEY = "player-custom-albums";
const TRACKS_CACHE_KEY = "player-tracks-cache-v1";
const MAX_CACHED_TRACKS = 3000;

export function loadLikedPaths(): Set<string> {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(LIKED_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          return new Set(arr);
        }
      }
    }
  } catch {}
  return new Set();
}

export function persistLikedPaths(set: Set<string>) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LIKED_STORAGE_KEY, JSON.stringify(Array.from(set)));
    }
  } catch {}
}

export function loadSavedSort(): MusicSortOption {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(SORT_STORAGE_KEY);
      if (saved === "newest" || saved === "oldest" || saved === "liked" || saved === "title") {
        return saved;
      }
    }
  } catch {}
  return "newest";
}

export function persistSavedSort(sort: MusicSortOption) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SORT_STORAGE_KEY, sort);
    }
  } catch {}
}

export function loadCustomFolders(): string[] {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(FOLDERS_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    }
  } catch {}
  return [];
}

export function persistCustomFolders(folders: string[]) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
    }
  } catch {}
}

export function loadCustomAlbums(): CustomAlbum[] {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(ALBUMS_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    }
  } catch {}
  return [];
}

export function persistCustomAlbums(albums: CustomAlbum[]) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ALBUMS_STORAGE_KEY, JSON.stringify(albums));
    }
  } catch {}
}

/** Instantly-available snapshot of the last successful library scan. */
export function loadCachedTracks(): AudioTrackInfo[] {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(TRACKS_CACHE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          return arr.filter(
            (t) =>
              t &&
              typeof t === "object" &&
              typeof (t as AudioTrackInfo).uri === "string" &&
              typeof (t as AudioTrackInfo).id === "string",
          ) as AudioTrackInfo[];
        }
      }
    }
  } catch {}
  return [];
}

export function persistCachedTracks(tracks: AudioTrackInfo[]) {
  try {
    if (typeof localStorage !== "undefined") {
      const slim = tracks.slice(0, MAX_CACHED_TRACKS);
      localStorage.setItem(TRACKS_CACHE_KEY, JSON.stringify(slim));
    }
  } catch {
    // Quota exceeded — try a smaller slice once before giving up.
    try {
      if (typeof localStorage !== "undefined") {
        const slim = tracks.slice(0, 1000);
        localStorage.setItem(TRACKS_CACHE_KEY, JSON.stringify(slim));
      }
    } catch {}
  }
}
