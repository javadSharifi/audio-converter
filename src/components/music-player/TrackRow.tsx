import { memo, useEffect, useState, useRef } from "react";
import { useAppStore } from "../../stores/useAppStore";
import { useMusicPlayerStore, isTrackLiked } from "../../stores/useMusicPlayerStore";
import { translate } from "../../i18n";
import { TrackCover } from "./TrackCover";
import { TrackOptionsSheet } from "./TrackOptionsSheet";
import { ANDROID_BACK_EVENT, markBackConsumed, wasBackConsumed } from "../../utils/androidBack";
import { isAndroid } from "../../utils/platform";
import { Heart, Play, Pause, MoreVertical, Check, Square } from "lucide-react";
import type { AudioTrackInfo } from "../../types";

interface TrackRowProps {
  track: AudioTrackInfo;
  playlist?: AudioTrackInfo[];
}

export const TrackRow = memo(function TrackRow({ track, playlist }: TrackRowProps): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const likedPaths = useMusicPlayerStore((s) => s.likedPaths);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const playTrack = useMusicPlayerStore((s) => s.playTrack);
  const togglePlayTrack = useMusicPlayerStore((s) => s.togglePlayTrack);
  const setFullscreenOpen = useMusicPlayerStore((s) => s.setFullscreenOpen);

  const isSelectionMode = useMusicPlayerStore((s) => s.isSelectionMode);
  const selectedTrackKeys = useMusicPlayerStore((s) => s.selectedTrackKeys);
  const enterSelectionMode = useMusicPlayerStore((s) => s.enterSelectionMode);
  const toggleSelectTrack = useMusicPlayerStore((s) => s.toggleSelectTrack);

  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsOpenRef = useRef(false);
  optionsOpenRef.current = optionsOpen;

  // Android back: close this row's options sheet first. Without this, a press
  // made while the sheet is open (outside fullscreen, where NowPlayingView
  // does not cover it) would leak through to the app-level handler and start
  // navigation/exit behind the open sheet.
  useEffect(() => {
    if (!isAndroid()) return;
    const onBack = () => {
      if (wasBackConsumed()) return;
      if (!optionsOpenRef.current) return;
      setOptionsOpen(false);
      markBackConsumed();
    };
    window.addEventListener(ANDROID_BACK_EVENT, onBack as EventListener);
    return () => window.removeEventListener(ANDROID_BACK_EVENT, onBack as EventListener);
  }, []);

  const trackKey = track.uri || track.path || track.id;
  const isSelected =
    selectedTrackKeys.has(trackKey) ||
    selectedTrackKeys.has(track.id) ||
    selectedTrackKeys.has(track.uri);

  const isLiked = isTrackLiked(track, likedPaths);
  const isCurrentTrack =
    currentTrack !== null &&
    (currentTrack.id === track.id || currentTrack.uri === track.uri);
  const isNowPlaying = isCurrentTrack && isPlaying;

  // Long-press and hold detection
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressTriggered = useRef(false);

  const startLongPress = (clientX: number, clientY: number) => {
    if (isSelectionMode) return;
    startPosRef.current = { x: clientX, y: clientY };
    isLongPressTriggered.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressTriggered.current = true;
      try {
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(40);
        }
      } catch {}
      enterSelectionMode(track);
    }, 450);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      startLongPress(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!startPosRef.current || e.touches.length === 0) return;
    const dx = Math.abs(e.touches[0].clientX - startPosRef.current.x);
    const dy = Math.abs(e.touches[0].clientY - startPosRef.current.y);
    if (dx > 10 || dy > 10) {
      cancelLongPress();
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      startLongPress(e.clientX, e.clientY);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!startPosRef.current) return;
    const dx = Math.abs(e.clientX - startPosRef.current.x);
    const dy = Math.abs(e.clientY - startPosRef.current.y);
    if (dx > 10 || dy > 10) {
      cancelLongPress();
    }
  };

  const handleRowClick = () => {
    if (isLongPressTriggered.current) {
      isLongPressTriggered.current = false;
      return;
    }
    if (isSelectionMode) {
      toggleSelectTrack(track);
      return;
    }
    if (!isCurrentTrack) {
      void playTrack(track, playlist);
    }
    setFullscreenOpen(true);
  };

  const handlePlayButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSelectionMode) {
      toggleSelectTrack(track);
      return;
    }
    void togglePlayTrack(track, playlist);
  };

  return (
    <>
      <div
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={cancelLongPress}
        onMouseLeave={cancelLongPress}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={cancelLongPress}
        onTouchCancel={cancelLongPress}
        onClick={handleRowClick}
        className={`group flex items-center justify-between gap-3 py-3 px-3 rounded-2xl transition-all duration-200 cursor-pointer select-none ${
          isSelected
            ? "bg-orange-500/15 dark:bg-orange-500/20 border border-orange-500/40 shadow-sm"
            : isCurrentTrack
            ? "bg-orange-500/10 dark:bg-orange-500/15 border border-orange-500/30 dark:border-orange-500/30 shadow-sm"
            : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04] border border-transparent"
        }`}
      >
        {/* Leading: Album Art Cover & Metadata */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="shrink-0">
            <TrackCover track={track} size="md" />
          </div>

          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`text-xs sm:text-sm font-bold truncate transition-colors ${
                  isSelected || isCurrentTrack
                    ? "text-orange-600 dark:text-orange-400"
                    : "text-zinc-900 dark:text-zinc-100 group-hover:text-orange-600 dark:group-hover:text-orange-400"
                }`}
              >
                {track.title || track.name}
              </span>

              {/* Subtle mini Heart icon when liked */}
              {isLiked && (
                <Heart
                  className="h-3 w-3 text-rose-500 fill-rose-500 shrink-0"
                  strokeWidth={0}
                />
              )}

              {/* Equalizer icon badge next to title */}
              {!isSelectionMode && isNowPlaying && (
                <div
                  className="flex items-end gap-0.5 h-3.5 px-1 shrink-0"
                  title={translate(lang, "nowPlaying")}
                >
                  <span className="w-1 bg-orange-500 rounded-full animate-music-bar-1" />
                  <span className="w-1 bg-orange-500 rounded-full animate-music-bar-2" />
                  <span className="w-1 bg-orange-500 rounded-full animate-music-bar-3" />
                </div>
              )}
            </div>

            <div className="flex items-center text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
              <span>{track.artist || (lang === "fa" ? "هنرمند ناشناس" : "Unknown Artist")}</span>
            </div>
          </div>
        </div>

        {/* Trailing Side: Selection Checkbox (in Selection Mode) OR Play / Pause & 3-Dots Buttons */}
        {isSelectionMode ? (
          <div
            onClick={(e) => {
              e.stopPropagation();
              toggleSelectTrack(track);
            }}
            className="shrink-0 flex items-center justify-center p-1 cursor-pointer animate-in zoom-in-90 duration-150"
          >
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-xl border-2 transition-all duration-200 ${
                isSelected
                  ? "bg-orange-500 border-orange-500 text-white shadow-md shadow-orange-500/30 scale-105"
                  : "border-zinc-300 dark:border-zinc-600 bg-black/[0.03] dark:bg-white/[0.05] text-transparent hover:border-orange-400"
              }`}
            >
              {isSelected ? (
                <Check className="h-3.5 w-3.5 stroke-[3]" />
              ) : (
                <Square className="h-3.5 w-3.5 opacity-0" />
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            {/* Play / Pause Button */}
            <button
              type="button"
              onClick={handlePlayButtonClick}
              title={translate(lang, isNowPlaying ? "pauseSong" : "playSong")}
              aria-label={translate(lang, isNowPlaying ? "pauseSong" : "playSong")}
              className={`flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200 cursor-pointer active:scale-90 shadow-sm ${
                isNowPlaying
                  ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-orange-500/25 scale-105"
                  : isCurrentTrack
                  ? "bg-orange-500/20 text-orange-600 dark:text-orange-400 hover:bg-orange-500 hover:text-white"
                  : "text-zinc-600 bg-black/[0.04] hover:bg-orange-500 hover:text-white dark:text-zinc-300 dark:bg-white/[0.06] dark:hover:bg-orange-500 dark:hover:text-white"
              }`}
            >
              {isNowPlaying ? (
                <Pause className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current ms-0.5" />
              )}
            </button>

            {/* 3-Dots More Options Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOptionsOpen(true);
              }}
              title={translate(lang, "moreOptions")}
              aria-label={translate(lang, "moreOptions")}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-all duration-200 cursor-pointer active:scale-90"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* 3-Dots Bottom Sheet Modal */}
      {optionsOpen && (
        <TrackOptionsSheet
          track={track}
          onClose={() => setOptionsOpen(false)}
        />
      )}
    </>
  );
});
