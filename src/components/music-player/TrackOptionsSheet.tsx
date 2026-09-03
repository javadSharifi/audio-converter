import React, { useState } from "react";
import { useAppStore } from "../../stores/useAppStore";
import { useMusicPlayerStore, isTrackLiked } from "../../stores/useMusicPlayerStore";
import { translate } from "../../i18n";
import { TrackCover } from "./TrackCover";
import { TrackDetailsModal } from "./TrackDetailsModal";
import { AddToAlbumModal } from "./AddToAlbumModal";
import { SetRingtoneModal } from "./SetRingtoneModal";
import { isAndroid } from "../../utils/platform";
import {
  Trash2,
  BellRing,
  Info,
  Share2,
  X,
  AlertTriangle,
  Smartphone,
  FolderPlus,
  Heart,
} from "lucide-react";
import type { AudioTrackInfo } from "../../types";

interface TrackOptionsSheetProps {
  track: AudioTrackInfo;
  onClose: () => void;
}

export function TrackOptionsSheet({ track, onClose }: TrackOptionsSheetProps): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const pushToast = useAppStore((s) => s.pushToast);
  const likedPaths = useMusicPlayerStore((s) => s.likedPaths);
  const toggleLike = useMusicPlayerStore((s) => s.toggleLike);
  const deleteTrack = useMusicPlayerStore((s) => s.deleteTrack);
  const shareTrack = useMusicPlayerStore((s) => s.shareTrack);

  const isLiked = isTrackLiked(track, likedPaths);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [albumModalOpen, setAlbumModalOpen] = useState(false);
  const [ringtoneModalOpen, setRingtoneModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteTrack(track);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Delete track failed:", msg);
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  const [isSharing, setIsSharing] = useState(false);

  const handleShare = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      await shareTrack(track);
      onClose();
    } catch (err: unknown) {
      console.warn("Share track failed:", err);
      // Surface the failure: previously the sheet just stayed open silently.
      pushToast("error", "shareFailed");
    } finally {
      setIsSharing(false);
    }
  };

  if (detailsOpen) {
    return (
      <TrackDetailsModal
        track={track}
        onClose={() => {
          setDetailsOpen(false);
          onClose();
        }}
      />
    );
  }

  if (albumModalOpen) {
    return (
      <AddToAlbumModal
        track={track}
        onClose={() => {
          setAlbumModalOpen(false);
          onClose();
        }}
      />
    );
  }

  if (ringtoneModalOpen) {
    return (
      <SetRingtoneModal
        track={track}
        onClose={() => {
          setRingtoneModalOpen(false);
          onClose();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end sm:items-center sm:justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Tap backdrop to dismiss */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Bottom Sheet Card */}
      <div
        className="relative z-10 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white/95 dark:bg-zinc-900/95 border border-black/10 dark:border-white/10 shadow-2xl backdrop-blur-2xl p-4 sm:p-5 flex flex-col gap-3 animate-in slide-in-from-bottom duration-250 ease-out select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* iOS Grabber */}
        <div className="mx-auto h-1.5 w-12 rounded-full bg-zinc-300 dark:bg-zinc-700 sm:hidden" />

        {/* Track Preview Header */}
        <div className="flex items-center justify-between pb-2 border-b border-black/[0.06] dark:border-white/[0.06]">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <TrackCover track={track} size="sm" />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                {track.title || track.name}
              </span>
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate">
                {track.artist || "Unknown Artist"}
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

        {/* Confirmation State for Deletion */}
        {confirmDelete ? (
          <div className="flex flex-col gap-3 py-2 animate-in fade-in duration-150">
            <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-xs font-bold">{translate(lang, "deleteSongConfirm")}</span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {translate(lang, "deleteSongWarning")}
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-2.5 rounded-2xl bg-black/[0.05] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10 text-xs font-bold text-zinc-700 dark:text-zinc-300 transition-all cursor-pointer active:scale-95"
              >
                {translate(lang, "cancel")}
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDelete}
                className="flex-1 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white shadow-md shadow-rose-600/25 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {translate(lang, "delete")}
              </button>
            </div>
          </div>
        ) : (
          /* Action Options List */
          <div className="flex flex-col gap-1 py-1">
            {/* 1. Like / Favorite Toggle */}
            <button
              type="button"
              onClick={() => {
                toggleLike(track);
              }}
              className="flex items-center justify-between w-full p-3 rounded-2xl hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl transition-transform group-hover:scale-105 ${
                    isLiked
                      ? "bg-rose-500/15 text-rose-500 dark:bg-rose-500/25"
                      : "bg-rose-500/10 text-rose-500 dark:bg-rose-500/15"
                  }`}
                >
                  <Heart
                    className={`h-4 w-4 ${isLiked ? "fill-rose-500" : ""}`}
                    strokeWidth={isLiked ? 0 : 2}
                  />
                </div>
                <span
                  className={`text-xs font-bold ${
                    isLiked
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  {translate(lang, isLiked ? "unlikeTrack" : "likeTrack")}
                </span>
              </div>
            </button>

            {/* 2. Add to Album */}
            <button
              type="button"
              onClick={() => setAlbumModalOpen(true)}
              className="flex items-center justify-between w-full p-3 rounded-2xl hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 group-hover:scale-105 transition-transform">
                  <FolderPlus className="h-4 w-4" />
                </div>
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                  {translate(lang, "addToAlbum")}
                </span>
              </div>
            </button>

            {/* 2. Share Song (disabled while staging/sharing to prevent double sheets) */}
            <button
              type="button"
              onClick={handleShare}
              disabled={isSharing}
              className="flex items-center justify-between w-full p-3 rounded-2xl hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors cursor-pointer group disabled:opacity-60 disabled:cursor-wait"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 group-hover:scale-105 transition-transform">
                  <Share2 className="h-4 w-4" />
                </div>
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                  {translate(lang, "shareSong")}
                </span>
              </div>
            </button>

            {/* 3. Track Details */}
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="flex items-center justify-between w-full p-3 rounded-2xl hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 group-hover:scale-105 transition-transform">
                  <Info className="h-4 w-4" />
                </div>
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                  {translate(lang, "trackDetails")}
                </span>
              </div>
            </button>

            {/* 4. Set as Ringtone (Opens Trimmer Modal) */}
            <button
              type="button"
              onClick={() => setRingtoneModalOpen(true)}
              className="flex items-center justify-between w-full p-3 rounded-2xl hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 group-hover:scale-105 transition-transform">
                  <BellRing className="h-4 w-4" />
                </div>
                <div className="flex flex-col text-start">
                  <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    {translate(lang, "setAsRingtone")}
                  </span>
                  {!isAndroid() && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      {translate(lang, "ringtoneMobileOnly")}
                    </span>
                  )}
                </div>
              </div>
              {!isAndroid() && (
                <Smartphone className="h-4 w-4 text-zinc-400 opacity-60" />
              )}
            </button>

            {/* 5. Delete Song */}
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center justify-between w-full p-3 rounded-2xl hover:bg-rose-500/10 dark:hover:bg-rose-500/15 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 group-hover:scale-105 transition-transform">
                  <Trash2 className="h-4 w-4" />
                </div>
                <span className="text-xs font-bold">{translate(lang, "deleteSong")}</span>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
