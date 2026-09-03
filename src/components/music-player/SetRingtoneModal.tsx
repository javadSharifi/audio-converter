import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useAppStore } from "../../stores/useAppStore";
import { useMusicPlayerStore } from "../../stores/useMusicPlayerStore";
import { translate } from "../../i18n";
import { formatTimecode, parseTimeInput } from "../../utils/format";
import * as api from "../../utils/tauri";
import { isAndroid } from "../../utils/platform";
import { TrackCover } from "./TrackCover";
import {
  Bell,
  Play,
  Pause,
  X,
  Check,
  Sparkles,
  Minus,
  Plus,
} from "lucide-react";
import type { AudioTrackInfo } from "../../types";

type DragTarget = "start" | "end" | null;

const HANDLE_HIT_PX = 24;
const CANVAS_H = 120;

function formatClock(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "00:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

function safeConvertFileSrc(filePath: string): string {
  try {
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      return convertFileSrc(filePath);
    }
  } catch {
    /* fallback */
  }
  return filePath.startsWith("file://") ? filePath : `asset://${filePath}`;
}

async function resolveAudioSource(track: AudioTrackInfo): Promise<string> {
  if (track.uri && track.uri.startsWith("content://")) {
    try {
      const resolved = await api.resolveMediaPaths([track.uri]);
      if (
        resolved.length > 0 &&
        resolved[0].resolved &&
        !resolved[0].resolved.startsWith("STAGE_ERROR")
      ) {
        return safeConvertFileSrc(resolved[0].resolved);
      }
    } catch (e) {
      console.warn("Failed to resolve Android content URI:", e);
    }
  }

  const rawPath =
    track.path ||
    (track.uri && track.uri.startsWith("file://")
      ? decodeURIComponent(track.uri.replace(/^file:\/\//, ""))
      : track.uri);

  if (
    rawPath &&
    (rawPath.startsWith("http://") ||
      rawPath.startsWith("https://") ||
      rawPath.startsWith("data:") ||
      rawPath.startsWith("blob:"))
  ) {
    return rawPath;
  }

  return rawPath ? safeConvertFileSrc(rawPath) : "";
}

interface PaintArgs {
  peaks: [number, number][];
  duration: number;
  selStart: number;
  selEnd: number;
  playTime: number | null;
}

function drawWaveform(canvas: HTMLCanvasElement, args: PaintArgs): void {
  const { peaks, duration, selStart, selEnd, playTime } = args;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  if (w === 0) return;
  if (
    canvas.width !== Math.round(w * dpr) ||
    canvas.height !== Math.round(CANVAS_H * dpr)
  ) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(CANVAS_H * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, CANVAS_H);

  const xOf = (t: number) => {
    const frac = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
    return frac * w;
  };

  const mid = CANVAS_H / 2;
  const sX = xOf(selStart);
  const eX = xOf(selEnd);
  const lo = Math.min(sX, eX);
  const hi = Math.max(sX, eX);

  // 1. Shaded dark background for unselected regions
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, lo, CANVAS_H);
  ctx.fillRect(hi, 0, w - hi, CANVAS_H);

  // 2. Active highlighted background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, "rgba(249, 115, 22, 0.3)");
  grad.addColorStop(0.5, "rgba(249, 115, 22, 0.12)");
  grad.addColorStop(1, "rgba(249, 115, 22, 0.25)");
  ctx.fillStyle = grad;
  ctx.fillRect(lo, 0, hi - lo, CANVAS_H);

  // 3. Draw Waveform Peaks
  const n = peaks.length;
  if (n > 0 && w > 0) {
    const barW = w / n;
    for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) * barW;
      const inside = cx >= lo && cx <= hi;
      const [mn, mx] = peaks[i];
      const hMax = mid - 14;
      const yTop = mid - Math.abs(mx) * hMax;
      const yBot = mid + Math.abs(mn) * hMax;
      const barHeight = Math.max(yBot - yTop, 3);

      if (inside) {
        const barGrad = ctx.createLinearGradient(0, yTop, 0, yBot);
        barGrad.addColorStop(0, "#fb923c");
        barGrad.addColorStop(0.5, "#f97316");
        barGrad.addColorStop(1, "#ea580c");
        ctx.fillStyle = barGrad;
      } else {
        ctx.fillStyle = "rgba(140, 140, 160, 0.3)";
      }

      const bw = Math.max(barW * 0.75, 1.8);
      ctx.beginPath();
      const r = Math.min(bw / 2, 2.5);
      if (ctx.roundRect) {
        ctx.roundRect(cx - bw / 2, yTop, bw, barHeight, r);
      } else {
        ctx.rect(cx - bw / 2, yTop, bw, barHeight);
      }
      ctx.fill();
    }
  }

  // 4. Draw Draggable Boundary Handles
  const drawHandle = (x: number, isLeft: boolean) => {
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS_H);
    ctx.stroke();

    ctx.shadowColor = "rgba(249, 115, 22, 0.6)";
    ctx.shadowBlur = 10;

    const gripW = 12;
    const gripH = 40;
    const gripX = isLeft ? x - gripW + 1 : x - 1;
    const gripY = mid - gripH / 2;

    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(gripX, gripY, gripW, gripH, 6);
    } else {
      ctx.rect(gripX, gripY, gripW, gripH);
    }
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(gripX + gripW / 2 - 1.5, gripY + 11, 1.5, gripH - 22);
    ctx.fillRect(gripX + gripW / 2 + 0.5, gripY + 11, 1.5, gripH - 22);
  };

  drawHandle(lo, true);
  drawHandle(hi, false);

  // 5. Playhead Laser line & Top Indicator Badge
  if (playTime != null && duration > 0) {
    const px = xOf(playTime);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, CANVAS_H);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(px - 6, 0);
    ctx.lineTo(px + 6, 0);
    ctx.lineTo(px, 8);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

interface SetRingtoneModalProps {
  track: AudioTrackInfo;
  onClose: () => void;
}

export function SetRingtoneModal({
  track,
  onClose,
}: SetRingtoneModalProps): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const pushToast = useAppStore((s) => s.pushToast);
  const setRingtone = useMusicPlayerStore((s) => s.setRingtone);
  const pauseGlobalTrack = useMusicPlayerStore((s) => s.pauseTrack);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const draggingRef = useRef<DragTarget>(null);
  const playTimeRef = useRef<number | null>(null);
  const previewEndRef = useRef<number | null>(null);

  const duration = Math.max(5, track.durationSecs || 180);

  const [selStart, setSelStart] = useState<number>(0);
  const [selEnd, setSelEnd] = useState<number>(Math.min(30, duration));
  const [peaks, setPeaks] = useState<[number, number][] | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [isSetting, setIsSetting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Pause main player on open
  useEffect(() => {
    pauseGlobalTrack();
  }, [pauseGlobalTrack]);

  const clampT = useCallback(
    (t: number) => Math.min(duration, Math.max(0, t)),
    [duration],
  );

  // 1. Resolve Audio File & Waveform Peaks
  useEffect(() => {
    let alive = true;
    setPeaks(null);
    setSrcUrl(null);

    const prepare = async () => {
      const resolvedSrc = await resolveAudioSource(track);
      if (!alive) return;
      setSrcUrl(resolvedSrc || null);

      let localPath = track.path || track.uri;
      if (localPath) {
        api
          .waveformPeaks(
            localPath,
            Math.max(200, Math.min(1200, Math.round(duration * 30))),
          )
          .then((p) => {
            if (alive && p && p.length > 0) setPeaks(p);
          })
          .catch(() => {
            if (!alive) return;
            const count = 100;
            const synth: [number, number][] = [];
            for (let i = 0; i < count; i++) {
              const v =
                0.25 +
                0.7 * Math.abs(Math.sin(i * 0.16) * Math.cos(i * 0.08));
              synth.push([-v, v]);
            }
            setPeaks(synth);
          });
      } else {
        const count = 100;
        const synth: [number, number][] = [];
        for (let i = 0; i < count; i++) {
          const v =
            0.25 + 0.7 * Math.abs(Math.sin(i * 0.16) * Math.cos(i * 0.08));
          synth.push([-v, v]);
        }
        setPeaks(synth);
      }
    };

    void prepare();
    return () => {
      alive = false;
    };
  }, [track, duration]);

  // 2. Continuous Repaint on Playback or Dragging
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const a = audioRef.current;
    const scrubbing = draggingRef.current != null;
    playTimeRef.current =
      a && !a.paused ? a.currentTime : a && scrubbing ? a.currentTime : selStart;
    drawWaveform(canvas, {
      peaks,
      duration,
      selStart,
      selEnd,
      playTime: playTimeRef.current,
    });
  }, [duration, peaks, selEnd, selStart]);

  useEffect(() => {
    paint();
    if (!playing) {
      const onResize = () => paint();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    let raf = 0;
    const loop = () => {
      paint();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paint, playing, peaks]);

  // 3. Audio Audition / Scrubbing Helper
  const audition = useCallback(
    (t: number) => {
      const a = audioRef.current;
      if (!a || !srcUrl || duration <= 0) return;
      try {
        a.currentTime = Math.max(0, clampT(t) - 0.05);
        if (a.paused) void a.play().catch(() => {});
      } catch {
        /* ignore */
      }
    },
    [clampT, duration, srcUrl],
  );

  const stopAudition = useCallback(() => {
    const a = audioRef.current;
    if (a && !a.paused) a.pause();
  }, []);

  useEffect(() => stopAudition, [stopAudition]);

  // 4. Drag & Click Interactions
  const timeFromEvent = useCallback(
    (clientX: number): number => {
      const wrap = wrapRef.current;
      if (!wrap || duration <= 0) return 0;
      const rect = wrap.getBoundingClientRect();
      const frac = (clientX - rect.left) / rect.width;
      return clampT(frac * duration);
    },
    [clampT, duration],
  );

  const hitTest = useCallback(
    (clientX: number): DragTarget => {
      const wrap = wrapRef.current;
      if (!wrap || duration <= 0) return null;
      const rect = wrap.getBoundingClientRect();
      const px = clientX - rect.left;
      const toPx = (t: number) => (t / duration) * rect.width;
      const sx = toPx(selStart);
      const ex = toPx(selEnd);
      const ds = Math.abs(px - sx);
      const de = Math.abs(px - ex);
      if (ds < HANDLE_HIT_PX && ds <= de) return "start";
      if (de < HANDLE_HIT_PX && de < ds) return "end";
      return null;
    },
    [duration, selEnd, selStart],
  );

  const applyBound = useCallback(
    (which: Exclude<DragTarget, null>, t: number) => {
      let v = clampT(t);
      if (which === "start") {
        v = Math.min(v, selEnd - 0.5);
        v = clampT(v);
        setSelStart(v);
        if (audioRef.current) {
          try {
            audioRef.current.currentTime = v;
          } catch {
            /* ignore */
          }
        }
      } else {
        v = Math.max(v, selStart + 0.5);
        v = clampT(v);
        setSelEnd(v);
      }
    },
    [clampT, selEnd, selStart],
  );

  // 5. Play Selected Range strictly from selStart to selEnd
  const playSelection = useCallback(() => {
    const a = audioRef.current;
    if (!a || !srcUrl) return;

    if (!a.paused) {
      a.pause();
      setPlaying(false);
      return;
    }

    const cleanFrom = Math.max(0, Math.min(duration, selStart));
    const cleanTo = Math.max(cleanFrom + 0.1, Math.min(duration, selEnd));
    previewEndRef.current = cleanTo;

    // 1. Force set currentTime to selStart before play
    try {
      a.currentTime = cleanFrom;
    } catch {
      /* ignore */
    }

    // 2. Attach one-time listener on 'playing' event to ensure browser didn't reset to 0
    const onPlayingHandler = () => {
      if (Math.abs(a.currentTime - cleanFrom) > 0.4) {
        try {
          a.currentTime = cleanFrom;
        } catch {
          /* ignore */
        }
      }
      a.removeEventListener("playing", onPlayingHandler);
    };
    a.addEventListener("playing", onPlayingHandler);

    // 3. Initiate playback
    const playPromise = a.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setPlaying(true);
          if (Math.abs(a.currentTime - cleanFrom) > 0.4) {
            try {
              a.currentTime = cleanFrom;
            } catch {
              /* ignore */
            }
          }
        })
        .catch((err) => {
          console.warn("Play preview failed:", err);
          setPlaying(false);
        });
    }
  }, [duration, selEnd, selStart, srcUrl]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (peaks == null || duration <= 0) return;
      e.preventDefault();
      const target = hitTest(e.clientX);
      const t = timeFromEvent(e.clientX);
      if (target) {
        draggingRef.current = target;
        e.currentTarget.setPointerCapture(e.pointerId);
        audition(t);
        return;
      }

      // Click inside selection -> toggle preview
      if (t > selStart && t < selEnd) {
        playSelection();
        return;
      }

      // Click outside -> snap nearest bound
      const distToStart = Math.abs(t - selStart);
      const distToEnd = Math.abs(t - selEnd);
      const which: "start" | "end" = distToEnd < distToStart ? "end" : "start";
      applyBound(which, t);
      draggingRef.current = which;
      e.currentTarget.setPointerCapture(e.pointerId);
      audition(t);
    },
    [
      applyBound,
      audition,
      duration,
      hitTest,
      peaks,
      playSelection,
      selEnd,
      selStart,
      timeFromEvent,
    ],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = draggingRef.current;
      if (!target) return;
      const t = timeFromEvent(e.clientX);
      applyBound(target, t);
      audition(t);
    },
    [applyBound, audition, timeFromEvent],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* released */
      }
      stopAudition();
      // Reset playhead back to selStart on drag end
      if (audioRef.current && audioRef.current.paused) {
        try {
          audioRef.current.currentTime = selStart;
        } catch {
          /* ignore */
        }
      }
    },
    [selStart, stopAudition],
  );

  // Loop or stop precisely when reaching selEnd
  const onAudioTimeUpdate = useCallback(() => {
    const a = audioRef.current;
    if (!a || a.paused) return;
    const targetEnd = previewEndRef.current ?? selEnd;
    if (draggingRef.current == null && a.currentTime >= targetEnd) {
      a.pause();
      try {
        a.currentTime = selStart;
      } catch {
        /* ignore */
      }
      setPlaying(false);
      previewEndRef.current = null;
    }
  }, [selEnd, selStart]);

  const commitText = (field: "start" | "end", raw: string) => {
    const secs = parseTimeInput(raw);
    if (secs == null) {
      pushToast("error", translate(lang, "errTrimInvalid"));
      return;
    }
    applyBound(field, secs);
  };

  const adjustBound = (field: "start" | "end", delta: number) => {
    if (field === "start") {
      const next = clampT(selStart + delta);
      applyBound("start", next);
    } else {
      const next = clampT(selEnd + delta);
      applyBound("end", next);
    }
  };

  const handleApplyPreset = (presetSecs: number) => {
    stopAudition();
    setSelStart(0);
    setSelEnd(Math.min(duration, presetSecs));
    if (audioRef.current) {
      try {
        audioRef.current.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
  };

  const handleFullPreset = () => {
    stopAudition();
    setSelStart(0);
    setSelEnd(duration);
    if (audioRef.current) {
      try {
        audioRef.current.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
  };

  const handleConfirmSetRingtone = async () => {
    if (!isAndroid()) {
      pushToast("info", translate(lang, "ringtoneMobileOnly"));
      onClose();
      return;
    }

    setIsSetting(true);
    try {
      stopAudition();
      await setRingtone(track);
      setIsSuccess(true);
      pushToast("info", translate(lang, "ringtoneSetSuccess"));
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "PERMISSION_REQUIRED") {
        pushToast("warning", translate(lang, "ringtonePermissionRequired"));
      } else {
        console.warn("Set ringtone failed:", msg);
      }
    } finally {
      setIsSetting(false);
    }
  };

  const selLen = Math.max(0, selEnd - selStart);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-150 select-none">
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className="glass-card relative z-10 w-full max-w-lg rounded-3xl p-5 sm:p-6 flex flex-col gap-4.5 border border-black/10 dark:border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.4)] backdrop-blur-2xl animate-in zoom-in-95 duration-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ============================================================= */}
        {/* 1. Header (Title + Track Info + Close)                        */}
        {/* ============================================================= */}
        <div className="flex items-center justify-between pb-3 border-b border-black/[0.06] dark:border-white/[0.06]">
          <div className="flex items-center gap-3 min-w-0">
            <TrackCover track={track} size="sm" />
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5 text-orange-500" />
                <h2 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 truncate">
                  {translate(lang, "setAsRingtoneTitle")}
                </h2>
              </div>
              <span className="text-[11px] text-zinc-400 truncate">
                {track.title || track.name} • {track.artist || "Unknown Artist"}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] hover:bg-black/10 dark:bg-white/[0.08] dark:hover:bg-white/15 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ============================================================= */}
        {/* 2. Quick Presets (Segmented Pill Bar)                         */}
        {/* ============================================================= */}
        <div className="flex items-center justify-between gap-1.5 p-1 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/5 dark:border-white/5">
          <button
            type="button"
            onClick={() => handleApplyPreset(15)}
            className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 ${
              selStart === 0 && selEnd === Math.min(15, duration)
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/25"
                : "text-zinc-600 dark:text-zinc-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            }`}
          >
            {translate(lang, "ringtonePreset15")}
          </button>
          <button
            type="button"
            onClick={() => handleApplyPreset(30)}
            className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 ${
              selStart === 0 && selEnd === Math.min(30, duration)
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/25"
                : "text-zinc-600 dark:text-zinc-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            }`}
          >
            {translate(lang, "ringtonePreset30")}
          </button>
          <button
            type="button"
            onClick={() => handleApplyPreset(45)}
            className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 ${
              selStart === 0 && selEnd === Math.min(45, duration)
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/25"
                : "text-zinc-600 dark:text-zinc-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            }`}
          >
            {translate(lang, "ringtonePreset45")}
          </button>
          <button
            type="button"
            onClick={handleFullPreset}
            className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 ${
              selStart === 0 && selEnd === duration
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/25"
                : "text-zinc-600 dark:text-zinc-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            }`}
          >
            {translate(lang, "ringtoneFull")}
          </button>
        </div>

        {/* ============================================================= */}
        {/* 3. Waveform Canvas Surface with Handles                       */}
        {/* ============================================================= */}
        <div className="relative flex flex-col gap-1.5">
          <div
            dir="ltr"
            ref={wrapRef}
            className={`relative select-none overflow-hidden rounded-2xl bg-black/[0.04] p-1.5 border border-black/5 dark:bg-black/50 dark:border-white/5 shadow-inner ${
              peaks ? "cursor-ew-resize" : ""
            }`}
            style={{ height: CANVAS_H + 12 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <canvas ref={canvasRef} className="h-full w-full touch-none rounded-xl" />

            {/* Floating Handle Time Tags (Strictly Left to Right) */}
            <div className="absolute top-2 left-3 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md text-[10px] font-mono font-bold text-amber-400 border border-amber-400/20 pointer-events-none">
              {formatClock(selStart)}
            </div>
            <div className="absolute top-2 right-3 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md text-[10px] font-mono font-bold text-amber-400 border border-amber-400/20 pointer-events-none">
              {formatClock(selEnd)}
            </div>

            {!peaks && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs font-medium text-zinc-400">
                <div className="flex items-center gap-1">
                  <span className="h-4 w-1 rounded-full bg-orange-500/60 animate-[pulse_1s_ease-in-out_infinite]" />
                  <span className="h-6 w-1 rounded-full bg-orange-500/80 animate-[pulse_1s_ease-in-out_0.2s_infinite]" />
                  <span className="h-8 w-1 rounded-full bg-orange-500 animate-[pulse_1s_ease-in-out_0.4s_infinite]" />
                  <span className="h-5 w-1 rounded-full bg-orange-500/70 animate-[pulse_1s_ease-in-out_0.6s_infinite]" />
                  <span className="h-3 w-1 rounded-full bg-orange-500/50 animate-[pulse_1s_ease-in-out_0.8s_infinite]" />
                </div>
                <span className="animate-pulse">{translate(lang, "trimLoading")}</span>
              </div>
            )}
          </div>
        </div>

        {/* ============================================================= */}
        {/* 4. Fine-Tuning Steppers & Large Preview Button                */}
        {/* ============================================================= */}
        <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/5 dark:border-white/5">
          {/* Start Adjuster */}
          <div className="flex flex-col items-start gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              {translate(lang, "trimStart")}
            </span>
            <div className="flex items-center gap-1" dir="ltr">
              <button
                type="button"
                onClick={() => adjustBound("start", -1)}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/[0.04] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-300 active:scale-95 cursor-pointer"
                title="-1s"
              >
                <Minus className="h-3 w-3" />
              </button>
              <input
                type="text"
                defaultValue={formatTimecode(selStart)}
                key={`s-${selStart}`}
                placeholder="0:00.0"
                onBlur={(e) => commitText("start", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="w-18 h-7 text-center font-mono font-bold text-xs rounded-lg bg-white dark:bg-zinc-800 border border-black/10 dark:border-white/10 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-orange-500"
              />
              <button
                type="button"
                onClick={() => adjustBound("start", 1)}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/[0.04] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-300 active:scale-95 cursor-pointer"
                title="+1s"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Central Play/Pause Preview Button (Plays from selStart) */}
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={playSelection}
              disabled={!srcUrl}
              className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/35 hover:brightness-105 active:scale-90 transition-all cursor-pointer disabled:opacity-40 ${
                playing ? "ring-4 ring-orange-500/30" : ""
              }`}
              title={translate(lang, "previewRingtone")}
            >
              {playing ? (
                <Pause className="h-5 w-5 fill-current" strokeWidth={0} />
              ) : (
                <Play className="h-5 w-5 fill-current ms-0.5" strokeWidth={0} />
              )}
            </button>
            <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400">
              {translate(lang, "previewRingtone")}
            </span>
          </div>

          {/* End Adjuster */}
          <div className="flex flex-col items-end gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              {translate(lang, "trimEnd")}
            </span>
            <div className="flex items-center gap-1" dir="ltr">
              <button
                type="button"
                onClick={() => adjustBound("end", -1)}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/[0.04] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-300 active:scale-95 cursor-pointer"
                title="-1s"
              >
                <Minus className="h-3 w-3" />
              </button>
              <input
                type="text"
                defaultValue={formatTimecode(selEnd)}
                key={`e-${selEnd}`}
                placeholder={formatTimecode(duration)}
                onBlur={(e) => commitText("end", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="w-18 h-7 text-center font-mono font-bold text-xs rounded-lg bg-white dark:bg-zinc-800 border border-black/10 dark:border-white/10 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-orange-500"
              />
              <button
                type="button"
                onClick={() => adjustBound("end", 1)}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/[0.04] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-300 active:scale-95 cursor-pointer"
                title="+1s"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Selected Duration Banner */}
        <div className="flex items-center justify-between text-xs px-1 text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400 font-bold">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{translate(lang, "selectedDuration")}:</span>
            <span className="font-mono text-xs">{formatTimecode(selLen)}</span>
          </div>
          <span className="font-mono text-[11px] text-zinc-400">
            {formatClock(selStart)} → {formatClock(selEnd)} ({formatClock(duration)})
          </span>
        </div>

        {/* ============================================================= */}
        {/* 5. Bottom Confirm Actions                                     */}
        {/* ============================================================= */}
        <div className="flex gap-2 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-2xl bg-black/[0.05] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 text-xs font-bold transition-all cursor-pointer active:scale-95"
          >
            {translate(lang, "cancel")}
          </button>

          <button
            type="button"
            disabled={isSetting || isSuccess}
            onClick={handleConfirmSetRingtone}
            className="flex-1 py-2.5 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 hover:brightness-105 text-white text-xs font-bold shadow-md shadow-orange-500/25 transition-all cursor-pointer active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {isSuccess ? (
              <>
                <Check className="h-4 w-4 stroke-[3]" />
                <span>{translate(lang, "ringtoneSetSuccess")}</span>
              </>
            ) : isSetting ? (
              <span>{translate(lang, "ringtoneTrimming")}</span>
            ) : (
              <>
                <Bell className="h-4 w-4" />
                <span>{translate(lang, "confirmSetRingtone")}</span>
              </>
            )}
          </button>
        </div>

        {/* Hidden audio element driving audition and selection playback */}
        {srcUrl && (
          <audio
            ref={audioRef}
            src={srcUrl}
            preload="auto"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={onAudioTimeUpdate}
            onError={() => {
              setSrcUrl(null);
              setPlaying(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
