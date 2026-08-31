import React, { useState, useEffect, useRef, useCallback } from "react";
import { Volume2, RotateCcw } from "lucide-react";
import type { InputFile, BoosterPreset, AbPreviewResult } from "../../../types";
import { PresetSelector } from "./PresetSelector";
import { GainSlider } from "./GainSlider";
import { ABPreview } from "./ABPreview";
import { translate } from "../../../i18n";
import { useAppStore } from "../../../stores/useAppStore";
import * as api from "../../../utils/tauri";

interface FileBoosterInlineProps {
  file: InputFile;
}

export function FileBoosterInline({ file }: FileBoosterInlineProps): React.JSX.Element | null {
  const lang = useAppStore((s) => s.lang);
  const updateFileMeta = useAppStore((s) => s.updateFileMeta);

  const isBoostEnabled = file.boostEnabled ?? false;
  const currentPreset = file.boostPreset ?? "smart";
  const currentGain = file.boostManualGainPercent ?? 100;

  // A/B Audition preview state for this specific file
  const [preview, setPreview] = useState<AbPreviewResult | null>(null);
  const [isPreviewGenerating, setIsPreviewGenerating] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [activeAudition, setActiveAudition] = useState<"original" | "boosted">("boosted");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeqRef = useRef(0);

  // Generate preview for this file with strict request sequence matching (prevents race conditions)
  const requestPreview = useCallback(async () => {
    if (!file.path || !isBoostEnabled) {
      setPreview(null);
      return;
    }

    const seq = ++reqSeqRef.current;
    setIsPreviewGenerating(true);
    setPreviewError(null);

    try {
      const manualGain = currentPreset === "manual" ? currentGain : null;
      const res = await api.generateAbPreview(
        file.path,
        currentPreset,
        manualGain,
        null,
        15.0,
      );

      if (seq !== reqSeqRef.current) return; // Stale request, discard!
      setPreview(res);
    } catch (err: unknown) {
      if (seq !== reqSeqRef.current) return;
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === reqSeqRef.current) {
        setIsPreviewGenerating(false);
      }
    }
  }, [file.path, isBoostEnabled, currentPreset, currentGain]);

  // Debounced preview generation on preset, gain, or file change
  useEffect(() => {
    if (!isBoostEnabled || !file.path) {
      setPreview(null);
      return;
    }
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void requestPreview();
    }, 200);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [file.path, isBoostEnabled, currentPreset, currentGain, requestPreview]);

  // Manage audition audio playback seamlessly
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
  }, [preview, activeAudition]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current || !preview) return;
    const maxDur = preview.snippetDurationSecs || 12;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      // If at end of track, reset to beginning
      if (audioRef.current.currentTime >= maxDur - 0.1) {
        audioRef.current.currentTime = 0;
        setCurrentTime(0);
      }
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  const handleSeek = (timeSecs: number) => {
    if (audioRef.current && preview) {
      const maxDur = preview.snippetDurationSecs || 12;
      const clamped = Math.max(0, Math.min(maxDur, timeSecs));
      audioRef.current.currentTime = clamped;
      setCurrentTime(clamped);
    }
  };

  const handleToggleEnable = (enabled: boolean) => {
    updateFileMeta(file.path, {
      boostEnabled: enabled,
      boostPreset: file.boostPreset ?? "smart",
      boostManualGainPercent: file.boostManualGainPercent ?? 100,
    });
  };

  const handleSelectPreset = (preset: BoosterPreset) => {
    updateFileMeta(file.path, {
      boostEnabled: true,
      boostPreset: preset,
    });
  };

  const handleChangeGain = (gain: number) => {
    updateFileMeta(file.path, {
      boostEnabled: true,
      boostManualGainPercent: gain,
    });
  };

  const handleResetBoost = () => {
    updateFileMeta(file.path, {
      boostEnabled: false,
      boostPreset: "smart",
      boostManualGainPercent: 100,
    });
    setPreview(null);
    setCurrentTime(0);
  };

  if (!file.hasAudio) return null;

  return (
    <div className="glass-card mt-3 flex flex-col gap-4 rounded-2xl p-4 md:p-5 border border-orange-500/20 bg-gradient-to-b from-orange-500/[0.04] via-orange-500/[0.01] to-transparent shadow-lg shadow-black/5">
      {/* Top Header & Toggle */}
      <div className="flex items-center justify-between border-b border-black/[0.04] pb-3 dark:border-white/[0.04]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500/15 text-orange-600 dark:bg-orange-500/25 dark:text-orange-400 font-extrabold text-sm">
            <Volume2 className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div>
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
              {translate(lang, "fileBoosterTitle" as any)}
            </h3>
            <p className="text-[10.5px] font-medium text-zinc-500 dark:text-zinc-400">
              {translate(lang, "fileBoosterSubtitle" as any)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isBoostEnabled && (
            <button
              type="button"
              onClick={handleResetBoost}
              className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 hover:text-red-500 transition-colors"
              title={translate(lang, "reset" as any)}
            >
              <RotateCcw className="h-3 w-3" />
              <span>{translate(lang, "reset" as any)}</span>
            </button>
          )}

          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={isBoostEnabled}
              onChange={(e) => handleToggleEnable(e.target.checked)}
              className="peer sr-only"
            />
            <div className="peer h-6 w-11 rounded-full bg-zinc-300 after:absolute after:top-[2px] after:start-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-orange-500 peer-checked:after:translate-x-full peer-focus:outline-none dark:bg-zinc-700 rtl:peer-checked:after:-translate-x-full" />
          </label>
        </div>
      </div>

      {/* When Boost is enabled for this file */}
      {isBoostEnabled ? (
        <div className="flex flex-col gap-4 animate-in fade-in duration-200">
          {/* Preset Selector */}
          <PresetSelector
            activePreset={currentPreset}
            onSelectPreset={handleSelectPreset}
          />

          {/* Manual Gain Slider */}
          {currentPreset === "manual" && (
            <GainSlider
              gainPercent={currentGain}
              onChangeGain={handleChangeGain}
            />
          )}

          {/* Audition Player */}
          <div className="flex flex-col gap-1.5 pt-1">
            <label className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 px-1">
              {translate(lang, "abPreviewTitle")}
            </label>
            <ABPreview
              preview={preview}
              activeAudition={activeAudition}
              onSelectAudition={setActiveAudition}
              isPlaying={isPlaying}
              onTogglePlay={togglePlay}
              isLoading={isPreviewGenerating}
              currentTime={currentTime}
              duration={preview?.snippetDurationSecs || 15}
              onSeek={handleSeek}
              error={previewError}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
