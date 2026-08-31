import { useState } from "react";
import { Scissors, Volume2, Music, Trash2, Plus, X, Zap } from "lucide-react";
import { useAppStore } from "../stores/useAppStore";
import { translate } from "../i18n";
import { formatBytes, formatDuration } from "../utils/format";
import { pickVideos, isAudioPath } from "../utils/dialog";
import { TrimEditor } from "./TrimEditor";
import { FileBoosterInline } from "../features/sound-booster/file-booster/FileBoosterInline";
import type { InputFile } from "../types";

function boostBadgeLabel(file: InputFile, lang: "en" | "fa"): string {
  if (!file.boostEnabled) return "";
  if (file.boostPreset === "manual") {
    return `${file.boostManualGainPercent ?? 100}%`;
  }
  switch (file.boostPreset) {
    case "smart":
      return lang === "fa" ? "تقویت هوشمند" : "Smart Boost";
    case "music":
      return lang === "fa" ? "موسیقی" : "Music";
    case "extreme":
      return lang === "fa" ? "حداکثر صدا" : "Max Boost";
    default:
      return lang === "fa" ? "تقویت صدا" : "Boost";
  }
}

function FileRow({
  file,
  expandedMode,
  onToggleTrim,
  onToggleBoost,
}: {
  file: InputFile;
  expandedMode: "trim" | "boost" | null;
  onToggleTrim: () => void;
  onToggleBoost: () => void;
}): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const removeFile = useAppStore((s) => s.removeFile);
  const isAudio = file.kind === "audio" || isAudioPath(file.path);
  const boostLabel = boostBadgeLabel(file, lang);

  return (
    <>
      <tr className="border-b border-black/[0.04] transition-colors hover:bg-black/[0.02] dark:border-white/[0.04] dark:hover:bg-white/[0.02]">
        <td className="max-w-[260px] truncate px-3 py-2.5" title={file.path}>
          <div className="inline-flex items-center gap-1.5 me-2 align-middle">
            {/* Trim Button */}
            <button
              onClick={onToggleTrim}
              data-testid={`trim-toggle-${file.name}`}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-lg border align-middle text-[11px] font-medium transition-all ${
                expandedMode === "trim"
                  ? "border-orange-500 bg-orange-500 text-white shadow-sm shadow-orange-500/30"
                  : "border-black/10 bg-white/60 text-zinc-500 hover:border-orange-400 hover:text-orange-500 dark:border-white/10 dark:bg-zinc-800/60 dark:text-zinc-400"
              }`}
              aria-label={`${translate(lang, "trimEdit")} ${file.name}`}
              aria-expanded={expandedMode === "trim"}
              title={translate(lang, "trimTitle")}
            >
              <Scissors className="h-3 w-3" strokeWidth={2.2} />
            </button>

            {/* Sound Booster Button */}
            <button
              onClick={onToggleBoost}
              data-testid={`boost-toggle-${file.name}`}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-lg border align-middle text-[11px] font-medium transition-all ${
                expandedMode === "boost"
                  ? "border-orange-500 bg-orange-500 text-white shadow-sm shadow-orange-500/30"
                  : file.boostEnabled
                    ? "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:border-orange-500/40 dark:bg-orange-500/20 dark:text-orange-400"
                    : "border-black/10 bg-white/60 text-zinc-500 hover:border-orange-400 hover:text-orange-500 dark:border-white/10 dark:bg-zinc-800/60 dark:text-zinc-400"
              }`}
              aria-label={`Sound Boost ${file.name}`}
              aria-expanded={expandedMode === "boost"}
              title={translate(lang, "fileBoosterTitle" as any)}
            >
              <Volume2 className="h-3 w-3" strokeWidth={2.2} />
            </button>
          </div>

          {isAudio && (
            <span className="me-1 inline-flex items-center rounded bg-orange-500/10 p-1 align-middle text-orange-600 dark:text-orange-400" title="Audio">
              <Music className="h-2.5 w-2.5" strokeWidth={2.5} />
            </span>
          )}
          <span className="align-middle font-medium text-zinc-800 dark:text-zinc-200">{file.name}</span>
          {file.error && (
            <span className="block text-xs font-medium text-red-500">{file.error}</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">{formatBytes(file.sizeBytes)}</td>
        <td className="px-3 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {file.hasAudio ? formatDuration(file.durationSecs) : "—"}
        </td>
        <td className="px-3 py-2.5">
          <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
            {file.formatName.split(",")[0]}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {(file.trimStartSecs != null || file.trimEndSecs != null) && (
              <span
                data-testid={`trim-chip-${file.name}`}
                className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-orange-600 dark:text-orange-400"
              >
                ✂ {formatDuration(file.trimStartSecs ?? 0)} – {formatDuration(file.trimEndSecs ?? file.durationSecs)}
              </span>
            )}
            {file.boostEnabled && (
              <span
                data-testid={`boost-chip-${file.name}`}
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/25 dark:text-amber-300"
              >
                <Zap className="h-2.5 w-2.5" />
                <span>{boostLabel}</span>
              </span>
            )}
            {!file.trimStartSecs && !file.trimEndSecs && !file.boostEnabled && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">—</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5 text-end">
          <button
            onClick={() => removeFile(file.path)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-500"
            aria-label={translate(lang, "removeFile")}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        </td>
      </tr>
      {/* Expanded Accordion beneath row */}
      {expandedMode === "trim" && (
        <tr className="border-b border-black/[0.04] dark:border-white/[0.04]">
          <td colSpan={6} className="px-3 pb-4 pt-1">
            <TrimEditor key={`trim-${file.path}`} file={file} />
          </td>
        </tr>
      )}
      {expandedMode === "boost" && (
        <tr className="border-b border-black/[0.04] dark:border-white/[0.04]">
          <td colSpan={6} className="px-3 pb-4 pt-1">
            <FileBoosterInline key={`boost-${file.path}`} file={file} />
          </td>
        </tr>
      )}
    </>
  );
}

function MobileFileCard({
  file,
  expandedMode,
  onToggleTrim,
  onToggleBoost,
}: {
  file: InputFile;
  expandedMode: "trim" | "boost" | null;
  onToggleTrim: () => void;
  onToggleBoost: () => void;
}): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const removeFile = useAppStore((s) => s.removeFile);
  const isAudio = file.kind === "audio" || isAudioPath(file.path);
  const boostLabel = boostBadgeLabel(file, lang);

  return (
    <div className="glass-card flex flex-col rounded-2xl p-4 transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-semibold text-sm text-zinc-800 dark:text-zinc-100">
            {isAudio && (
              <span className="shrink-0 inline-flex items-center rounded-md bg-orange-500/10 p-1 text-orange-600 dark:text-orange-400">
                <Music className="h-3 w-3" strokeWidth={2.5} />
              </span>
            )}
            <span className="truncate" title={file.path}>{file.name}</span>
          </div>
          {file.error && (
            <span className="mt-1 block text-xs font-medium text-red-500">{file.error}</span>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-medium">
            <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[10px] font-bold uppercase dark:bg-white/[0.06]">
              {file.formatName.split(",")[0]}
            </span>
            <span>{formatBytes(file.sizeBytes)}</span>
            <span>•</span>
            <span>{file.hasAudio ? formatDuration(file.durationSecs) : "—"}</span>
            {file.boostEnabled && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/25 dark:text-amber-300">
                <Zap className="h-2.5 w-2.5" />
                <span>{boostLabel}</span>
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => removeFile(file.path)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-500"
          aria-label={translate(lang, "removeFile")}
        >
          <X className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>

      {/* Action Row */}
      <div className="mt-3.5 flex items-center justify-between border-t border-black/[0.04] pt-3 dark:border-white/[0.04]">
        <div className="flex items-center gap-2">
          {/* Trim Button */}
          <button
            onClick={onToggleTrim}
            data-testid={`trim-toggle-mobile-${file.name}`}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
              expandedMode === "trim"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm shadow-orange-500/30"
                : "border border-black/5 bg-black/[0.02] text-zinc-700 hover:border-orange-400 dark:border-white/5 dark:bg-white/[0.04] dark:text-zinc-300"
            }`}
          >
            <Scissors className="h-3 w-3" strokeWidth={2.2} />
            <span>{translate(lang, "trimEdit")}</span>
          </button>

          {/* Sound Booster Button */}
          <button
            onClick={onToggleBoost}
            data-testid={`boost-toggle-mobile-${file.name}`}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
              expandedMode === "boost"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm shadow-orange-500/30"
                : file.boostEnabled
                  ? "border border-orange-500/30 bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400"
                  : "border border-black/5 bg-black/[0.02] text-zinc-700 hover:border-orange-400 dark:border-white/5 dark:bg-white/[0.04] dark:text-zinc-300"
            }`}
          >
            <Volume2 className="h-3 w-3" strokeWidth={2.2} />
            <span>{translate(lang, "boostBtnShort" as any)}</span>
          </button>
        </div>

        <div>
          {(file.trimStartSecs != null || file.trimEndSecs != null) ? (
            <span
              className="rounded-full bg-orange-500/10 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-orange-600 dark:text-orange-400"
            >
              {formatDuration(file.trimStartSecs ?? 0)} – {formatDuration(file.trimEndSecs ?? file.durationSecs)}
            </span>
          ) : (
            <span className="text-xs text-zinc-400">{translate(lang, "trimFullFile")}</span>
          )}
        </div>
      </div>

      {expandedMode === "trim" && (
        <div className="mt-3.5 border-t border-black/[0.04] pt-3.5 dark:border-white/[0.04]">
          <TrimEditor key={`trim-${file.path}`} file={file} />
        </div>
      )}

      {expandedMode === "boost" && (
        <div className="mt-3.5 border-t border-black/[0.04] pt-3.5 dark:border-white/[0.04]">
          <FileBoosterInline key={`boost-${file.path}`} file={file} />
        </div>
      )}
    </div>
  );
}

export function FileList(): React.JSX.Element | null {
  const files = useAppStore((s) => s.files);
  const lang = useAppStore((s) => s.lang);
  const clearFiles = useAppStore((s) => s.clearFiles);
  const addPaths = useAppStore((s) => s.addPaths);

  // Tracks active expanded row: path -> "trim" | "boost"
  const [activeExpanded, setActiveExpanded] = useState<{ path: string; mode: "trim" | "boost" } | null>(null);

  if (files.length === 0) return null;

  const handleToggle = (path: string, mode: "trim" | "boost") => {
    setActiveExpanded((cur) => {
      if (cur?.path === path && cur?.mode === mode) return null;
      return { path, mode };
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Mobile Card List (< md) */}
      <div className="flex flex-col gap-3 md:hidden">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold tracking-tight text-zinc-800 dark:text-zinc-200">{translate(lang, "colFile")} ({files.length})</h2>
          <button
            onClick={clearFiles}
            className="flex items-center gap-1 text-xs font-semibold text-red-500/80 hover:text-red-500"
          >
            <Trash2 className="h-3 w-3" />
            <span>{translate(lang, "clearList")}</span>
          </button>
        </div>
        {files.map((f) => (
          <MobileFileCard
            key={f.path}
            file={f}
            expandedMode={activeExpanded?.path === f.path ? activeExpanded.mode : null}
            onToggleTrim={() => handleToggle(f.path, "trim")}
            onToggleBoost={() => handleToggle(f.path, "boost")}
          />
        ))}
      </div>

      {/* Desktop Table (>= md) */}
      <div className="glass-panel hidden overflow-hidden rounded-3xl md:block">
        <div className="flex items-center justify-between border-b border-black/[0.05] bg-black/[0.02] px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.02]">
          <h2 className="text-sm font-bold tracking-tight text-zinc-800 dark:text-zinc-200">{translate(lang, "colFile")} ({files.length})</h2>
          <button
            onClick={clearFiles}
            className="flex items-center gap-1 text-xs font-semibold text-red-500/80 hover:text-red-500"
          >
            <Trash2 className="h-3 w-3" />
            <span>{translate(lang, "clearList")}</span>
          </button>
        </div>
        <table className="w-full table-fixed" data-testid="file-list">
          <thead>
            <tr className="border-b border-black/[0.04] text-start text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:border-white/[0.04] dark:text-zinc-500">
              <th className="px-3 py-2 text-start font-semibold">{translate(lang, "colFile")}</th>
              <th className="w-20 px-3 py-2 text-start font-semibold">{translate(lang, "colSize")}</th>
              <th className="w-24 px-3 py-2 text-start font-semibold">{translate(lang, "colDuration")}</th>
              <th className="w-16 px-3 py-2 text-start font-semibold">{translate(lang, "colFormat")}</th>
              <th className="w-36 px-3 py-2 text-start font-semibold">{translate(lang, "trimRange")}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <FileRow
                key={f.path}
                file={f}
                expandedMode={activeExpanded?.path === f.path ? activeExpanded.mode : null}
                onToggleTrim={() => handleToggle(f.path, "trim")}
                onToggleBoost={() => handleToggle(f.path, "boost")}
              />
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={() => void pickVideos().then(addPaths)}
        data-testid="add-more"
        className="glass-card flex items-center justify-center gap-2 rounded-2xl py-3 text-xs font-semibold text-zinc-700 transition-all hover:scale-[1.01] hover:border-orange-500/50 hover:text-orange-500 active:scale-[0.99] dark:text-zinc-300 md:self-start md:px-5 md:py-2.5"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
        <span>{translate(lang, "addFiles")}</span>
      </button>
    </div>
  );
}
