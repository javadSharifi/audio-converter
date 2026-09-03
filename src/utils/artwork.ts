import { convertFileSrc } from "@tauri-apps/api/core";
import type { AudioTrackInfo } from "../types";
import { getTrackArtworkUrl } from "./tauri";

type TrackLike = Partial<AudioTrackInfo> & {
  title?: string | null;
  name?: string;
  artist?: string | null;
  coverUrl?: string | null;
};

/** In-memory cover cache: artwork key -> resolved src (or null = known missing). */
const memoryCache = new Map<string, string | null>();
/** Dedup concurrent extractions for the same track. */
const inflight = new Map<string, Promise<string | null>>();

/** Stable identity for one track's artwork (matches the native cache key input). */
export function artworkCacheKey(track: TrackLike): string {
  return track.uri || track.path || track.id || "";
}

/**
 * In-memory cache key. Must include coverUrl: the same audio ref can point
 * at a new cover after a rescan — keying on the uri alone would keep serving
 * the removed cover.
 */
function memoryKey(track: TrackLike): string {
  return `${artworkCacheKey(track)}|${track.coverUrl ?? ""}`;
}

/**
 * Legacy MediaStore `content://media/external/audio/albumart/...` URIs look
 * like covers but no longer resolve on Android 10+ and can never load inside
 * a WebView `<img>` — treat them as missing so embedded art is extracted.
 */
export function isUnresolvedCoverUrl(coverUrl: string | null | undefined): boolean {
  if (!coverUrl) return true;
  return coverUrl.startsWith("content://");
}

function toLoadableSrc(coverUrl: string): string | null {
  if (
    coverUrl.startsWith("http://") ||
    coverUrl.startsWith("https://") ||
    coverUrl.startsWith("asset://") ||
    coverUrl.startsWith("data:") ||
    coverUrl.startsWith("blob:")
  ) {
    return coverUrl;
  }
  if (coverUrl.startsWith("content://")) return null;
  try {
    return convertFileSrc(coverUrl);
  } catch {
    return null;
  }
}

/**
 * Synchronous fast path: directly loadable covers (http/data/asset/local
 * file path). Returns null when the cover needs async extraction (or when
 * there is no cover at all — use `isUnresolvedCoverUrl` to tell apart).
 */
export function getSyncArtworkSrc(track: TrackLike): string | null {
  if (!track.coverUrl) return null;
  return toLoadableSrc(track.coverUrl);
}

function audioRefOf(track: TrackLike): string {
  return track.uri || track.path || "";
}

/**
 * Full resolution with lazy embedded-art extraction:
 * 1. directly loadable coverUrl -> that src (cached in memory),
 * 2. else extract the embedded picture via the native `get_track_artwork`
 *    command (cached natively + in memory, shared with the media notification),
 * 3. else null (UI shows its gradient placeholder).
 */
export function resolveArtworkSrc(track: TrackLike): Promise<string | null> {
  if (!artworkCacheKey(track)) return Promise.resolve(null);
  const key = memoryKey(track);

  const syncSrc = getSyncArtworkSrc(track);
  if (syncSrc) {
    memoryCache.set(key, syncSrc);
    return Promise.resolve(syncSrc);
  }

  const cached = memoryCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const ongoing = inflight.get(key);
  if (ongoing) return ongoing;

  const audioRef = audioRefOf(track);
  if (!audioRef) return Promise.resolve(null);

  const task = getTrackArtworkUrl(audioRef)
    .then((src) => {
      memoryCache.set(key, src);
      return src;
    })
    .catch(() => {
      memoryCache.set(key, null);
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, task);
  return task;
}

/**
 * Drop cached covers (call after tracks are deleted). Takes audio refs
 * (uri || path || id) and removes every entry derived from them, so a later
 * track reusing the same uri never inherits the deleted track's cover.
 */
export function evictArtworkCache(audioRefs?: string[]): void {
  if (!audioRefs) {
    memoryCache.clear();
    return;
  }
  for (const ref of audioRefs) {
    memoryCache.delete(ref);
    const prefix = `${ref}|`;
    for (const k of Array.from(memoryCache.keys())) {
      if (k.startsWith(prefix)) memoryCache.delete(k);
    }
  }
}

/** Test-only hook to reset module state. */
export function __clearArtworkCachesForTests(): void {
  memoryCache.clear();
  inflight.clear();
}
