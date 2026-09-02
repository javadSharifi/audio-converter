import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";

function formatTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "00:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

interface WaveformSeekbarProps {
  currentTime: number;
  duration: number;
  onSeek: (timeSecs: number) => void;
  trackSeed?: string;
}

const BAR_COUNT = 48;

/** Generate symmetrical waveform bar heights (0.15 to 1.0) */
function generateBars(seed: string, count: number): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }

  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    // Symmetrical bell-curve / envelope with energetic noise
    const progress = i / count;
    const envelope = Math.sin(progress * Math.PI); // 0 at ends, 1 at center
    const pseudoRandom = Math.abs(Math.sin((hash + i * 13.37) * 43758.5453));
    const height = Math.max(0.18, envelope * 0.7 + pseudoRandom * 0.3);
    bars.push(height);
  }
  return bars;
}

export function WaveformSeekbar({
  currentTime,
  duration,
  onSeek,
  trackSeed = "default_track",
}: WaveformSeekbarProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState<number | null>(null);

  const bars = useMemo(() => generateBars(trackSeed, BAR_COUNT), [trackSeed]);

  const activeProgress =
    isDragging && dragProgress !== null
      ? dragProgress
      : duration > 0
      ? Math.min(1, Math.max(0, currentTime / duration))
      : 0;

  const displayCurrentTime =
    isDragging && dragProgress !== null
      ? dragProgress * duration
      : currentTime;

  const calculateProgressFromEvent = useCallback(
    (clientX: number): number => {
      if (!containerRef.current) return 0;
      const rect = containerRef.current.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const progress = Math.min(1, Math.max(0, clickX / rect.width));
      return progress;
    },
    [],
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    const progress = calculateProgressFromEvent(e.clientX);
    setDragProgress(progress);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0) {
      setIsDragging(true);
      const progress = calculateProgressFromEvent(e.touches[0].clientX);
      setDragProgress(progress);
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const progress = calculateProgressFromEvent(e.clientX);
      setDragProgress(progress);
    };

    const handleMouseUp = (e: MouseEvent) => {
      const progress = calculateProgressFromEvent(e.clientX);
      setIsDragging(false);
      setDragProgress(null);
      if (duration > 0) {
        onSeek(progress * duration);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const progress = calculateProgressFromEvent(e.touches[0].clientX);
        setDragProgress(progress);
      }
    };

    const handleTouchEnd = () => {
      if (dragProgress !== null && duration > 0) {
        onSeek(dragProgress * duration);
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
  }, [isDragging, dragProgress, duration, onSeek, calculateProgressFromEvent]);

  return (
    <div className="flex flex-col w-full gap-2 select-none py-1">
      {/* Waveform Bars Container */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className="group relative flex items-center justify-between gap-[2.5px] sm:gap-[3px] h-12 w-full cursor-pointer touch-none px-1"
      >
        {bars.map((barHeight, idx) => {
          const barProgress = idx / BAR_COUNT;
          const isPlayed = barProgress <= activeProgress;

          return (
            <div
              key={idx}
              className="flex-1 flex items-center justify-center h-full transition-all duration-75"
            >
              <div
                style={{ height: `${Math.round(barHeight * 100)}%` }}
                className={`w-full rounded-full transition-colors duration-150 ${
                  isPlayed
                    ? "bg-gradient-to-t from-orange-500 via-amber-400 to-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.35)]"
                    : "bg-black/15 dark:bg-white/20 group-hover:bg-black/25 dark:group-hover:bg-white/30"
                }`}
              />
            </div>
          );
        })}
      </div>

      {/* Timestamps */}
      <div className="flex items-center justify-between text-xs font-mono font-semibold text-zinc-500 dark:text-zinc-400 px-1">
        <span>{formatTime(displayCurrentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
