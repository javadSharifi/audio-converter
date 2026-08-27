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

const HANDLE_HIT_PX = 18;
const CANVAS_H = 96;

interface PaintArgs {
  peaks: [number, number][];
  duration: number;
  selStart: number | null;
  selEnd: number | null;
  rtl: boolean;
  playTime: number | null;
}

function drawWaveform(canvas: HTMLCanvasElement, args: PaintArgs): void {
  const { peaks, duration, selStart, selEnd, rtl, playTime } = args;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  if (w === 0) return;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(CANVAS_H * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, CANVAS_H);

  // x position for a time t, honoring RTL canvases.
  const xOf = (t: number) => {
    const frac = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
    return rtl ? w - frac * w : frac * w;
  };

  const mid = CANVAS_H / 2;
  const sX = selStart != null ? xOf(selStart) : 0;
  const eX = selEnd != null ? xOf(selEnd) : w;
  const lo = Math.min(sX, eX);
  const hi = Math.max(sX, eX);

  // Dimmed regions outside the selection + selected band highlight.
  ctx.fillStyle = "rgba(120,120,130,0.16)";
  ctx.fillRect(0, 0, lo, CANVAS_H);
  ctx.fillRect(hi, 0, w - hi, CANVAS_H);
  ctx.fillStyle = "rgba(249,115,22,0.10)";
  ctx.fillRect(lo, 0, hi - lo, CANVAS_H);
  ctx.strokeStyle = "rgba(249,115,22,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(lo + 0.5, 0);
  ctx.lineTo(lo + 0.5, CANVAS_H);
  ctx.moveTo(hi - 0.5, 0);
  ctx.lineTo(hi - 0.5, CANVAS_H);
  ctx.stroke();

  // Waveform bars.
  const n = peaks.length;
  if (n > 0 && w > 0) {
    const barW = w / n;
    for (let i = 0; i < n; i++) {
      const cx = rtl ? w - (i + 0.5) * barW : (i + 0.5) * barW;
      const inside = cx >= lo && cx <= hi;
      const [mn, mx] = peaks[i];
      const yTop = mid - Math.abs(mx) * (mid - 6);
      const yBot = mid - Math.abs(mn) * (mid - 6);
      ctx.fillStyle = inside ? "#f97316" : "rgba(140,140,150,0.45)";
      const bw = Math.max(barW * 0.85, 1);
      ctx.fillRect(cx - bw / 2, yTop, bw, Math.max(yBot - yTop, 1.25));
    }
  }

  // Playhead.
  if (playTime != null && duration > 0) {
    const px = xOf(playTime);
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, CANVAS_H);
    ctx.stroke();
  }
}

export function TrimEditor({ file }: { file: InputFile }): React.JSX.Element | null {
  const lang = useAppStore((s) => s.lang);
  const rtl = lang === "fa";
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
      rtl,
      playTime: playTimeRef.current,
    });
  }, [duration, peaks, rtl, selEnd, selStart]);

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
      return clampT((rtl ? 1 - frac : frac) * duration);
    },
    [clampT, duration, rtl],
  );

  /** Which bound is nearest to pixel x? Mirrors drawn handle positions. */
  const hitTest = useCallback(
    (clientX: number): DragTarget => {
      const wrap = wrapRef.current;
      if (!wrap || duration <= 0) return null;
      const rect = wrap.getBoundingClientRect();
      const px = clientX - rect.left;
      const toPx = (t: number) => {
        const frac = t / duration;
        return rtl ? rect.width - frac * rect.width : frac * rect.width;
      };
      const sx = selStart != null ? toPx(selStart) : null;
      const ex = selEnd != null ? toPx(selEnd) : null;
      const ds = sx != null ? Math.abs(px - sx) : Infinity;
      const de = ex != null ? Math.abs(px - ex) : Infinity;
      if (ds < HANDLE_HIT_PX && ds <= de) return "start";
      if (de < HANDLE_HIT_PX && de < ds) return "end";
      return null;
    },
    [duration, rtl, selEnd, selStart],
  );

  const applyBound = useCallback(
    (which: Exclude<DragTarget, null>, t: number) => {
      const other = which === "start" ? selEnd : selStart;
      let v = clampT(t);
      if (other != null) {
        v = which === "start" ? Math.min(v, other - 0.05) : Math.max(v, other + 0.05);
      }
      v = clampT(v);
      setTrim(file.path, which === "start" ? "trimStartSecs" : "trimEndSecs", v);
    },
    [clampT, duration, file.path, selEnd, selStart, setTrim],
  );

  // Stable ref to selection playback for pointer-down handler.
  const playSelectionRef = useRef<() => void>(() => {});

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
      // Click inside an existing selection → audition it.
      const inSel =
        hasSelection &&
        (selStart == null || t >= selStart) &&
        (selEnd == null || t <= selEnd);
      if (inSel) {
        playSelectionRef.current();
        return;
      }
      // Click outside → snap the NEARER bound here and drag it.
      const distToStart =
        selStart != null ? Math.abs(t - selStart) : Infinity;
      const distToEnd = selEnd != null ? Math.abs(t - selEnd) : Infinity;
      const nearerEnd =
        selStart == null ? false : selEnd == null ? true : distToStart > distToEnd;
      applyBound(nearerEnd ? "end" : "start", t);
      draggingRef.current = nearerEnd ? "end" : "start";
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

  // ---- Selection playback -------------------------------------------------
  const playSelection = useCallback(() => {
    const a = audioRef.current;
    if (!a || !srcUrl) return;
    const from = selStart ?? 0;
    const to = selEnd ?? duration;
    if (to - from <= 0.01) return;
    // If playback is already inside the selection, resume; else restart it.
    if (
      !a.paused &&
      a.currentTime >= from - 0.05 &&
      a.currentTime < to - 0.05
    ) {
      a.pause();
      return;
    }
    a.currentTime = from;
    void a.play().catch(() => {});
  }, [duration, selEnd, selStart, srcUrl]);

  useEffect(() => {
    playSelectionRef.current = playSelection;
  }, [playSelection]);

  // Enforce the selection end during playback.
  const onAudioTimeUpdate = useCallback(() => {
    const a = audioRef.current;
    if (!a || a.paused) return;
    if (draggingRef.current == null && selEnd != null && a.currentTime >= selEnd) {
      a.pause();
      a.currentTime = selEnd;
    }
  }, [selEnd]);

  const clearTrim = useCallback(() => {
    setTrim(file.path, "trimStartSecs", null);
    setTrim(file.path, "trimEndSecs", null);
    stopAudition();
  }, [file.path, setTrim, stopAudition]);

  // One-click presets: shave 10 seconds off either end.
  const cutLast10 = useCallback(() => {
    if (duration < 10.05) return;
    applyBound("end", duration - 10);
  }, [applyBound, duration]);

  const cutFirst10 = useCallback(() => {
    if (duration < 10.05) return;
    applyBound("start", 10);
  }, [applyBound, duration]);

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
    <div className="mt-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium opacity-70">
          {translate(lang, "trimTitle")}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={playSelection}
            disabled={!srcUrl}
            data-testid={`trim-play-${file.name}`}
            className="rounded-md border border-zinc-200 px-2 py-1 text-xs hover:border-orange-400 dark:border-zinc-700 disabled:opacity-40"
            aria-label={translate(lang, "trimPlay")}
          >
            {playing ? "⏸" : "▶"} {translate(lang, "trimPlay")}
          </button>
          {duration >= 10.05 && (
            <>
              <button
                onClick={cutFirst10}
                data-testid={`trim-cut-first-${file.name}`}
                className="rounded-md border border-zinc-200 px-2 py-1 text-xs hover:border-orange-400 dark:border-zinc-700"
              >
                {translate(lang, "trimCutFirst10")}
              </button>
              <button
                onClick={cutLast10}
                data-testid={`trim-cut-last-${file.name}`}
                className="rounded-md border border-zinc-200 px-2 py-1 text-xs hover:border-orange-400 dark:border-zinc-700"
              >
                {translate(lang, "trimCutLast10")}
              </button>
            </>
          )}
          {hasSelection && (
            <button
              onClick={clearTrim}
              data-testid={`trim-clear-${file.name}`}
              className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-red-500 hover:border-red-400 dark:border-zinc-700"
            >
              {translate(lang, "trimClear")}
            </button>
          )}
        </div>
      </div>

      {/* Waveform surface */}
      <div
        ref={wrapRef}
        className={`relative select-none ${peaks ? "cursor-crosshair" : ""}`}
        style={{ height: CANVAS_H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        data-testid={`trim-editor-${file.name}`}
      >
        <canvas ref={canvasRef} className="h-full w-full touch-none" />
        {!peaks && !waveErr && (
          <div className="absolute inset-0 flex items-center justify-center text-xs opacity-50">
            {translate(lang, "trimLoading")}
          </div>
        )}
        {waveErr && (
          <div className="absolute inset-0 flex items-center justify-center text-xs opacity-50">
            {translate(lang, "trimWaveError")}
          </div>
        )}
      </div>

      {/* Precision inputs under the waveform */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <label className="flex items-center gap-1">
          <span className="opacity-60">{translate(lang, "trimStart")}</span>
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
            className="w-20 rounded-md border border-zinc-200 bg-transparent px-1.5 py-1 tabular-nums dark:border-zinc-700"
          />
        </label>
        <span className="opacity-40">→</span>
        <label className="flex items-center gap-1">
          <span className="opacity-60">{translate(lang, "trimEnd")}</span>
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
            className="w-20 rounded-md border border-zinc-200 bg-transparent px-1.5 py-1 tabular-nums dark:border-zinc-700"
          />
        </label>
        <span className="ms-auto tabular-nums opacity-60">
          {translate(lang, "trimSelectedDuration")}:{" "}
          <b className={hasSelection ? "text-orange-500" : ""}>
            {formatTimecode(selLen)}
          </b>{" "}
          / {formatTimecode(duration)}
        </span>
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
