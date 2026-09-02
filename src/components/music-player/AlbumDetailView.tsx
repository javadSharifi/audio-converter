import React, { useState } from "react";
import { useAppStore } from "../../stores/useAppStore";
import { useMusicPlayerStore } from "../../stores/useMusicPlayerStore";
import { translate } from "../../i18n";
import { TrackCover } from "./TrackCover";
import { TrackRow } from "./TrackRow";
import {
  ArrowLeft,
  ArrowRight,
  Play,
  Pause,
  Shuffle,
  Edit2,
  Trash2,
  Disc3,
  Sparkles,
  Check,
  X,
} from "lucide-react";
import type { AlbumItem } from "../../types";

function formatDurationMin(secs: number): string {
  if (!secs || secs <= 0) return "";
  const m = Math.round(secs / 60);
  return `${m} min`;
}

interface AlbumDetailViewProps {
  album: AlbumItem;
  onBack: () => void;
}

export function AlbumDetailView({ album, onBack }: AlbumDetailViewProps): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const pushToast = useAppStore((s) => s.pushToast);
  const playTrack = useMusicPlayerStore((s) => s.playTrack);
  const pauseTrack = useMusicPlayerStore((s) => s.pauseTrack);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const renameCustomAlbum = useMusicPlayerStore((s) => s.renameCustomAlbum);
  const deleteCustomAlbum = useMusicPlayerStore((s) => s.deleteCustomAlbum);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(album.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isRtl = lang === "fa";

  const isThisAlbumPlaying =
    currentTrack !== null &&
    isPlaying &&
    album.tracks.some((t) => t.id === currentTrack.id || t.uri === currentTrack.uri);

  const handlePlayAll = async () => {
    if (album.tracks.length === 0) return;
    if (isThisAlbumPlaying) {
      pauseTrack();
    } else {
      await playTrack(album.tracks[0], album.tracks);
    }
  };

  const handleShuffle = async () => {
    if (album.tracks.length === 0) return;
    const shuffled = [...album.tracks].sort(() => Math.random() - 0.5);
    await playTrack(shuffled[0], shuffled);
  };

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editedName.trim()) return;
    renameCustomAlbum(album.id, editedName.trim());
    setIsEditingName(false);
  };

  const handleDeleteAlbum = () => {
    deleteCustomAlbum(album.id);
    pushToast("info", translate(lang, "deleteAlbum"));
    onBack();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
      {/* Top Back Navigation Bar */}
      <div className="flex items-center justify-between pb-3 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-black/[0.04] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10 text-xs font-bold text-zinc-800 dark:text-zinc-200 transition-all cursor-pointer active:scale-95"
        >
          {isRtl ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
          <span>{translate(lang, "backToAlbums")}</span>
        </button>

        {album.isCustom && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsEditingName(!isEditingName)}
              title={translate(lang, "renameAlbum")}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/[0.04] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              title={translate(lang, "deleteAlbum")}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="glass-panel w-full max-w-sm rounded-3xl p-5 shadow-2xl flex flex-col gap-3.5">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {translate(lang, "deleteAlbumConfirm")}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {translate(lang, "deleteAlbumWarning")}
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 h-9 rounded-xl bg-black/[0.05] hover:bg-black/10 dark:bg-white/[0.06] text-xs font-bold text-zinc-700 dark:text-zinc-300"
              >
                {translate(lang, "cancel")}
              </button>
              <button
                type="button"
                onClick={handleDeleteAlbum}
                className="flex-1 h-9 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white shadow-md shadow-rose-600/25"
              >
                {translate(lang, "delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content (Scrollable list with sticky header) */}
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto pr-1">
        {/* Album Hero Header */}
        <div className="flex flex-col sm:flex-row items-center sm:items-end gap-5 p-5 rounded-3xl bg-gradient-to-b from-black/[0.04] to-transparent dark:from-white/[0.04] border border-black/[0.04] dark:border-white/[0.04] mb-4 shrink-0">
          {/* Cover Art */}
          <div className="relative aspect-square w-36 sm:w-44 rounded-2xl overflow-hidden shadow-2xl bg-zinc-800 shrink-0">
            {album.coverTrack ? (
              <TrackCover track={album.coverTrack} size="full" />
            ) : (
              <div className="flex flex-col items-center justify-center w-full h-full bg-gradient-to-br from-orange-500/30 to-purple-600/30 text-zinc-400">
                <Disc3 className="h-16 w-16 opacity-60" />
              </div>
            )}
          </div>

          {/* Details & Actions */}
          <div className="flex flex-col items-center sm:items-start text-center sm:text-start flex-1 min-w-0">
            {album.isCustom && (
              <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-bold mb-1.5 border border-amber-500/20">
                <Sparkles className="h-3 w-3" />
                <span>{translate(lang, "myAlbums")}</span>
              </div>
            )}

            {isEditingName ? (
              <form onSubmit={handleSaveName} className="flex items-center gap-2 mb-2 w-full max-w-sm">
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  autoFocus
                  className="flex-1 h-9 px-3 text-sm font-bold rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-orange-500 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                />
                <button
                  type="submit"
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500 text-white cursor-pointer"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingName(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/10 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </form>
            ) : (
              <h1 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-zinc-100 truncate w-full mb-1">
                {album.name}
              </h1>
            )}

            <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-4">
              <span>{translate(lang, "totalTracksCount", { count: album.trackCount })}</span>
              {album.totalDurationSecs > 0 && <span>•</span>}
              {album.totalDurationSecs > 0 && (
                <span>{formatDurationMin(album.totalDurationSecs)}</span>
              )}
            </div>

            {/* Play & Shuffle Buttons */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePlayAll}
                disabled={album.tracks.length === 0}
                className="flex items-center gap-2 px-5 h-11 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-xs shadow-lg shadow-orange-500/30 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {isThisAlbumPlaying ? (
                  <Pause className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="h-4 w-4 fill-current" />
                )}
                <span>{translate(lang, isThisAlbumPlaying ? "pauseSong" : "playAll")}</span>
              </button>

              <button
                type="button"
                onClick={handleShuffle}
                disabled={album.tracks.length === 0}
                className="flex items-center gap-2 px-4 h-11 rounded-2xl bg-black/[0.05] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10 text-zinc-800 dark:text-zinc-200 font-bold text-xs transition-all cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <Shuffle className="h-4 w-4" />
                <span>{translate(lang, "shuffle")}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Tracks List */}
        <div className="flex flex-col gap-1 pb-24">
          {album.tracks.length === 0 ? (
            <div className="py-12 text-center text-xs text-zinc-400 dark:text-zinc-500">
              {translate(lang, "emptyAlbum")}
            </div>
          ) : (
            album.tracks.map((track) => (
              <TrackRow
                key={track.id || track.uri}
                track={track}
                playlist={album.tracks}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
