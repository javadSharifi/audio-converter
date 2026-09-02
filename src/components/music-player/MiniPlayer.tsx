import React, { useRef, useState, useEffect, useCallback } from "react";
import { useAppStore } from "../../stores/useAppStore";
import { useMusicPlayerStore } from "../../stores/useMusicPlayerStore";
import { translate } from "../../i18n";
import { TrackCover } from "./TrackCover";
import { Play, Pause, SkipBack, SkipForward, ChevronUp } from "lucide-react";

function formatTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "00:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

export function MiniPlayer(): React.JSX.Element | null {
  const lang = useAppStore((s) => s.lang);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const currentTime = useMusicPlayerStore((s) => s.currentTime);
  const duration = useMusicPlayerStore((s) => s.duration);
  const fullscreenOpen = useMusicPlayerStore((s) => s.fullscreenOpen);
  const setFullscreenOpen = useMusicPlayerStore((s) => s.setFullscreenOpen);
  const pauseTrack = useMusicPlayerStore((s) => s.pauseTrack);
  const resumeTrack = useMusicPlayerStore((s) => s.resumeTrack);
  const playPreviousTrack = useMusicPlayerStore((s) => s.playPreviousTrack);
  const playNextTrack = useMusicPlayerStore((s) => s.playNextTrack);
  const seekTo = useMusicPlayerStore((s) => s.seekTo);

  const seekbarRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState<number | null>(null);

  const progress =
    isDragging && dragProgress !== null
      ? dragProgress * 100
      : duration > 0
      ? (currentTime / duration) * 100
      : 0;

  const displayTime =
    isDragging && dragProgress !== null
      ? dragProgress * duration
      : currentTime;

  const calculateProgress = useCallback((clientX: number): number => {
    if (!seekbarRef.current) return 0;
    const rect = seekbarRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left;
    return Math.min(1, Math.max(0, clickX / rect.width));
  }, []);

  const handleSeekStart = (clientX: number) => {
    setIsDragging(true);
    const p = calculateProgress(clientX);
    setDragProgress(p);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    handleSeekStart(e.clientX);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.touches.length > 0) {
      handleSeekStart(e.touches[0].clientX);
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const p = calculateProgress(e.clientX);
      setDragProgress(p);
    };

    const handleMouseUp = (e: MouseEvent) => {
      const p = calculateProgress(e.clientX);
      setIsDragging(false);
      setDragProgress(null);
      if (duration > 0) {
        seekTo(p * duration);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const p = calculateProgress(e.touches[0].clientX);
        setDragProgress(p);
      }
    };

    const handleTouchEnd = () => {
      if (dragProgress !== null && duration > 0) {
        seekTo(dragProgress * duration);
      }
      setIsDragging(false);
      setDragProgress(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleTouchEnd);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isDragging, dragProgress, duration, seekTo, calculateProgress]);

  if (!currentTrack || fullscreenOpen) return null;

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlaying) {
      pauseTrack();
    } else {
      resumeTrack();
    }
  };

  const handlePrevious = (e: React.MouseEvent) => {
    e.stopPropagation();
    void playPreviousTrack();
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    void playNextTrack();
  };

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-35 w-full max-w-md px-3 sm:px-4 select-none animate-in slide-in-from-bottom duration-200">
      <div
        onClick={() => setFullscreenOpen(true)}
        className="group relative flex items-center justify-between gap-3 p-3 pt-3.5 rounded-3xl bg-white/95 dark:bg-zinc-900/95 hover:bg-white dark:hover:bg-zinc-900 border border-black/10 dark:border-white/15 shadow-[0_12px_36px_rgba(0,0,0,0.15)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.5)] backdrop-blur-2xl cursor-pointer transition-all duration-200 active:scale-98"
      >
        {/* ============================================================= */}
        {/* Interactive Scrubbable Top Progress Bar                       */}
        {/* ============================================================= */}
        <div
          ref={seekbarRef}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onClick={(e) => e.stopPropagation()}
          className="absolute -top-2.5 inset-x-3 h-6 flex items-center cursor-pointer group/bar touch-none z-20"
          title={`${formatTime(displayTime)} / ${formatTime(duration)}`}
        >
          {/* Track Bar Background */}
          <div className="relative w-full h-[3px] group-hover/bar:h-[5px] bg-black/10 dark:bg-white/15 rounded-full overflow-hidden transition-all duration-150">
            {/* Active Progress Fill - transition-none during drag for 0-lag tracking */}
            <div
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              className={`h-full bg-gradient-to-r from-orange-500 via-amber-400 to-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.5)] ${
                isDragging ? "transition-none" : "transition-all duration-100 ease-linear"
              }`}
            />
          </div>

          {/* Glowing Thumb Handle on hover/drag - transition-none during drag */}
          <div
            style={{ left: `${Math.min(100, Math.max(0, progress))}%` }}
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full bg-white border-2 border-orange-500 shadow-md shadow-orange-500/50 pointer-events-none ${
              isDragging
                ? "scale-125 opacity-100 transition-none"
                : "scale-0 group-hover/bar:scale-100 opacity-0 group-hover/bar:opacity-100 transition-transform duration-150"
            }`}
          />

          {/* Time Tooltip while dragging */}
          {isDragging && (
            <div
              style={{ left: `${Math.min(90, Math.max(10, progress))}%` }}
              className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded-lg bg-zinc-900 text-white text-[10px] font-mono font-bold shadow-lg border border-white/10 pointer-events-none"
            >
              {formatTime(displayTime)}
            </div>
          )}
        </div>

        {/* Left: Artwork + Title & Artist */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <TrackCover track={currentTrack} size="sm" />
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-extrabold text-zinc-900 dark:text-white truncate">
              {currentTrack.title || currentTrack.name}
            </span>
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
              {currentTrack.artist || "Unknown Artist"}
            </span>
          </div>
        </div>

        {/* Right: Controls (Previous, Play/Pause, Next) + Expand Arrow */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Previous Track Button */}
          <button
            type="button"
            onClick={handlePrevious}
            title={translate(lang, "previousSong")}
            aria-label={translate(lang, "previousSong")}
            className="flex h-8 w-8 items-center justify-center text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer active:scale-90"
          >
            <SkipBack className="h-4 w-4" />
          </button>

          {/* Play / Pause Toggle Button */}
          <button
            type="button"
            onClick={handleTogglePlay}
            title={translate(lang, isPlaying ? "pauseSong" : "playSong")}
            aria-label={translate(lang, isPlaying ? "pauseSong" : "playSong")}
            className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/30 transition-all active:scale-90 cursor-pointer hover:brightness-105"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current ms-0.5" />
            )}
          </button>

          {/* Next Track Button */}
          <button
            type="button"
            onClick={handleNext}
            title={translate(lang, "nextSong")}
            aria-label={translate(lang, "nextSong")}
            className="flex h-8 w-8 items-center justify-center text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer active:scale-90"
          >
            <SkipForward className="h-4 w-4" />
          </button>

          <div className="flex h-8 w-6 items-center justify-center text-zinc-400 dark:text-zinc-500 group-hover:text-orange-500 transition-colors">
            <ChevronUp className="h-4 w-4" />
          </div>
        </div>
      </div>
    </div>
  );
}
