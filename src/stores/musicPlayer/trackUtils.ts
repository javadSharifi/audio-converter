import type {
  AudioTrackInfo,
  MusicSortOption,
  CustomAlbum,
  AlbumItem,
} from "../../types";

export function getTrackKey(track: Partial<AudioTrackInfo>): string {
  return track.uri || track.id || track.path || "";
}

export function getTrackAliases(track: Partial<AudioTrackInfo>): string[] {
  return [track.uri, track.id, track.path].filter(Boolean) as string[];
}

export function isTrackLiked(
  trackOrKey: Partial<AudioTrackInfo> | string,
  likedSet: Set<string>,
  allTracks?: AudioTrackInfo[],
): boolean {
  if (typeof trackOrKey === "string") {
    if (likedSet.has(trackOrKey)) return true;
    if (allTracks) {
      const match = allTracks.find(
        (t) => t.id === trackOrKey || t.uri === trackOrKey || (t.path && t.path === trackOrKey),
      );
      if (match) {
        return getTrackAliases(match).some((k) => likedSet.has(k));
      }
    }
    return false;
  }
  return getTrackAliases(trackOrKey).some((k) => likedSet.has(k));
}

function latestTimestampMs(t: AudioTrackInfo): number {
  return Math.max(t.createdTimestampMs || 0, t.modifiedTimestampMs || 0);
}

/** Helper to filter & sort tracks according to search query and sort options */
export function filterAndSortTracks(
  tracks: AudioTrackInfo[],
  searchQuery: string,
  sortBy: MusicSortOption,
  likedPaths: Set<string>,
): AudioTrackInfo[] {
  let result = tracks;

  // Search filter
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    result = result.filter((t) => {
      const name = t.name.toLowerCase();
      const title = t.title?.toLowerCase() ?? "";
      const artist = t.artist?.toLowerCase() ?? "";
      const album = t.album?.toLowerCase() ?? "";
      const format = t.format.toLowerCase();
      return (
        name.includes(q) ||
        title.includes(q) ||
        artist.includes(q) ||
        album.includes(q) ||
        format.includes(q)
      );
    });
  }

  // Sort
  const sorted = [...result];
  switch (sortBy) {
    case "newest":
      sorted.sort((a, b) => latestTimestampMs(b) - latestTimestampMs(a));
      break;

    case "oldest":
      sorted.sort((a, b) => latestTimestampMs(a) - latestTimestampMs(b));
      break;

    case "liked":
      sorted.sort((a, b) => {
        const isALiked = isTrackLiked(a, likedPaths) ? 1 : 0;
        const isBLiked = isTrackLiked(b, likedPaths) ? 1 : 0;
        if (isALiked !== isBLiked) {
          return isBLiked - isALiked;
        }
        return latestTimestampMs(b) - latestTimestampMs(a);
      });
      break;

    case "title":
      sorted.sort((a, b) => {
        const titleA = (a.title || a.name).toLowerCase();
        const titleB = (b.title || b.name).toLowerCase();
        return titleA.localeCompare(titleB);
      });
      break;
  }

  return sorted;
}

/** Helper to compute custom and auto (artist-grouped) album items */
export function computeAllAlbums(
  allTracks: AudioTrackInfo[],
  customAlbums: CustomAlbum[],
): { custom: AlbumItem[]; auto: AlbumItem[] } {
  // 1. Compute Custom Albums (Row 1)
  const custom: AlbumItem[] = customAlbums.map((ca) => {
    const matchedTracks = ca.trackKeys
      .map((key) =>
        allTracks.find(
          (t) => t.id === key || t.uri === key || (t.path && t.path === key),
        ),
      )
      .filter((t): t is AudioTrackInfo => t !== undefined);

    // Latest added track becomes cover
    const coverTrack =
      matchedTracks.length > 0
        ? [...matchedTracks].sort((a, b) => latestTimestampMs(b) - latestTimestampMs(a))[0]
        : null;

    const totalDurationSecs = matchedTracks.reduce(
      (acc, t) => acc + (t.durationSecs || 0),
      0,
    );

    return {
      id: ca.id,
      name: ca.name,
      artist: null,
      isCustom: true,
      tracks: matchedTracks,
      coverTrack,
      totalDurationSecs,
      trackCount: matchedTracks.length,
    };
  });

  // 2. Compute Auto Albums (Grouped by Artist)
  const artistMap = new Map<string, AudioTrackInfo[]>();
  for (const track of allTracks) {
    const artist = (track.artist || "").trim() || "Unknown Artist";
    const existing = artistMap.get(artist) || [];
    existing.push(track);
    artistMap.set(artist, existing);
  }

  const auto: AlbumItem[] = Array.from(artistMap.entries()).map(([artist, tracks]) => {
    // Latest added track becomes cover
    const coverTrack =
      [...tracks].sort((a, b) => latestTimestampMs(b) - latestTimestampMs(a))[0] || null;

    const totalDurationSecs = tracks.reduce((acc, t) => acc + (t.durationSecs || 0), 0);

    return {
      id: `artist_${artist}`,
      name: artist,
      artist,
      isCustom: false,
      tracks,
      coverTrack,
      totalDurationSecs,
      trackCount: tracks.length,
    };
  });

  // Sort artists alphabetically
  auto.sort((a, b) => a.name.localeCompare(b.name));

  return { custom, auto };
}
