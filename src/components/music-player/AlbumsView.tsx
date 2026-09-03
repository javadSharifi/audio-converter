import React, { useState, useMemo } from "react";
import { useAppStore } from "../../stores/useAppStore";
import {
  useMusicPlayerStore,
  computeAllAlbums,
} from "../../stores/useMusicPlayerStore";
import { translate } from "../../i18n";
import { AlbumCard } from "./AlbumCard";
import { AlbumDetailView } from "./AlbumDetailView";
import {
  Search,
  Plus,
  Disc3,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type { AlbumItem } from "../../types";

export function AlbumsView(): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const pushToast = useAppStore((s) => s.pushToast);
  const tracks = useMusicPlayerStore((s) => s.tracks);
  const customAlbums = useMusicPlayerStore((s) => s.customAlbums);
  const createCustomAlbum = useMusicPlayerStore((s) => s.createCustomAlbum);
  const renameCustomAlbum = useMusicPlayerStore((s) => s.renameCustomAlbum);
  const deleteCustomAlbum = useMusicPlayerStore((s) => s.deleteCustomAlbum);
  const playTrack = useMusicPlayerStore((s) => s.playTrack);
  const pauseTrack = useMusicPlayerStore((s) => s.pauseTrack);
  const resumeTrack = useMusicPlayerStore((s) => s.resumeTrack);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);

  // Dialog states for Create / Rename / Delete
  const [isCreatingAlbum, setIsCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [editingAlbum, setEditingAlbum] = useState<{ id: string; name: string } | null>(null);
  const [deletingAlbum, setDeletingAlbum] = useState<AlbumItem | null>(null);

  // Compute all albums (Custom in row 1, Artist albums below)
  const { custom: allCustom, auto: allAuto } = useMemo(() => {
    return computeAllAlbums(tracks, customAlbums);
  }, [tracks, customAlbums]);

  // Filter albums by search query
  const q = searchQuery.trim().toLowerCase();
  const filteredCustom = useMemo(() => {
    if (!q) return allCustom;
    return allCustom.filter((a) => a.name.toLowerCase().includes(q));
  }, [allCustom, q]);

  const filteredAuto = useMemo(() => {
    if (!q) return allAuto;
    return allAuto.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.artist && a.artist.toLowerCase().includes(q)),
    );
  }, [allAuto, q]);

  // If an album is currently selected, display its detail page
  const activeAlbum = useMemo(() => {
    if (!selectedAlbumId) return null;
    return (
      allCustom.find((a) => a.id === selectedAlbumId) ||
      allAuto.find((a) => a.id === selectedAlbumId) ||
      null
    );
  }, [selectedAlbumId, allCustom, allAuto]);

  if (activeAlbum) {
    return (
      <AlbumDetailView
        album={activeAlbum}
        onBack={() => setSelectedAlbumId(null)}
      />
    );
  }

  const handlePlayAlbum = async (album: AlbumItem) => {
    if (album.tracks.length === 0) return;
    const isThisAlbumActive =
      currentTrack !== null &&
      album.tracks.some(
        (t) => t.id === currentTrack.id || t.uri === currentTrack.uri,
      );

    if (isThisAlbumActive) {
      if (isPlaying) {
        pauseTrack();
      } else {
        resumeTrack();
      }
    } else {
      await playTrack(album.tracks[0], album.tracks);
    }
  };

  const handleCreateAlbum = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newAlbumName.trim();
    if (!trimmed) return;
    createCustomAlbum(trimmed);
    pushToast("info", translate(lang, "createAlbum"));
    setNewAlbumName("");
    setIsCreatingAlbum(false);
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAlbum || !editingAlbum.name.trim()) return;
    renameCustomAlbum(editingAlbum.id, editingAlbum.name.trim());
    setEditingAlbum(null);
  };

  const handleDeleteConfirm = () => {
    if (!deletingAlbum) return;
    deleteCustomAlbum(deletingAlbum.id);
    pushToast("info", translate(lang, "deleteAlbum"));
    setDeletingAlbum(null);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
      {/* Search Bar & Create Button */}
      <div className="shrink-0 flex items-center gap-2 w-full pb-1">
        <div className="relative flex-1 flex items-center">
          <Search className="absolute left-3.5 rtl:left-auto rtl:right-3.5 h-4 w-4 text-zinc-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={translate(lang, "searchAlbumsPlaceholder")}
            className="w-full h-11 pl-10 pr-9 rtl:pl-9 rtl:pr-10 rounded-2xl bg-white/80 dark:bg-zinc-800/80 border border-black/[0.08] dark:border-white/[0.08] text-xs font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:border-orange-500 dark:focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-sm transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              title={translate(lang, "searchClear")}
              className="absolute right-3 rtl:right-auto rtl:left-3 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600 transition-colors cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsCreatingAlbum(true)}
          className="flex items-center gap-1.5 h-11 px-3.5 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-xs font-bold shadow-md shadow-orange-500/20 transition-all cursor-pointer active:scale-95 shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{translate(lang, "createAlbum")}</span>
        </button>
      </div>

      {/* Create Modal */}
      {isCreatingAlbum && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <form
            onSubmit={handleCreateAlbum}
            className="glass-panel w-full max-w-sm rounded-3xl p-5 shadow-2xl flex flex-col gap-3.5"
          >
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {translate(lang, "createAlbumPrompt")}
            </h3>
            <input
              type="text"
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              placeholder={translate(lang, "albumNamePlaceholder")}
              autoFocus
              className="h-10 px-3.5 text-xs rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
            />
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsCreatingAlbum(false);
                  setNewAlbumName("");
                }}
                className="flex-1 h-9 rounded-xl bg-black/[0.05] hover:bg-black/10 dark:bg-white/[0.06] text-xs font-bold text-zinc-700 dark:text-zinc-300 cursor-pointer"
              >
                {translate(lang, "cancel")}
              </button>
              <button
                type="submit"
                disabled={!newAlbumName.trim()}
                className="flex-1 h-9 rounded-xl bg-orange-500 hover:bg-orange-600 text-xs font-bold text-white shadow-md shadow-orange-500/20 disabled:opacity-50 cursor-pointer"
              >
                {translate(lang, "create")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rename Modal */}
      {editingAlbum && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <form
            onSubmit={handleRenameSubmit}
            className="glass-panel w-full max-w-sm rounded-3xl p-5 shadow-2xl flex flex-col gap-3.5"
          >
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {translate(lang, "renameAlbumPrompt")}
            </h3>
            <input
              type="text"
              value={editingAlbum.name}
              onChange={(e) =>
                setEditingAlbum({ ...editingAlbum, name: e.target.value })
              }
              autoFocus
              className="h-10 px-3.5 text-xs rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
            />
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditingAlbum(null)}
                className="flex-1 h-9 rounded-xl bg-black/[0.05] hover:bg-black/10 dark:bg-white/[0.06] text-xs font-bold text-zinc-700 dark:text-zinc-300 cursor-pointer"
              >
                {translate(lang, "cancel")}
              </button>
              <button
                type="submit"
                disabled={!editingAlbum.name.trim()}
                className="flex-1 h-9 rounded-xl bg-orange-500 hover:bg-orange-600 text-xs font-bold text-white shadow-md shadow-orange-500/20 disabled:opacity-50 cursor-pointer"
              >
                {translate(lang, "save")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Modal */}
      {deletingAlbum && (
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
                onClick={() => setDeletingAlbum(null)}
                className="flex-1 h-9 rounded-xl bg-black/[0.05] hover:bg-black/10 dark:bg-white/[0.06] text-xs font-bold text-zinc-700 dark:text-zinc-300 cursor-pointer"
              >
                {translate(lang, "cancel")}
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="flex-1 h-9 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white shadow-md shadow-rose-600/25 cursor-pointer"
              >
                {translate(lang, "delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable Container with Sections */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-24 flex flex-col gap-6">
        {/* ================================================================= */}
        {/* SECTION 1: My Custom Albums (Row 1 / Priority)                   */}
        {/* ================================================================= */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
                {translate(lang, "myAlbums")}
              </h2>
            </div>
            <span className="text-xs text-zinc-400 font-medium">
              {translate(lang, "totalTracksCount", { count: filteredCustom.length })}
            </span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-3.5">
            {/* First Item: + New Album Dashed Action Card */}
            <button
              type="button"
              onClick={() => setIsCreatingAlbum(true)}
              className="flex flex-col items-center justify-center aspect-square p-2 sm:p-4 rounded-2xl sm:rounded-3xl border-2 border-dashed border-orange-500/40 hover:border-orange-500 bg-orange-500/[0.03] hover:bg-orange-500/[0.08] text-orange-600 dark:text-orange-400 transition-all duration-200 cursor-pointer group active:scale-95 shadow-sm"
            >
              <div className="flex h-9 w-9 sm:h-12 sm:w-12 items-center justify-center rounded-xl sm:rounded-2xl bg-orange-500/10 dark:bg-orange-500/20 group-hover:scale-110 transition-transform mb-1 sm:mb-2">
                <Plus className="h-4 w-4 sm:h-6 sm:w-6" />
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-center leading-tight">
                {translate(lang, "createAlbum")}
              </span>
            </button>

            {/* Custom Album Cards */}
            {filteredCustom.map((album) => (
              <AlbumCard
                key={album.id}
                album={album}
                onClick={() => setSelectedAlbumId(album.id)}
                onPlay={() => void handlePlayAlbum(album)}
                onRename={() => setEditingAlbum({ id: album.id, name: album.name })}
                onDelete={() => setDeletingAlbum(album)}
              />
            ))}
          </div>
        </div>

        {/* ================================================================= */}
        {/* SECTION 2: Artists & Library Albums                              */}
        {/* ================================================================= */}
        <div className="flex flex-col gap-3 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-orange-500" />
              <h2 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
                {translate(lang, "allArtistsAndAlbums")}
              </h2>
            </div>
            <span className="text-xs text-zinc-400 font-medium">
              {translate(lang, "totalTracksCount", { count: filteredAuto.length })}
            </span>
          </div>

          {filteredAuto.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-zinc-400 dark:text-zinc-500">
              <Disc3 className="h-10 w-10 mb-2 opacity-40" />
              <span className="text-xs">{translate(lang, "noAlbumsFound")}</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-3.5">
              {filteredAuto.map((album) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  onClick={() => setSelectedAlbumId(album.id)}
                  onPlay={() => void handlePlayAlbum(album)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
