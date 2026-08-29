import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../stores/useAppStore";
import { translate } from "../i18n";
import { formatTimecode, parseTimeInput } from "../utils/format";
import * as api from "../utils/tauri";
import type { InputFile } from "../types";

/**
 * Interactive trim editor.
 *
 * A canvas draws the file's REAL waveform (decoded by the bundled ffmpeg).
 * Two handles drag to set start/end; while a handle drags (or the selection
 * plays) the audio is auditioned through an <audio> element fed by an
 * asset:// URL — no new JS dependencies, no bundled player library.
 *
 * Interaction model:
 * - drag handles → adjust that bound; audio "scrubs" near the handle edge
 * - click inside selection → play just the selection (stops at its end)
 * - click outside selection → move nearest bound to the clicked time
 */

type DragTarget = "start" | "end" | null;

const HANDLE_HIT_PX = 20;
const CANVAS_H = 104;

interface PaintArgs {
  peaks: [number, number][];
  duration: number;
  selStart: number | null;
  selEnd: number | null;
  playTime: number | null;
}

function drawWaveform(canvas: HTMLCanvasElement, args: PaintArgs): void {
  const { peaks, duration, selStart, selEnd, playTime } = args;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  if (w === 0) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(CANVAS_H * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(CANVAS_H * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, CANVAS_H);

  // x position for a time t (strictly left-to-right chronological).
  const xOf = (t: number) => {
    const frac = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
    return frac * w;
  };

  const mid = CANVAS_H / 2;
  const sX = selStart != null ? xOf(selStart) : 0;
  const eX = selEnd != null ? xOf(selEnd) : w;
  const lo = Math.min(sX, eX);
  const hi = Math.max(sX, eX);

  // Selected background highlight
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, "rgba(249, 115, 22, 0.18)");
  grad.addColorStop(1, "rgba(249, 115, 22, 0.04)");
  ctx.fillStyle = grad;
  ctx.fillRect(lo, 0, hi - lo, CANVAS_H);

  // Dimmed regions outside selection
  ctx.fillStyle = "rgba(10, 10, 15, 0.35)";
  ctx.fillRect(0, 0, lo, CANVAS_H);
  ctx.fillRect(hi, 0, w - hi, CANVAS_H);

  // Waveform bars
  const n = peaks.length;
  if (n > 0 && w > 0) {
    const barW = w / n;
    for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) * barW;
      const inside = cx >= lo && cx <= hi;
      const [mn, mx] = peaks[i];
      const hMax = mid - 10;
      const yTop = mid - Math.abs(mx) * hMax;
      const yBot = mid + Math.abs(mn) * hMax;
      const barHeight = Math.max(yBot - yTop, 2.5);

      ctx.fillStyle = inside ? "#f97316" : "rgba(150, 150, 165, 0.35)";
      const bw = Math.max(barW * 0.75, 1.5);
      
      // Draw rounded capsule bar
      ctx.beginPath();
      const r = Math.min(bw / 2, 2);
      ctx.roundRect ? ctx.roundRect(cx - bw / 2, yTop, bw, barHeight, r) : ctx.rect(cx - bw / 2, yTop, bw, barHeight);
      ctx.fill();
    }
  }

  // Draw Handle Lines & Grips
  const drawHandle = (x: number, isLeft: boolean) => {
    // Vertical luminous line
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS_H);
    ctx.stroke();

    // iOS style handle pill grip at center
    const gripW = 10;
    const gripH = 34;
    const gripX = isLeft ? x - gripW + 1 : x - 1;
    const gripY = mid - gripH / 2;

    ctx.fillStyle = "#f97316";
    ctx.shadowColor = "rgba(249, 115, 22, 0.4)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(gripX, gripY, gripW, gripH, 5);
    } else {
      ctx.rect(gripX, gripY, gripW, gripH);
    }
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner grip line
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(gripX + gripW / 2 - 0.75, gripY + 8, 1.5, gripH - 16);
  };

  // Always draw start and end handles
  drawHandle(lo, true);
  drawHandle(hi, false);

  // Playhead with top triangle indicator
  if (playTime != null && duration > 0) {
    const px = xOf(playTime);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, CANVAS_H);
    ctx.stroke();

    // Top triangle badge
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

export function TrimEditor({ file }: { file: InputFile }): React.JSX.Element | null {
  const lang = useAppStore((s) => s.lang);
  const setTrim = useAppStore((s) => s.setTrim);
  const pushToast = useAppStore((s) => s.pushToast);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const draggingRef = useRef<DragTarget>(null);
  const playTimeRef = useRef<number | null>(null);

  const [peaks, setPeaks] = useState<[number, number][] | null>(null);
  const [waveErr, setWaveErr] = useState(false);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const duration = file.durationSecs;
  const selStart = file.trimStartSecs ?? null;
  const selEnd = file.trimEndSecs ?? null;
  const hasSelection = selStart != null || selEnd != null;

  const clampT = useCallback(
    (t: number) => Math.min(duration, Math.max(0, t)),
    [duration],
  );

  // ---- Load waveform + playable URL -------------------------------------
  useEffect(() => {
    let alive = true;
    setPeaks(null);
    setWaveErr(false);
    setSrcUrl(null);
    api
      .waveformPeaks(file.path, Math.max(200, Math.min(1600, Math.round(duration * 40))))
      .then((p) => {
        if (alive) setPeaks(p);
      })
      .catch(() => {
        if (alive) setWaveErr(true);
      });
    // convertFileSrc is synchronous but wrapped for a uniform async flow.
    api
      .fileToAssetUrl(file.path)
      .then((u) => {
        if (alive) setSrcUrl(u);
      })
      .catch(() => {
        if (alive) setSrcUrl(null); // preview unavailable; editing still works
      });
    return () => {
      alive = false;
    };
  }, [file.path, duration]);

  // ---- Painting (rAF only while needed) -----------------------------------
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const a = audioRef.current;
    const scrubbing = draggingRef.current != null;
    playTimeRef.current =
      a && !a.paused ? a.currentTime : a && scrubbing ? a.currentTime : null;
    drawWaveform(canvas, {
      peaks,
      duration,
      selStart,
      selEnd,
      playTime: playTimeRef.current,
    });
  }, [duration, peaks, selEnd, selStart]);

  useEffect(() => {
    paint(); // immediate repaint on state change
    // Animate the playhead continuously ONLY while audio is playing —
    // an idle editor costs zero CPU.
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

  // ---- Audition while dragging --------------------------------------------
  /** Play a short snippet starting slightly before the moving edge. */
  const audition = useCallback(
    (t: number) => {
      const a = audioRef.current;
      if (!a || !srcUrl || duration <= 0) return;
      a.currentTime = Math.max(0, clampT(t) - 0.08);
      if (a.paused) void a.play().catch(() => {});
    },
    [clampT, duration, srcUrl],
  );

  const stopAudition = useCallback(() => {
    const a = audioRef.current;
    if (a && !a.paused) a.pause();
  }, []);

  // Stop playback when leaving the editor or switching files.
  useEffect(() => stopAudition, [stopAudition, file.path]);

  // ---- Pointer interaction -----------------------------------------------
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

  /** Which bound is nearest to pixel x? Mirrors drawn handle positions. */
  const hitTest = useCallback(
    (clientX: number): DragTarget => {
      const wrap = wrapRef.current;
      if (!wrap || duration <= 0) return null;
      const rect = wrap.getBoundingClientRect();
      const px = clientX - rect.left;
      const toPx = (t: number) => (t / duration) * rect.width;
      const sx = toPx(selStart ?? 0);
      const ex = toPx(selEnd ?? duration);
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
        const curEnd = selEnd ?? duration;
        v = Math.min(v, curEnd - 0.05);
        v = clampT(v);
        setTrim(file.path, "trimStartSecs", v);
      } else {
        const curStart = selStart ?? 0;
        v = Math.max(v, curStart + 0.05);
        v = clampT(v);
        setTrim(file.path, "trimEndSecs", v);
      }
    },
    [clampT, duration, file.path, selEnd, selStart, setTrim],
  );

  // Stable ref to selection playback for pointer-down handler.
  const playSelectionRef = useRef<() => void>(() => {});
  const previewEndRef = useRef<number | null>(null);

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

      const curStart = selStart ?? 0;
      const curEnd = selEnd ?? duration;

      // Click inside an existing selection → audition it.
      if (hasSelection && t > curStart && t < curEnd) {
        playSelectionRef.current();
        return;
      }

      // Click outside → snap the NEARER bound here and drag it.
      const distToStart = Math.abs(t - curStart);
      const distToEnd = Math.abs(t - curEnd);
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
      hasSelection,
      hitTest,
      peaks,
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
        /* pointer already released */
      }
      stopAudition();
    },
    [stopAudition],
  );

  // ---- Selection & Preview playback ---------------------------------------
  const playPreviewRange = useCallback(
    (from: number, to: number) => {
      const a = audioRef.current;
      if (!a || !srcUrl) return;
      const cleanFrom = Math.max(0, Math.min(duration, from));
      const cleanTo = Math.max(cleanFrom, Math.min(duration, to));
      if (cleanTo - cleanFrom <= 0.01) return;

      previewEndRef.current = cleanTo;
      a.currentTime = cleanFrom;
      void a.play().catch(() => {});
    },
    [duration, srcUrl],
  );

  const previewFirst10 = useCallback(() => {
    const start = selStart ?? 0;
    const end = selEnd ?? duration;
    const targetEnd = Math.min(start + 10, end);
    playPreviewRange(start, targetEnd);
  }, [duration, playPreviewRange, selEnd, selStart]);

  const previewLast10 = useCallback(() => {
    const start = selStart ?? 0;
    const end = selEnd ?? duration;
    const targetStart = Math.max(end - 10, start);
    playPreviewRange(targetStart, end);
  }, [duration, playPreviewRange, selEnd, selStart]);

  const playSelection = useCallback(() => {
    const a = audioRef.current;
    if (!a || !srcUrl) return;
    const from = selStart ?? 0;
    const to = selEnd ?? duration;
    if (to - from <= 0.01) return;

    if (!a.paused) {
      a.pause();
      return;
    }
    playPreviewRange(from, to);
  }, [duration, playPreviewRange, selEnd, selStart, srcUrl]);

  useEffect(() => {
    playSelectionRef.current = playSelection;
  }, [playSelection]);

  // Enforce the selection end during playback.
  const onAudioTimeUpdate = useCallback(() => {
    const a = audioRef.current;
    if (!a || a.paused) return;
    const targetEnd = previewEndRef.current ?? (selEnd ?? duration);
    if (draggingRef.current == null && a.currentTime >= targetEnd) {
      a.pause();
      a.currentTime = targetEnd;
      previewEndRef.current = null;
    }
  }, [duration, selEnd]);

  const clearTrim = useCallback(() => {
    setTrim(file.path, "trimStartSecs", null);
    setTrim(file.path, "trimEndSecs", null);
    stopAudition();
  }, [file.path, setTrim, stopAudition]);

  const commitText = (field: "trimStartSecs" | "trimEndSecs", raw: string) => {
    if (raw.trim() === "") {
      setTrim(file.path, field, null);
      return;
    }
    const secs = parseTimeInput(raw);
    if (secs == null) {
      pushToast("error", "errTrimInvalid");
      return;
    }
    applyBound(field === "trimStartSecs" ? "start" : "end", secs);
  };

  if (!file.hasAudio) return null;

  const selLen = Math.max(0, (selEnd ?? duration) - (selStart ?? 0));

  return (
    <div className="glass-card mt-3 flex flex-col gap-3.5 rounded-2xl p-4 md:p-5 border border-black/5 dark:border-white/10 shadow-lg shadow-black/5">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-black/[0.04] pb-3 dark:border-white/[0.04]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold tracking-tight text-zinc-800 dark:text-zinc-100">
            {translate(lang, "trimTitle")}
          </span>
          <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400">
            {formatTimecode(duration)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={playSelection}
            disabled={!srcUrl}
            data-testid={`trim-play-${file.name}`}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-3.5 py-1.5 text-xs font-bold text-white shadow-md shadow-orange-500/25 hover:brightness-105 active:scale-95 transition-all disabled:opacity-40"
            aria-label={translate(lang, "trimPlay")}
          >
            <span>{playing ? "⏸" : "▶"}</span>
            <span>{translate(lang, "trimPlay")}</span>
          </button>

          {duration >= 10.05 && (
            <>
              <button
                onClick={previewFirst10}
                data-testid={`trim-cut-first-${file.name}`}
                className="glass-card rounded-xl px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:border-orange-400 hover:text-orange-600 dark:text-zinc-300 transition-all active:scale-95 flex items-center gap-1"
                title={lang === "fa" ? "پیش‌نمایش ۱۰ ثانیه اول بازه انتخاب‌شده" : "Preview first 10s of selection"}
              >
                <span>▶</span>
                <span>{translate(lang, "trimCutFirst10")}</span>
              </button>
              <button
                onClick={previewLast10}
                data-testid={`trim-cut-last-${file.name}`}
                className="glass-card rounded-xl px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:border-orange-400 hover:text-orange-600 dark:text-zinc-300 transition-all active:scale-95 flex items-center gap-1"
                title={lang === "fa" ? "پیش‌نمایش ۱۰ ثانیه آخر بازه انتخاب‌شده" : "Preview last 10s of selection"}
              >
                <span>▶</span>
                <span>{translate(lang, "trimCutLast10")}</span>
              </button>
            </>
          )}

          {hasSelection && (
            <button
              onClick={clearTrim}
              data-testid={`trim-clear-${file.name}`}
              className="rounded-xl bg-red-500/10 px-2.5 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-500/20 active:scale-95 transition-all"
            >
              {translate(lang, "trimClear")}
            </button>
          )}
        </div>
      </div>

      {/* Waveform surface */}
      <div
        ref={wrapRef}
        className={`relative select-none overflow-hidden rounded-2xl bg-black/[0.04] p-1.5 border border-black/5 dark:bg-black/50 dark:border-white/5 ${peaks ? "cursor-ew-resize" : ""}`}
        style={{ height: CANVAS_H + 12 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        data-testid={`trim-editor-${file.name}`}
      >
        <canvas ref={canvasRef} className="h-full w-full touch-none rounded-xl" />
        {!peaks && !waveErr && (
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
        {waveErr && (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-red-400">
            {translate(lang, "trimWaveError")}
          </div>
        )}
      </div>

      {/* Precision inputs & selected duration footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs" dir="ltr">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            <span className="font-semibold text-zinc-500 dark:text-zinc-400">{translate(lang, "trimStart")}</span>
            <input
              type="text"
              defaultValue={selStart != null ? formatTimecode(selStart) : ""}
              key={`s-${file.path}-${selStart ?? "none"}`}
              placeholder="0:00.0"
              data-testid={`trim-start-text-${file.name}`}
              onBlur={(e) => commitText("trimStartSecs", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="glass-pill w-20 rounded-xl px-2.5 py-1.5 text-center font-semibold tabular-nums text-zinc-800 dark:text-zinc-200 outline-none"
            />
          </label>

          <span className="text-zinc-400">→</span>

          <label className="flex items-center gap-1.5">
            <span className="font-semibold text-zinc-500 dark:text-zinc-400">{translate(lang, "trimEnd")}</span>
            <input
              type="text"
              defaultValue={selEnd != null ? formatTimecode(selEnd) : ""}
              key={`e-${file.path}-${selEnd ?? "none"}`}
              placeholder={formatTimecode(duration)}
              data-testid={`trim-end-text-${file.name}`}
              onBlur={(e) => commitText("trimEndSecs", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="glass-pill w-20 rounded-xl px-2.5 py-1.5 text-center font-semibold tabular-nums text-zinc-800 dark:text-zinc-200 outline-none"
            />
          </label>
        </div>

        <div className="flex items-center gap-1.5 rounded-full bg-orange-500/10 px-3 py-1 text-xs font-bold text-orange-600 dark:text-orange-400 tabular-nums">
          <span>{translate(lang, "trimSelectedDuration")}:</span>
          <span>{formatTimecode(selLen)}</span>
          <span className="text-orange-400/60 font-normal">/ {formatTimecode(duration)}</span>
        </div>
      </div>

      {/* Hidden audio element drives audition + selection playback. */}
      {srcUrl && (
        <audio
          ref={audioRef}
          src={srcUrl}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={onAudioTimeUpdate}
        />
      )}
    </div>
  );
}
