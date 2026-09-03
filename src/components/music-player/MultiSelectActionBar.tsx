import React, { useState } from "react";
import { useAppStore } from "../../stores/useAppStore";
import { useMusicPlayerStore, isTrackLiked } from "../../stores/useMusicPlayerStore";
import { translate } from "../../i18n";
import { AddToAlbumModal } from "./AddToAlbumModal";
import {
  X,
  CheckSquare,
  Square,
  ArrowLeftRight,
  FolderPlus,
  Trash2,
  AlertTriangle,
  Heart,
} from "lucide-react";
import type { AudioTrackInfo } from "../../types";

interface MultiSelectActionBarProps {
  tracks: AudioTrackInfo[];
}

export function MultiSelectActionBar({
  tracks,
}: MultiSelectActionBarProps): React.JSX.Element | null {
  const lang = useAppStore((s) => s.lang);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const addPaths = useAppStore((s) => s.addPaths);
  const pushToast = useAppStore((s) => s.pushToast);

  const isSelectionMode = useMusicPlayerStore((s) => s.isSelectionMode);
  const selectedTrackKeys = useMusicPlayerStore((s) => s.selectedTrackKeys);
  const likedPaths = useMusicPlayerStore((s) => s.likedPaths);
  const exitSelectionMode = useMusicPlayerStore((s) => s.exitSelectionMode);
  const selectAllTracks = useMusicPlayerStore((s) => s.selectAllTracks);
  const clearSelection = useMusicPlayerStore((s) => s.clearSelection);
  const toggleLikeMultiple = useMusicPlayerStore((s) => s.toggleLikeMultiple);
  const deleteMultipleTracks = useMusicPlayerStore((s) => s.deleteMultipleTracks);

  const [albumModalOpen, setAlbumModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!isSelectionMode) return null;

  const selectedTracks = tracks.filter((t) => {
    const key = t.uri || t.path || t.id;
    return selectedTrackKeys.has(key) || selectedTrackKeys.has(t.id) || selectedTrackKeys.has(t.uri);
  });

  const allSelected = tracks.length > 0 && selectedTracks.length === tracks.length;

  const handleToggleSelectAll = () => {
    if (allSelected) {
      clearSelection();
    } else {
      selectAllTracks(tracks);
    }
  };

  const handleConvertToQueue = () => {
    if (selectedTracks.length === 0) return;
    const paths = selectedTracks.map((t) => t.path || t.uri).filter(Boolean);
    void addPaths(paths);
    pushToast(
      "info",
      translate(lang, "transferredToConverter", { count: selectedTracks.length }),
    );
    exitSelectionMode();
    setActiveTool("converter");
  };

  const allSelectedLiked =
    selectedTracks.length > 0 &&
    selectedTracks.every((t) => isTrackLiked(t, likedPaths));

  const handleToggleLikeMultiple = () => {
    if (selectedTracks.length === 0) return;
    const didLike = toggleLikeMultiple(selectedTracks);
    pushToast(
      "info",
      translate(lang, didLike ? "multiLikedSuccess" : "multiUnlikedSuccess", {
        count: selectedTracks.length,
      }),
    );
  };

  const handleConfirmDelete = async () => {
    if (selectedTracks.length === 0) return;
    setDeleting(true);
    try {
      const count = selectedTracks.length;
      await deleteMultipleTracks(selectedTracks);
      pushToast("info", translate(lang, "multiDeletedSuccess", { count }));
      setDeleteConfirmOpen(false);
    } catch (e) {
      console.warn("Failed to delete tracks:", e);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-3 sm:px-4 select-none animate-in slide-in-from-bottom duration-200">
        <div className="flex items-center justify-between gap-2 p-3 rounded-3xl bg-white/95 dark:bg-zinc-900/95 text-zinc-900 dark:text-white border border-black/10 dark:border-white/15 shadow-[0_16px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
          {/* Left: Count & Select All */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={handleToggleSelectAll}
              title={translate(lang, allSelected ? "deselectAll" : "selectAll")}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-2xl bg-orange-500/10 hover:bg-orange-500/15 dark:bg-white/10 dark:hover:bg-white/15 text-xs font-bold text-orange-600 dark:text-amber-300 transition-colors cursor-pointer active:scale-95"
            >
              {allSelected ? (
                <CheckSquare className="h-4 w-4 text-orange-500" />
              ) : (
                <Square className="h-4 w-4 text-zinc-400" />
              )}
              <span className="truncate">
                {translate(lang, "selectedCount", { count: selectedTracks.length })}
              </span>
            </button>
          </div>

          {/* Right Actions: Convert, Like, Add to Album, Delete, Exit */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* 1. Convert Action */}
            <button
              type="button"
              disabled={selectedTracks.length === 0}
              onClick={handleConvertToQueue}
              title={translate(lang, "convertSelected")}
              className="flex items-center gap-1 px-3 py-1.5 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 hover:brightness-105 text-white text-xs font-bold shadow-md shadow-orange-500/25 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{translate(lang, "convertSelected")}</span>
            </button>

            {/* 2. Like / Unlike Bulk Action */}
            <button
              type="button"
              disabled={selectedTracks.length === 0}
              onClick={handleToggleLikeMultiple}
              title={translate(lang, allSelectedLiked ? "unlikeSelected" : "likeSelected")}
              className={`flex items-center justify-center h-8 w-8 rounded-2xl transition-colors cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                allSelectedLiked
                  ? "bg-rose-500/25 text-rose-500 border border-rose-500/40"
                  : "bg-black/[0.05] hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 text-rose-500 dark:text-rose-300"
              }`}
            >
              <Heart className={`h-4 w-4 ${allSelectedLiked ? "fill-rose-500" : ""}`} />
            </button>

            {/* 3. Add to Album Action */}
            <button
              type="button"
              disabled={selectedTracks.length === 0}
              onClick={() => setAlbumModalOpen(true)}
              title={translate(lang, "addToAlbum")}
              className="flex items-center justify-center h-8 w-8 rounded-2xl bg-black/[0.05] hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 text-zinc-700 dark:text-amber-200 transition-colors cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FolderPlus className="h-4 w-4" />
            </button>

            {/* 4. Delete Action */}
            <button
              type="button"
              disabled={selectedTracks.length === 0}
              onClick={() => setDeleteConfirmOpen(true)}
              title={translate(lang, "deleteSelected")}
              className="flex items-center justify-center h-8 w-8 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 dark:bg-rose-500/20 dark:hover:bg-rose-500/30 text-rose-600 dark:text-rose-400 border border-rose-500/25 transition-colors cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            {/* 5. Clean Cancel Button */}
            <button
              type="button"
              onClick={exitSelectionMode}
              title={translate(lang, "exitSelection")}
              className="flex items-center gap-1 h-8 px-2.5 rounded-2xl bg-black/[0.05] hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 text-zinc-600 dark:text-zinc-300 text-xs font-semibold transition-colors cursor-pointer active:scale-95"
            >
              <X className="h-3.5 w-3.5" />
              <span className="text-[11px] font-bold">{translate(lang, "exitSelection")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Add To Album Modal for multiple tracks */}
      {albumModalOpen && (
        <AddToAlbumModal
          tracks={selectedTracks}
          onClose={() => {
            setAlbumModalOpen(false);
            exitSelectionMode();
          }}
        />
      )}

      {/* Delete Multiple Tracks Confirmation Modal */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 shadow-2xl p-5 text-center flex flex-col gap-3.5 animate-in zoom-in-95 duration-150">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500 dark:bg-rose-500/20">
              <AlertTriangle className="h-6 w-6" strokeWidth={2.2} />
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
                {translate(lang, "deleteMultipleConfirm", {
                  count: selectedTracks.length,
                })}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {translate(lang, "deleteMultipleDesc")}
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {translate(lang, "deleteSelected")}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteConfirmOpen(false)}
                className="flex-1 py-2.5 rounded-2xl bg-black/[0.05] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 text-xs font-bold transition-all cursor-pointer active:scale-95"
              >
                {translate(lang, "cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
