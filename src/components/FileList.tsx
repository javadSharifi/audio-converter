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
      <tr className="border-b border-zinc-100 dark:border-zinc-800">
        <td className="max-w-[280px] truncate px-2 py-2" title={file.path}>
          <button
            onClick={onToggle}
            data-testid={`trim-toggle-${file.name}`}
            className={`me-1 inline-flex h-5 w-5 items-center justify-center rounded-md border align-middle text-[10px] transition-colors ${
              expanded
                ? "border-orange-400 bg-orange-500/10 text-orange-500"
                : "border-zinc-300 text-zinc-400 hover:border-orange-400 hover:text-orange-500 dark:border-zinc-600"
            }`}
            aria-label={`${translate(lang, "trimEdit")} ${file.name}`}
            aria-expanded={expanded}
            title={translate(lang, "trimTitle")}
          >
            ✂
          </button>
          {badge && (
            <span className="me-0.5 align-middle text-[10px] opacity-50" title="audio">
              {badge}
            </span>
          )}
          <span className="align-middle">{file.name}</span>
          {file.error && (
            <span className="block text-xs text-red-500">{file.error}</span>
          )}
        </td>
        <td className="px-2 py-2 text-sm opacity-70">{formatBytes(file.sizeBytes)}</td>
        <td className="px-2 py-2 text-sm opacity-70">
          {file.hasAudio ? formatDuration(file.durationSecs) : "—"}
        </td>
        <td className="px-2 py-2 text-xs uppercase opacity-50">{file.formatName.split(",")[0]}</td>
        <td className="px-2 py-2">
          {(file.trimStartSecs != null || file.trimEndSecs != null) ? (
            <span
              data-testid={`trim-chip-${file.name}`}
              className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-orange-600 dark:text-orange-400"
            >
              {formatDuration(file.trimStartSecs ?? 0)} –{" "}
              {formatDuration(
                file.trimEndSecs ?? file.durationSecs,
              )}
            </span>
          ) : (
            <span className="text-xs opacity-40">{translate(lang, "trimFullFile")}</span>
          )}
        </td>
        <td className="px-2 py-2">
          <button
            onClick={() => removeFile(file.path)}
            className="rounded-md px-2 py-1 text-xs opacity-60 hover:bg-zinc-100 hover:opacity-100 dark:hover:bg-zinc-800"
            aria-label={translate(lang, "removeFile")}
          >
            ✕
          </button>
        </td>
      </tr>
      {/* Editor opens directly beneath its row. */}
      {expanded && (
        <tr className="border-b border-zinc-100 dark:border-zinc-800">
          <td colSpan={6} className="px-2 pb-3 pt-1">
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
    <div className="flex flex-col rounded-xl border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-medium text-sm">
            {badge && (
              <span className="shrink-0 rounded bg-orange-500/10 px-1 py-0.5 text-[11px] font-bold text-orange-600 dark:text-orange-400">
                {badge}
              </span>
            )}
            <span className="truncate" title={file.path}>{file.name}</span>
          </div>
          {file.error && (
            <span className="mt-1 block text-xs text-red-500">{file.error}</span>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs opacity-70">
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 uppercase dark:bg-zinc-800">
              {file.formatName.split(",")[0]}
            </span>
            <span>{formatBytes(file.sizeBytes)}</span>
            <span>•</span>
            <span>{file.hasAudio ? formatDuration(file.durationSecs) : "—"}</span>
          </div>
        </div>

        <button
          onClick={() => removeFile(file.path)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
          aria-label={translate(lang, "removeFile")}
        >
          ✕
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
        <button
          onClick={onToggle}
          data-testid={`trim-toggle-mobile-${file.name}`}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            expanded
              ? "bg-orange-500 text-white"
              : "border border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-orange-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          <span>✂</span>
          <span>{translate(lang, "trimEdit")}</span>
        </button>

        <div>
          {(file.trimStartSecs != null || file.trimEndSecs != null) ? (
            <span
              className="rounded-full bg-orange-500/10 px-2.5 py-1 text-[11px] font-medium tabular-nums text-orange-600 dark:text-orange-400"
            >
              {formatDuration(file.trimStartSecs ?? 0)} –{" "}
              {formatDuration(
                file.trimEndSecs ?? file.durationSecs,
              )}
            </span>
          ) : (
            <span className="text-xs opacity-40">{translate(lang, "trimFullFile")}</span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
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
      <div className="flex flex-col gap-2.5 md:hidden">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold">{translate(lang, "colFile")} ({files.length})</h2>
          <button
            onClick={clearFiles}
            className="text-xs text-red-500/80 hover:text-red-500 font-medium"
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
      <div className="hidden overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 md:block">
        <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">{translate(lang, "colFile")} ({files.length})</h2>
          <button
            onClick={clearFiles}
            className="text-xs opacity-60 hover:text-red-500 hover:opacity-100"
          >
            {translate(lang, "clearList")}
          </button>
        </div>
        <table className="w-full table-fixed" data-testid="file-list">
          <thead>
            <tr className="text-start text-xs uppercase tracking-wide opacity-40">
              <th className="px-2 py-1.5 text-start font-medium">{translate(lang, "colFile")}</th>
              <th className="w-20 px-2 py-1.5 text-start font-medium">{translate(lang, "colSize")}</th>
              <th className="w-24 px-2 py-1.5 text-start font-medium">{translate(lang, "colDuration")}</th>
              <th className="w-16 px-2 py-1.5 text-start font-medium">{translate(lang, "colFormat")}</th>
              <th className="w-32 px-2 py-1.5 text-start font-medium">{translate(lang, "trimRange")}</th>
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
        className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-zinc-300 py-3 text-sm font-medium opacity-80 transition-colors hover:border-orange-400 hover:text-orange-600 dark:border-zinc-700 dark:hover:text-orange-400 md:self-start md:px-4 md:py-2"
      >
        <span>＋</span>
        <span>{translate(lang, "addFiles")}</span>
      </button>
    </div>
  );
}
