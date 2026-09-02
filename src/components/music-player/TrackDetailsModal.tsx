import React, { useState } from "react";
import { useAppStore } from "../../stores/useAppStore";
import { translate } from "../../i18n";
import { formatBytes } from "../../utils/format";
import { TrackCover } from "./TrackCover";
import { X, Copy, Check, FolderOpen, Disc, Clock, HardDrive, FileText, Calendar } from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { isAndroid } from "../../utils/platform";
import type { AudioTrackInfo } from "../../types";

function formatDuration(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return "--:--";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function formatDate(timestampMs: number | null | undefined, lang: "en" | "fa"): string {
  if (!timestampMs) return "-";
  return new Date(timestampMs).toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface TrackDetailsModalProps {
  track: AudioTrackInfo;
  onClose: () => void;
}

export function TrackDetailsModal({ track, onClose }: TrackDetailsModalProps): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const pushToast = useAppStore((s) => s.pushToast);
  const [copied, setCopied] = useState(false);

  const displayPath = track.path || track.uri;

  const handleCopyPath = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(displayPath);
        setCopied(true);
        pushToast("info", translate(lang, "copiedToClipboard"));
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) {
      console.warn("Clipboard copy failed:", e);
    }
  };

  const handleOpenFolder = async () => {
    try {
      if (track.path) {
        const dir = track.path.replace(/[\\/][^\\/]+$/, "");
        await openPath(dir);
      }
    } catch (e) {
      console.warn("Open folder failed:", e);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="glass-panel w-full max-w-md rounded-3xl p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col gap-4 border border-black/10 dark:border-white/10 max-h-[90vh] overflow-y-auto">
        {/* Top Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
            {translate(lang, "trackDetails")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] hover:bg-black/10 dark:bg-white/[0.08] dark:hover:bg-white/15 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Track Banner */}
        <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.05] dark:border-white/[0.05]">
          <TrackCover track={track} size="lg" />
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
              {track.title || track.name}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {track.artist || "-"}
            </span>
          </div>
        </div>

        {/* Details List */}
        <div className="flex flex-col divide-y divide-black/[0.05] dark:divide-white/[0.05] text-xs">
          {/* Album */}
          <div className="flex items-center justify-between py-2.5">
            <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
              <Disc className="h-3.5 w-3.5" />
              <span>{translate(lang, "playerNavAlbums")}</span>
            </div>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate max-w-[200px]">
              {track.album || "-"}
            </span>
          </div>

          {/* Format & MIME Type */}
          <div className="flex items-center justify-between py-2.5">
            <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
              <FileText className="h-3.5 w-3.5" />
              <span>{translate(lang, "trackFormat")}</span>
            </div>
            <div className="flex items-center gap-1.5 font-semibold text-zinc-800 dark:text-zinc-200">
              <span className="uppercase font-bold px-1.5 py-0.5 rounded-md bg-orange-500/15 text-orange-600 dark:text-orange-400 text-[10px]">
                {track.format}
              </span>
              <span className="text-zinc-400 dark:text-zinc-500 text-[11px]">
                {track.mimeType}
              </span>
            </div>
          </div>

          {/* Duration */}
          <div className="flex items-center justify-between py-2.5">
            <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
              <Clock className="h-3.5 w-3.5" />
              <span>{translate(lang, "trackDuration")}</span>
            </div>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
              {formatDuration(track.durationSecs)}
            </span>
          </div>

          {/* Size */}
          <div className="flex items-center justify-between py-2.5">
            <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
              <HardDrive className="h-3.5 w-3.5" />
              <span>{translate(lang, "trackSize")}</span>
            </div>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
              {formatBytes(track.sizeBytes)}
            </span>
          </div>

          {/* Date Added */}
          <div className="flex items-center justify-between py-2.5">
            <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
              <Calendar className="h-3.5 w-3.5" />
              <span>{translate(lang, "trackDateAdded")}</span>
            </div>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
              {formatDate(track.createdTimestampMs || track.modifiedTimestampMs, lang)}
            </span>
          </div>

          {/* Path / URI Box */}
          <div className="flex flex-col gap-1.5 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 dark:text-zinc-400 text-[11px] font-medium">
                {translate(lang, "trackPath")}
              </span>
              <button
                type="button"
                onClick={handleCopyPath}
                className="flex items-center gap-1 text-[11px] font-semibold text-orange-600 dark:text-orange-400 hover:underline cursor-pointer"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                <span>{translate(lang, copied ? "copiedToClipboard" : "copy")}</span>
              </button>
            </div>
            <div className="p-2 rounded-xl bg-black/[0.04] dark:bg-white/[0.04] font-mono text-[10px] text-zinc-700 dark:text-zinc-300 break-all select-all">
              {displayPath}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-2 border-t border-black/[0.05] dark:border-white/[0.05]">
          {!isAndroid() && track.path && (
            <button
              type="button"
              onClick={handleOpenFolder}
              className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-2xl bg-black/[0.05] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10 text-xs font-bold text-zinc-700 dark:text-zinc-200 transition-all cursor-pointer active:scale-95"
            >
              <FolderOpen className="h-4 w-4" />
              <span>{translate(lang, "openFileLocation")}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 flex items-center justify-center h-10 rounded-2xl bg-orange-500 hover:bg-orange-600 text-xs font-bold text-white transition-all cursor-pointer active:scale-95 shadow-md shadow-orange-500/20"
          >
            {translate(lang, "close")}
          </button>
        </div>
      </div>
    </div>
  );
}
