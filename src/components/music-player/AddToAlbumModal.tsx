import React, { useState } from "react";
import { useAppStore } from "../../stores/useAppStore";
import { useMusicPlayerStore } from "../../stores/useMusicPlayerStore";
import { translate } from "../../i18n";
import { X, Plus, Check, FolderPlus, Disc3 } from "lucide-react";
import type { AudioTrackInfo } from "../../types";

interface AddToAlbumModalProps {
  track?: AudioTrackInfo;
  tracks?: AudioTrackInfo[];
  onClose: () => void;
}

export function AddToAlbumModal({
  track,
  tracks,
  onClose,
}: AddToAlbumModalProps): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const pushToast = useAppStore((s) => s.pushToast);
  const customAlbums = useMusicPlayerStore((s) => s.customAlbums);
  const createCustomAlbum = useMusicPlayerStore((s) => s.createCustomAlbum);
  const addTrackToAlbum = useMusicPlayerStore((s) => s.addTrackToAlbum);
  const addMultipleTracksToAlbum = useMusicPlayerStore((s) => s.addMultipleTracksToAlbum);
  const removeTrackFromAlbum = useMusicPlayerStore((s) => s.removeTrackFromAlbum);
  const isTrackInAlbum = useMusicPlayerStore((s) => s.isTrackInAlbum);

  const [newAlbumName, setNewAlbumName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const targetTracks = tracks ?? (track ? [track] : []);
  const isMulti = targetTracks.length > 1;

  const handleToggleAlbum = (albumId: string, albumName: string) => {
    if (isMulti) {
      addMultipleTracksToAlbum(albumId, targetTracks);
      pushToast(
        "info",
        translate(lang, "multiAddedToAlbum", {
          count: targetTracks.length,
          name: albumName,
        }),
      );
      onClose();
      return;
    }

    if (targetTracks.length === 1) {
      const singleTrack = targetTracks[0];
      const isIn = isTrackInAlbum(albumId, singleTrack);
      if (isIn) {
        removeTrackFromAlbum(albumId, singleTrack);
        pushToast("info", translate(lang, "removedFromAlbum", { name: albumName }));
      } else {
        addTrackToAlbum(albumId, singleTrack);
        pushToast("info", translate(lang, "addedToAlbum", { name: albumName }));
      }
    }
  };

  const handleCreateNewAlbum = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newAlbumName.trim();
    if (!trimmed) return;

    const newId = createCustomAlbum(trimmed);
    if (isMulti) {
      addMultipleTracksToAlbum(newId, targetTracks);
      pushToast(
        "info",
        translate(lang, "multiAddedToAlbum", {
          count: targetTracks.length,
          name: trimmed,
        }),
      );
    } else if (targetTracks.length === 1) {
      addTrackToAlbum(newId, targetTracks[0]);
      pushToast("info", translate(lang, "addedToAlbum", { name: trimmed }));
    }
    setNewAlbumName("");
    setIsCreating(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end sm:items-center sm:justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className="relative z-10 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white/95 dark:bg-zinc-900/95 border border-black/10 dark:border-white/10 shadow-2xl backdrop-blur-2xl p-4 sm:p-5 flex flex-col gap-3.5 animate-in slide-in-from-bottom duration-250 ease-out select-none max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top iOS Sheet Drag Handle */}
        <div className="mx-auto h-1.5 w-12 rounded-full bg-zinc-300 dark:bg-zinc-700 sm:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-black/[0.06] dark:border-white/[0.06]">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400">
              <FolderPlus className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <h2 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
                {translate(lang, "addToAlbum")}
              </h2>
              {isMulti && (
                <span className="text-[11px] text-orange-600 dark:text-orange-400 font-bold">
                  {translate(lang, "selectedCount", { count: targetTracks.length })}
                </span>
              )}
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

        {/* Create New Album Quick Form */}
        {isCreating ? (
          <form onSubmit={handleCreateNewAlbum} className="flex items-center gap-2">
            <input
              type="text"
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              placeholder={translate(lang, "albumNamePlaceholder")}
              autoFocus
              className="flex-1 h-10 px-3.5 text-xs rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
            />
            <button
              type="submit"
              disabled={!newAlbumName.trim()}
              className="h-10 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-xs font-bold text-white transition-all cursor-pointer active:scale-95 disabled:opacity-50"
            >
              {translate(lang, "create")}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setNewAlbumName("");
              }}
              className="h-10 px-3 rounded-xl bg-black/[0.05] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10 text-xs font-bold text-zinc-700 dark:text-zinc-300 transition-all cursor-pointer active:scale-95"
            >
              {translate(lang, "cancel")}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2.5 w-full p-3 rounded-2xl bg-orange-500/10 hover:bg-orange-500/15 dark:bg-orange-500/20 dark:hover:bg-orange-500/25 border border-dashed border-orange-500/30 text-orange-600 dark:text-orange-400 transition-colors cursor-pointer active:scale-98"
          >
            <Plus className="h-4 w-4" />
            <span className="text-xs font-bold">{translate(lang, "createAlbum")}</span>
          </button>
        )}

        {/* Custom Albums List */}
        <div className="flex flex-col gap-1.5 overflow-y-auto max-h-60 pr-0.5">
          {customAlbums.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
              {translate(lang, "noCustomAlbums")}
            </div>
          ) : (
            customAlbums.map((album) => {
              const inAlbum =
                !isMulti && targetTracks.length === 1
                  ? isTrackInAlbum(album.id, targetTracks[0])
                  : false;
              return (
                <button
                  key={album.id}
                  type="button"
                  onClick={() => handleToggleAlbum(album.id, album.name)}
                  className={`flex items-center justify-between w-full p-3 rounded-2xl transition-all duration-200 cursor-pointer ${
                    inAlbum
                      ? "bg-orange-500/10 dark:bg-orange-500/20 border border-orange-500/30"
                      : "hover:bg-black/[0.04] dark:hover:bg-white/[0.05] border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${
                        inAlbum
                          ? "bg-orange-500 text-white"
                          : "bg-black/[0.05] dark:bg-white/[0.06] text-zinc-500 dark:text-zinc-400"
                      }`}
                    >
                      <Disc3 className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col text-start">
                      <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                        {album.name}
                      </span>
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                        {translate(lang, "totalTracksCount", {
                          count: album.trackKeys.length,
                        })}
                      </span>
                    </div>
                  </div>

                  {inAlbum && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
                      <Check className="h-3.5 w-3.5" />
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
