import { useCallback, useEffect, useRef, useState } from "react";
import { useFileBoosterStore } from "../../stores/useFileBoosterStore";
import * as api from "../../../../utils/tauri";
import { pickVideos } from "../../../../utils/dialog";
import { listen } from "@tauri-apps/api/event";
import type { QueueItem } from "../../../../types";

export function useFileBooster() {
  const store = useFileBoosterStore();
  const {
    file,
    preset,
    manualGainPercent,
    format,
    quality,
    outputMode,
    customOutputDir,
    preview,
    activeAudition,
    isPlaying,
    setFile,
    setAnalysis,
    setIsAnalyzing,
    setPreview,
    setIsPreviewGenerating,
    setPreviewError,
    setActiveAudition,
    setIsPlaying,
    setIsExporting,
    setExportProgress,
    setExportOutputs,
    setExportError,
  } = store;

  const [currentTime, setCurrentTime] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const reqSeqRef = useRef(0);

  // Pick file via system dialog
  const pickFile = useCallback(async () => {
    try {
      const paths = await pickVideos();
      if (paths.length > 0) {
        const picked = paths[0];
        const stats = await api.statMediaPaths([picked]);
        if (stats.length > 0) {
          const st = stats[0];
          setFile({
            path: st.input,
            name: st.name,
            sizeBytes: st.sizeBytes,
            durationSecs: st.durationSecs ?? 0,
          });
          setCurrentTime(0);
        }
      }
    } catch (e) {
      console.error("Failed to pick file:", e);
    }
  }, [setFile]);

  // Set file directly (e.g. from Drag & Drop or Share Sheet)
  const setDirectFile = useCallback(
    async (filePath: string, fileName?: string) => {
      try {
        const metas = await api.statMediaPaths([filePath]);
        if (metas.length > 0) {
          const meta = metas[0];
          setFile({
            path: meta.input,
            name: fileName || meta.name,
            sizeBytes: meta.sizeBytes,
            durationSecs: meta.durationSecs ?? 0,
          });
          setCurrentTime(0);
        }
      } catch {
        setFile({
          path: filePath,
          name: fileName || filePath.split(/[\\/]/).pop() || "Audio File",
          sizeBytes: 0,
          durationSecs: 0,
        });
        setCurrentTime(0);
      }
    },
    [setFile],
  );

  // Generate preview with sequence matching to prevent race conditions during rapid slider changes
  const requestPreview = useCallback(async () => {
    const currentFile = useFileBoosterStore.getState().file;
    if (!currentFile?.path) return;

    const seq = ++reqSeqRef.current;
    setIsPreviewGenerating(true);
    setPreviewError(null);

    try {
      const res = await api.generateAbPreview(
        currentFile.path,
        preset,
        preset === "manual" ? manualGainPercent : null,
        null,
        15.0,
      );

      if (seq !== reqSeqRef.current) return;
      setPreview(res);
      if (res.analysis) {
        setAnalysis(res.analysis);
      }
    } catch (err: unknown) {
      if (seq !== reqSeqRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setPreviewError(msg);
    } finally {
      if (seq === reqSeqRef.current) {
        setIsPreviewGenerating(false);
        setIsAnalyzing(false);
      }
    }
  }, [preset, manualGainPercent, setIsPreviewGenerating, setPreviewError, setIsAnalyzing, setAnalysis, setPreview]);

  // Trigger preview update on file path, preset, or gain change
  useEffect(() => {
    if (!file?.path) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      void requestPreview();
    }, 200);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [file?.path, preset, manualGainPercent, requestPreview]);

  // Handle seeking within preview snippet
  const handleSeek = useCallback(
    (timeSecs: number) => {
      if (audioRef.current) {
        const maxDur = preview?.snippetDurationSecs || 15;
        const clamped = Math.max(0, Math.min(maxDur, timeSecs));
        audioRef.current.currentTime = clamped;
        setCurrentTime(clamped);
      }
    },
    [preview?.snippetDurationSecs],
  );

  // Manage Audio element source when preview or activeAudition changes
  useEffect(() => {
    if (!preview) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      setIsPlaying(false);
      setCurrentTime(0);
      return;
    }

    const currentPath =
      activeAudition === "original" ? preview.originalPath : preview.boostedPath;

    let cancelled = false;
    void api.fileToAssetUrl(currentPath).then((url) => {
      if (cancelled) return;

      if (!audioRef.current) {
        const audio = new Audio();
        audio.onended = () => {
          setIsPlaying(false);
          setCurrentTime(0);
        };
        audio.onerror = () => setIsPlaying(false);
        audio.ontimeupdate = () => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime || 0);
          }
        };
        audioRef.current = audio;
      }

      const audio = audioRef.current;
      if (audio.src !== url) {
        const wasPlaying = !audio.paused && audio.currentTime > 0;
        const prevTime = audio.currentTime || 0;

        audio.src = url;

        if (wasPlaying) {
          audio.currentTime = prevTime;
          audio.play().catch(() => setIsPlaying(false));
        } else {
          audio.currentTime = 0;
          setCurrentTime(0);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [preview?.originalPath, preview?.boostedPath, activeAudition, setIsPlaying]);

  // Toggle playback cleanly without reconstructing Audio instance
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const maxDur = preview?.snippetDurationSecs || 12;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      if (audio.currentTime >= maxDur - 0.1) {
        audio.currentTime = 0;
        setCurrentTime(0);
      }
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  }, [isPlaying, setIsPlaying, preview?.snippetDurationSecs]);

  // Stop playback on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
    };
  }, []);

  // Listen to queue events strictly for the active booster job
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<QueueItem>("job-event", (event) => {
      const ev = event.payload;
      if (!activeJobIdRef.current || ev.id !== activeJobIdRef.current) {
        return;
      }

      if (ev.status === "processing") {
        setExportProgress(ev.percent ?? 0, ev.speed);
      } else if (ev.status === "completed") {
        setExportProgress(100, null);
        setExportOutputs(ev.outputs);
        setIsExporting(false);
        activeJobIdRef.current = null;
      } else if (ev.status === "failed") {
        setExportError(ev.error || "Export failed");
        setIsExporting(false);
        activeJobIdRef.current = null;
      } else if (ev.status === "cancelled") {
        setIsExporting(false);
        activeJobIdRef.current = null;
      }
    }).then((fn) => (unlisten = fn));

    return () => {
      unlisten?.();
    };
  }, [setExportProgress, setExportOutputs, setIsExporting, setExportError]);

  // Start Export Job
  const startExport = useCallback(async () => {
    if (!file) return;

    setIsExporting(true);
    setExportProgress(0, null);
    setExportOutputs([]);
    setExportError(null);

    try {
      const jobIds = await api.startSoundBoost(
        [
          {
            trim: {
              path: file.path,
              startTimeSecs: null,
              endTimeSecs: null,
            },
            preset,
            manualGainPercent: preset === "manual" ? manualGainPercent : null,
          },
        ],
        {
          format,
          quality,
          customBitrateKbps: null,
          sampleRateHz: null,
          channels: null,
          splitEnabled: false,
          splitDurationSecs: 3600,
          removeSilence: false,
          silenceThresholdDb: -30,
          silenceMinDurationSecs: 2.0,
          outputMode,
          customOutputDir,
        },
      );

      if (jobIds && jobIds.length > 0) {
        activeJobIdRef.current = jobIds[0];
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setExportError(msg);
      setIsExporting(false);
      activeJobIdRef.current = null;
    }
  }, [file, preset, manualGainPercent, format, quality, outputMode, customOutputDir, setIsExporting, setExportProgress, setExportOutputs, setExportError]);

  return {
    ...store,
    currentTime,
    pickFile,
    setDirectFile,
    requestPreview,
    togglePlay,
    handleSeek,
    startExport,
    setActiveAudition,
  };
}
