import { useState } from "react";
import { useAppStore } from "../stores/useAppStore";
import { translate } from "../i18n";
import { formatBytes, formatDuration } from "../utils/format";
import { pickVideos, isAudioPath } from "../utils/dialog";
import { TrimEditor } from "./TrimEditor";
import type { InputFile } from "../types";

function kindBadge(file: InputFile): string | null {
  const kind = file.kind ?? (isAudioPath(file.path) ? "audio" : "video");
  return kind === "audio" ? "♪" : null;
}

function FileRow({
  file,
  expanded,
  onToggle,
}: {
  file: InputFile;
  expanded: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const removeFile = useAppStore((s) => s.removeFile);
  const badge = kindBadge(file);

  return (
    <>
      <tr className="border-b border-black/[0.04] transition-colors hover:bg-black/[0.02] dark:border-white/[0.04] dark:hover:bg-white/[0.02]">
        <td className="max-w-[280px] truncate px-3 py-2.5" title={file.path}>
          <button
            onClick={onToggle}
            data-testid={`trim-toggle-${file.name}`}
            className={`me-2 inline-flex h-6 w-6 items-center justify-center rounded-lg border align-middle text-[11px] font-medium transition-all ${
              expanded
                ? "border-orange-500 bg-orange-500 text-white shadow-sm shadow-orange-500/30"
                : "border-black/10 bg-white/60 text-zinc-500 hover:border-orange-400 hover:text-orange-500 dark:border-white/10 dark:bg-zinc-800/60 dark:text-zinc-400"
            }`}
            aria-label={`${translate(lang, "trimEdit")} ${file.name}`}
            aria-expanded={expanded}
            title={translate(lang, "trimTitle")}
          >
            ✂
          </button>
          {badge && (
            <span className="me-1 inline-block rounded bg-orange-500/10 px-1 py-0.5 align-middle text-[10px] font-bold text-orange-600 dark:text-orange-400" title="audio">
              {badge}
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
          {(file.trimStartSecs != null || file.trimEndSecs != null) ? (
            <span
              data-testid={`trim-chip-${file.name}`}
              className="rounded-full bg-orange-500/10 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-orange-600 dark:text-orange-400"
            >
              {formatDuration(file.trimStartSecs ?? 0)} –{" "}
              {formatDuration(
                file.trimEndSecs ?? file.durationSecs,
              )}
            </span>
          ) : (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">{translate(lang, "trimFullFile")}</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-end">
          <button
            onClick={() => removeFile(file.path)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-500"
            aria-label={translate(lang, "removeFile")}
          >
            ✕
          </button>
        </td>
      </tr>
      {/* Editor opens directly beneath its row. */}
      {expanded && (
        <tr className="border-b border-black/[0.04] dark:border-white/[0.04]">
          <td colSpan={6} className="px-3 pb-4 pt-1">
            <TrimEditor key={file.path} file={file} />
          </td>
        </tr>
      )}
    </>
  );
}

function MobileFileCard({
  file,
  expanded,
  onToggle,
}: {
  file: InputFile;
  expanded: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const removeFile = useAppStore((s) => s.removeFile);
  const badge = kindBadge(file);

  return (
    <div className="glass-card flex flex-col rounded-2xl p-4 transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-semibold text-sm text-zinc-800 dark:text-zinc-100">
            {badge && (
              <span className="shrink-0 rounded-md bg-orange-500/10 px-1.5 py-0.5 text-[11px] font-bold text-orange-600 dark:text-orange-400">
                {badge}
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
          </div>
        </div>

        <button
          onClick={() => removeFile(file.path)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-500"
          aria-label={translate(lang, "removeFile")}
        >
          ✕
        </button>
      </div>

      <div className="mt-3.5 flex items-center justify-between border-t border-black/[0.04] pt-3 dark:border-white/[0.04]">
        <button
          onClick={onToggle}
          data-testid={`trim-toggle-mobile-${file.name}`}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
            expanded
              ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm shadow-orange-500/30"
              : "border border-black/5 bg-black/[0.02] text-zinc-700 hover:border-orange-400 dark:border-white/5 dark:bg-white/[0.04] dark:text-zinc-300"
          }`}
        >
          <span>✂</span>
          <span>{translate(lang, "trimEdit")}</span>
        </button>

        <div>
          {(file.trimStartSecs != null || file.trimEndSecs != null) ? (
            <span
              className="rounded-full bg-orange-500/10 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-orange-600 dark:text-orange-400"
            >
              {formatDuration(file.trimStartSecs ?? 0)} –{" "}
              {formatDuration(
                file.trimEndSecs ?? file.durationSecs,
              )}
            </span>
          ) : (
            <span className="text-xs text-zinc-400">{translate(lang, "trimFullFile")}</span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3.5 border-t border-black/[0.04] pt-3.5 dark:border-white/[0.04]">
          <TrimEditor key={file.path} file={file} />
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
  // One editor open at a time keeps the list calm; path-keyed.
  const [openPath, setOpenPath] = useState<string | null>(null);

  if (files.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {/* Mobile Card List (< md) */}
      <div className="flex flex-col gap-3 md:hidden">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold tracking-tight text-zinc-800 dark:text-zinc-200">{translate(lang, "colFile")} ({files.length})</h2>
          <button
            onClick={clearFiles}
            className="text-xs font-semibold text-red-500/80 hover:text-red-500"
          >
            {translate(lang, "clearList")}
          </button>
        </div>
        {files.map((f) => (
          <MobileFileCard
            key={f.path}
            file={f}
            expanded={openPath === f.path}
            onToggle={() => setOpenPath((cur) => (cur === f.path ? null : f.path))}
          />
        ))}
      </div>

      {/* Desktop Table (>= md) */}
      <div className="glass-panel hidden overflow-hidden rounded-3xl md:block">
        <div className="flex items-center justify-between border-b border-black/[0.05] bg-black/[0.02] px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.02]">
          <h2 className="text-sm font-bold tracking-tight text-zinc-800 dark:text-zinc-200">{translate(lang, "colFile")} ({files.length})</h2>
          <button
            onClick={clearFiles}
            className="text-xs font-semibold text-red-500/80 hover:text-red-500"
          >
            {translate(lang, "clearList")}
          </button>
        </div>
        <table className="w-full table-fixed" data-testid="file-list">
          <thead>
            <tr className="border-b border-black/[0.04] text-start text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:border-white/[0.04] dark:text-zinc-500">
              <th className="px-3 py-2 text-start font-semibold">{translate(lang, "colFile")}</th>
              <th className="w-20 px-3 py-2 text-start font-semibold">{translate(lang, "colSize")}</th>
              <th className="w-24 px-3 py-2 text-start font-semibold">{translate(lang, "colDuration")}</th>
              <th className="w-16 px-3 py-2 text-start font-semibold">{translate(lang, "colFormat")}</th>
              <th className="w-32 px-3 py-2 text-start font-semibold">{translate(lang, "trimRange")}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <FileRow
                key={f.path}
                file={f}
                expanded={openPath === f.path}
                onToggle={() => setOpenPath((cur) => (cur === f.path ? null : f.path))}
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
        <span>＋</span>
        <span>{translate(lang, "addFiles")}</span>
      </button>
    </div>
  );
}
