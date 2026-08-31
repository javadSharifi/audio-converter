import React from "react";
import { useFileBooster } from "./hooks/useFileBooster";
import { PresetSelector } from "./PresetSelector";
import { GainSlider } from "./GainSlider";
import { ABPreview } from "./ABPreview";
import { formatBytes, formatDuration } from "../../../utils/format";
import { translate } from "../../../i18n";
import { useAppStore } from "../../../stores/useAppStore";
import type { AudioFormat } from "../../../types";
import { openPath } from "@tauri-apps/plugin-opener";
import { isAndroid } from "../../../utils/platform";

export function FileBoosterPage(): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const {
    file,
    preset,
    manualGainPercent,
    format,
    preview,
    activeAudition,
    isPlaying,
    currentTime,
    isPreviewGenerating,
    previewError,
    isExporting,
    exportProgress,
    exportSpeed,
    exportOutputs,
    exportError,
    pickFile,
    clearFile,
    setPreset,
    setManualGainPercent,
    setFormat,
    setActiveAudition,
    togglePlay,
    handleSeek,
    startExport,
  } = useFileBooster();

  const formats: AudioFormat[] = ["mp3", "m4a", "wav", "aac", "flac", "opus"];

  return (
    <div className="flex flex-col gap-4 pb-12">
      {/* File Picker Hero / Media Card */}
      {!file ? (
        <div
          onClick={pickFile}
          className="group relative flex min-h-[170px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-orange-500/25 bg-gradient-to-b from-orange-500/[0.04] to-transparent p-6 text-center shadow-sm transition-all duration-300 hover:border-orange-500/60 hover:bg-orange-500/[0.08] dark:border-orange-500/30 dark:hover:border-orange-500/70"
        >
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-orange-500/20 via-amber-500/20 to-orange-500/30 text-2xl text-orange-600 shadow-md shadow-orange-500/10 transition-transform duration-300 group-hover:scale-110 dark:text-orange-400">
            ⚡
          </div>
          <span className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
            {translate(lang, "selectBoosterFile")}
          </span>
          <span className="mt-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {translate(lang, "supportedFormatsDesc")}
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-3xl border border-black/[0.08] bg-white/85 p-4 shadow-sm backdrop-blur-md dark:border-white/[0.08] dark:bg-zinc-900/85">
          <div className="flex items-center gap-3.5 overflow-hidden">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-orange-500/20 to-amber-500/20 text-xl text-orange-600 shadow-sm dark:text-orange-400">
              🎵
            </div>
            <div className="flex flex-col truncate">
              <span className="truncate text-xs font-bold text-zinc-900 dark:text-zinc-100">
                {file.name}
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[10px] font-bold text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
                  {formatBytes(file.sizeBytes)}
                </span>
                <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[10px] font-bold text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
                  {formatDuration(file.durationSecs)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={pickFile}
              disabled={isExporting}
              className="rounded-xl bg-black/[0.04] px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-zinc-300 dark:hover:bg-white/[0.1] active:scale-95 transition-all"
            >
              {translate(lang, "changeFile")}
            </button>
            <button
              type="button"
              onClick={clearFile}
              disabled={isExporting}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-400 hover:bg-red-500/10 hover:text-red-500 dark:hover:bg-red-500/20 active:scale-95 transition-all"
              title={translate(lang, "removeFile" as any)}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Preset Selector */}
      <PresetSelector
        activePreset={preset}
        onSelectPreset={setPreset}
        disabled={!file || isExporting}
      />

      {/* Manual Gain Slider */}
      {preset === "manual" && (
        <GainSlider
          gainPercent={manualGainPercent}
          onChangeGain={setManualGainPercent}
          disabled={!file || isExporting}
        />
      )}

      {/* A/B Preview Component with Interactive Seeking */}
      <ABPreview
        preview={preview}
        activeAudition={activeAudition}
        onSelectAudition={setActiveAudition}
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        isLoading={isPreviewGenerating}
        currentTime={currentTime}
        duration={preview?.snippetDurationSecs || 12}
        onSeek={handleSeek}
        error={previewError}
      />

      {/* Output Format Picker & Export Action Bar */}
      {file && (
        <div className="flex flex-col gap-4 rounded-3xl border border-black/[0.08] bg-white/85 p-5 shadow-sm backdrop-blur-md dark:border-white/[0.08] dark:bg-zinc-900/85">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              {translate(lang, "format")}
            </span>
            <div className="flex gap-1.5">
              {formats.map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setFormat(fmt)}
                  disabled={isExporting}
                  className={`rounded-xl px-3 py-1.5 text-[11px] font-black uppercase transition-all active:scale-95 ${
                    format === fmt
                      ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/25"
                      : "bg-black/[0.04] text-zinc-600 hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-zinc-300 dark:hover:bg-white/[0.1]"
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          {/* Export Progress / Status */}
          {isExporting ? (
            <div className="flex flex-col gap-2 rounded-2xl bg-orange-500/10 p-3.5 text-xs dark:bg-orange-500/20">
              <div className="flex items-center justify-between font-bold text-orange-700 dark:text-orange-300">
                <span>{translate(lang, "statusProcessing")}...</span>
                <span>
                  {exportProgress ? `${exportProgress.toFixed(0)}%` : "0%"}
                  {exportSpeed ? ` (${exportSpeed})` : ""}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div
                  style={{ width: `${exportProgress ?? 0}%` }}
                  className="h-full bg-gradient-to-r from-orange-500 via-amber-400 to-orange-500 transition-all duration-200"
                />
              </div>
            </div>
          ) : exportError ? (
            <div className="rounded-2xl bg-red-500/10 p-3.5 text-xs font-bold text-red-600 dark:text-red-400">
              ⚠️ {exportError}
            </div>
          ) : exportOutputs.length > 0 ? (
            <div className="flex items-center justify-between rounded-2xl bg-emerald-500/10 p-3.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              <span>✓ {translate(lang, "statusCompleted")}!</span>
              {!isAndroid() && (
                <button
                  type="button"
                  onClick={() => {
                    const dir = exportOutputs[0].replace(/[\\/][^\\/]+$/, "");
                    void openPath(dir);
                  }}
                  className="underline underline-offset-2 hover:opacity-80"
                >
                  {translate(lang, "openOutputFolder")}
                </button>
              )}
            </div>
          ) : null}

          {/* Export Trigger Button */}
          <button
            type="button"
            disabled={!file || isExporting}
            onClick={startExport}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 py-3.5 text-sm font-extrabold text-white shadow-xl shadow-orange-500/25 transition-all duration-200 hover:brightness-105 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span>⚡</span>
            <span>
              {isExporting
                ? translate(lang, "statusProcessing")
                : translate(lang, "exportBoostedAudio")}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
