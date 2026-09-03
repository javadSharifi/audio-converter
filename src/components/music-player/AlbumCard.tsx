import React, { useState } from "react";
import { useAppStore } from "../../stores/useAppStore";
import { useMusicPlayerStore } from "../../stores/useMusicPlayerStore";
import { translate } from "../../i18n";
import { TrackCover } from "./TrackCover";
import { Play, Pause, MoreVertical, Edit2, Trash2, Disc3, Sparkles } from "lucide-react";
import type { AlbumItem } from "../../types";

function formatDurationMin(secs: number): string {
  if (!secs || secs <= 0) return "";
  const m = Math.round(secs / 60);
  return `${m} min`;
}

interface AlbumCardProps {
  album: AlbumItem;
  onClick: () => void;
  onPlay: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}

export function AlbumCard({
  album,
  onClick,
  onPlay,
  onRename,
  onDelete,
}: AlbumCardProps): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);

  const [menuOpen, setMenuOpen] = useState(false);

  // Check if any track from this album is currently playing
  const isThisAlbumPlaying =
    currentTrack !== null &&
    isPlaying &&
    album.tracks.some((t) => t.id === currentTrack.id || t.uri === currentTrack.uri);

  return (
    <div
      onClick={onClick}
      className="group relative flex flex-col p-2 sm:p-3 rounded-2xl sm:rounded-3xl bg-black/[0.02] dark:bg-white/[0.03] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] border border-black/[0.05] dark:border-white/[0.05] transition-all duration-300 hover:shadow-xl hover:-translate-y-1 cursor-pointer select-none"
    >
      {/* Cover Image Wrapper (Aspect 1:1) */}
      <div className="relative aspect-square w-full rounded-xl sm:rounded-2xl overflow-hidden shadow-md bg-zinc-800 flex items-center justify-center">
        {album.coverTrack ? (
          <TrackCover track={album.coverTrack} size="full" />
        ) : (
          <div className="flex flex-col items-center justify-center w-full h-full bg-gradient-to-br from-orange-500/30 to-purple-600/30 text-zinc-400">
            <Disc3 className="h-8 w-8 sm:h-12 sm:w-12 opacity-60" />
          </div>
        )}

        {/* Custom Album Badge */}
        {album.isCustom && (
          <div className="absolute top-1.5 start-1.5 sm:top-2.5 sm:start-2.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[9px] sm:text-[10px] font-bold text-amber-400 border border-amber-400/30">
            <Sparkles className="h-2 w-2 sm:h-2.5 sm:w-2.5" />
            <span>{translate(lang, "myAlbums")}</span>
          </div>
        )}

        {/* 3-Dots Menu Button for Custom Albums */}
        {album.isCustom && (onRename || onDelete) && (
          <div
            className="absolute top-1.5 end-1.5 sm:top-2.5 sm:end-2.5"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
          >
            <button
              type="button"
              className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md text-white transition-colors cursor-pointer"
            >
              <MoreVertical className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            </button>

            {menuOpen && (
              <div
                className="absolute end-0 top-7 sm:top-8 z-30 w-32 sm:w-36 rounded-2xl bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 shadow-xl p-1 sm:p-1.5 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
              >
                {onRename && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onRename();
                    }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-[11px] sm:text-xs font-semibold text-zinc-700 dark:text-zinc-200 transition-colors"
                  >
                    <Edit2 className="h-3 w-3" />
                    <span>{translate(lang, "renameAlbum")}</span>
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-xl hover:bg-rose-500/10 text-[11px] sm:text-xs font-semibold text-rose-600 dark:text-rose-400 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>{translate(lang, "deleteAlbum")}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Quick Play Button on Card (Always visible on hover / active) */}
        {album.tracks.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            title={translate(lang, isThisAlbumPlaying ? "pauseSong" : "playAll")}
            className={`absolute bottom-2 end-2 sm:bottom-3 sm:end-3 flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/40 transition-all duration-300 cursor-pointer active:scale-90 ${
              isThisAlbumPlaying
                ? "scale-100 opacity-100"
                : "opacity-0 group-hover:opacity-100 group-hover:translate-y-0 translate-y-2"
            }`}
          >
            {isThisAlbumPlaying ? (
              <Pause className="h-4 w-4 sm:h-5 sm:w-5 fill-current" />
            ) : (
              <Play className="h-4 w-4 sm:h-5 sm:w-5 fill-current ms-0.5" />
            )}
          </button>
        )}
      </div>

      {/* Album Info Text Below */}
      <div className="flex flex-col mt-2 sm:mt-3 px-0.5">
        <h3 className="text-[11px] sm:text-xs md:text-sm font-extrabold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
          {album.name}
        </h3>
        <div className="flex items-center gap-1 text-[9px] sm:text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
          <span>
            {translate(lang, "totalTracksCount", { count: album.trackCount })}
          </span>
          {album.totalDurationSecs > 0 && <span>•</span>}
          {album.totalDurationSecs > 0 && (
            <span>{formatDurationMin(album.totalDurationSecs)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
