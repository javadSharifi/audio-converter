import { useEffect, useState } from "react";
import { Music2, Disc3 } from "lucide-react";
import type { AudioTrackInfo } from "../../types";
import {
  artworkCacheKey,
  getSyncArtworkSrc,
  resolveArtworkSrc,
} from "../../utils/artwork";

interface TrackCoverProps {
  track: Partial<AudioTrackInfo> & { title?: string | null; name?: string; artist?: string | null; coverUrl?: string | null };
  className?: string;
  size?: "sm" | "md" | "lg" | "full";
}

const GRADIENT_PALETTES = [
  "from-amber-500 via-orange-500 to-rose-600",
  "from-violet-600 via-purple-600 to-indigo-700",
  "from-rose-500 via-pink-600 to-purple-600",
  "from-cyan-500 via-teal-600 to-emerald-600",
  "from-blue-600 via-indigo-600 to-violet-700",
  "from-fuchsia-600 via-pink-600 to-rose-500",
  "from-emerald-500 via-teal-600 to-cyan-700",
  "from-orange-500 via-amber-600 to-yellow-600",
];

function getGradientIndex(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % GRADIENT_PALETTES.length;
}

export function TrackCover({ track, className = "", size = "md" }: TrackCoverProps): React.JSX.Element {
  const [imgFailed, setImgFailed] = useState(false);
  const [extractedSrc, setExtractedSrc] = useState<string | null>(null);
  const coverKey = track.id ?? track.coverUrl ?? null;

  useEffect(() => {
    setImgFailed(false);
  }, [coverKey]);

  // Lazy embedded-art extraction: covers that can't load directly
  // (missing coverUrl, or a dead legacy MediaStore albumart content:// URI)
  // are resolved on demand through the native artwork cache — the same cache
  // file the media notification uses for its artwork.
  const artKey = `${artworkCacheKey(track)}|${track.coverUrl ?? ""}`;
  useEffect(() => {
    let cancelled = false;
    setExtractedSrc(null);
    if (getSyncArtworkSrc(track)) return;
    void resolveArtworkSrc(track).then((src) => {
      if (!cancelled) setExtractedSrc(src);
    });
    return () => {
      cancelled = true;
    };
    // artKey carries every input resolveArtworkSrc depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artKey]);

  const identifier = (track.title || track.name || track.id || "track").trim();
  const paletteIndex = getGradientIndex(identifier + (track.artist || ""));
  const gradient = GRADIENT_PALETTES[paletteIndex];

  // Directly loadable cover wins; otherwise the lazily extracted one.
  const resolvedSrc = !imgFailed ? (getSyncArtworkSrc(track) ?? extractedSrc) : null;

  const dimensions =
    size === "sm"
      ? "h-9 w-9 rounded-xl text-xs"
      : size === "lg"
      ? "h-14 w-14 rounded-2xl text-base"
      : size === "full"
      ? "h-full w-full rounded-2xl text-lg"
      : "h-11 w-11 rounded-2xl text-sm";

  const iconSize =
    size === "sm"
      ? "h-4 w-4"
      : size === "lg"
      ? "h-7 w-7"
      : size === "full"
      ? "h-14 w-14"
      : "h-5 w-5";

  if (resolvedSrc) {
    return (
      <div
        className={`relative shrink-0 overflow-hidden shadow-sm border border-black/[0.08] dark:border-white/[0.08] bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center ${dimensions} ${className}`}
      >
        <img
          src={resolvedSrc}
          alt={track.title || track.name || "Cover"}
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover select-none"
          loading="lazy"
        />
      </div>
    );
  }

  // Default stylized album art placeholder
  return (
    <div
      className={`relative shrink-0 overflow-hidden shadow-sm border border-white/20 dark:border-white/10 bg-gradient-to-br ${gradient} flex items-center justify-center text-white select-none ${dimensions} ${className}`}
    >
      {/* Vinyl subtle groove rings overlay */}
      <div className="absolute inset-0 opacity-20 pointer-events-none flex items-center justify-center">
        <Disc3 className="h-full w-full stroke-[1]" />
      </div>

      {/* Glossy top shine */}
      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent pointer-events-none" />

      {/* Center Icon */}
      <Music2 className={`${iconSize} drop-shadow relative z-10`} strokeWidth={2.2} />
    </div>
  );
}
