import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../stores/useAppStore";
import { useMusicPlayerStore, filterAndSortTracks, isTrackLiked } from "../../stores/useMusicPlayerStore";
import { translate } from "../../i18n";
import type { MusicSortOption } from "../../types";
import { requestMediaPermissions, openAppSettings, hasNotificationPermission } from "../../utils/tauri";
import { isAndroid } from "../../utils/platform";
import { TrackRow } from "./TrackRow";
import { MultiSelectActionBar } from "./MultiSelectActionBar";
import {
  Search,
  X,
  ArrowUpDown,
  RotateCw,
  Heart,
  Music2,
  Check,
  Sparkles,
  Clock,
  ArrowDownAZ,
  ShieldAlert,
  BellOff,
} from "lucide-react";

interface SortItem {
  id: MusicSortOption;
  labelKey: "sortNewest" | "sortOldest" | "sortLiked" | "sortAlphabetical";
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

const SORT_OPTIONS: SortItem[] = [
  { id: "newest", labelKey: "sortNewest", icon: Sparkles },
  { id: "oldest", labelKey: "sortOldest", icon: Clock },
  { id: "liked", labelKey: "sortLiked", icon: Heart },
  { id: "title", labelKey: "sortAlphabetical", icon: ArrowDownAZ },
];

export interface TrackListViewProps {
  /** If true, only tracks that are liked will be listed */
  likedOnly?: boolean;
}

export function TrackListView({ likedOnly = false }: TrackListViewProps): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const tracks = useMusicPlayerStore((s) => s.tracks);
  const loading = useMusicPlayerStore((s) => s.loading);
  const hasScanned = useMusicPlayerStore((s) => s.hasScanned);
  const searchQuery = useMusicPlayerStore((s) => s.searchQuery);
  const sortBy = useMusicPlayerStore((s) => s.sortBy);
  const likedPaths = useMusicPlayerStore((s) => s.likedPaths);
  const permissionStatus = useMusicPlayerStore((s) => s.permissionStatus);
  const checkPermission = useMusicPlayerStore((s) => s.checkPermission);
  const scanLibrary = useMusicPlayerStore((s) => s.scanLibrary);
  const setSearchQuery = useMusicPlayerStore((s) => s.setSearchQuery);
  const setSortBy = useMusicPlayerStore((s) => s.setSortBy);

  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const [notifBlocked, setNotifBlocked] = useState(false);
  // Dismissal survives tab switches (which remount this view) for the session.
  const [notifDismissed, setNotifDismissed] = useState(() => {
    try {
      return sessionStorage.getItem("ac:notif-banner-dismissed") === "1";
    } catch {
      return false;
    }
  });
  const dismissNotifBanner = () => {
    try {
      sessionStorage.setItem("ac:notif-banner-dismissed", "1");
    } catch {}
    setNotifDismissed(true);
  };

  // Media notification (top bar + lock-screen controls) silently disappears
  // when system notifications are denied — while in-app playback keeps
  // working. Surface a guidance banner instead of a broken-looking player.
  useEffect(() => {
    if (!isAndroid()) return;
    let cancelled = false;
    const check = () => {
      void hasNotificationPermission().then((allowed) => {
        if (!cancelled) setNotifBlocked(!allowed);
      });
    };
    check();
    const onFocus = () => check();
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Auto-scan on initial mount if not yet scanned
  useEffect(() => {
    void checkPermission();
    if (!hasScanned && !loading) {
      void scanLibrary();
    }
  }, [hasScanned, loading, scanLibrary, checkPermission]);

  const handleRequestPermission = async () => {
    try {
      await requestMediaPermissions();
      await checkPermission();
      void scanLibrary();
    } catch (err) {
      console.warn("Permission request failed:", err);
    }
  };

  const handleOpenSettings = async () => {
    try {
      await openAppSettings();
    } catch (err) {
      console.warn("Open settings failed:", err);
    }
  };

  // Close sort menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    if (sortOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [sortOpen]);

  // Base list depending on mode (all vs liked only)
  const baseTracks = likedOnly ? tracks.filter((t) => isTrackLiked(t, likedPaths)) : tracks;
  const filteredTracks = filterAndSortTracks(baseTracks, searchQuery, sortBy, likedPaths);
  // Only warn once the outcome is actually known: on cold start the first
  // permission check can race the native bridge and report a transient
  // "denied" while the library scan is still running — showing the banner
  // then flashes it away seconds later. Gate on the finished scan instead.
  const isPermissionDenied =
    (permissionStatus === "denied" || permissionStatus === "permanentlyDenied") &&
    tracks.length === 0 &&
    hasScanned &&
    !loading;

  return (
    <div className="flex flex-col flex-1 w-full gap-3 min-h-0 overflow-hidden">
      {/* Permission Warning Banner (if denied on Android/Sandbox) */}
      {isPermissionDenied && (
        <div className="shrink-0 flex items-center justify-between gap-3 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="flex flex-col">
              <span className="text-xs font-bold">{translate(lang, "musicPermissionTitle")}</span>
              <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-medium">
                {translate(lang, "musicPermissionDesc")}
              </span>
            </div>
          </div>
          {permissionStatus === "permanentlyDenied" ? (
            <button
              type="button"
              onClick={handleOpenSettings}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold transition-all shrink-0 cursor-pointer shadow-sm"
            >
              {translate(lang, "openSettings")}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRequestPermission}
              className="px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-[11px] font-bold transition-all shrink-0 cursor-pointer shadow-sm"
            >
              {translate(lang, "grantPermission")}
            </button>
          )}
        </div>
      )}

      {/* Notification Guidance Banner (Android: media notification + lock-screen controls need this) */}
      {notifBlocked && !notifDismissed && tracks.length > 0 && (
        <div className="shrink-0 flex items-center justify-between gap-3 p-3 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-900 dark:text-sky-200">
          <div className="flex items-center gap-2.5 min-w-0">
            <BellOff className="h-5 w-5 text-sky-600 dark:text-sky-400 shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold">{translate(lang, "notifBannerTitle")}</span>
              <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-medium">
                {translate(lang, "notifBannerDesc")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleOpenSettings}
              className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold transition-all cursor-pointer shadow-sm"
            >
              {translate(lang, "openSettings")}
            </button>
            <button
              type="button"
              onClick={dismissNotifBanner}
              title={translate(lang, "close")}
              aria-label={translate(lang, "close")}
              className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Top Search & Filter Bar */}
      <div className="shrink-0 flex items-center gap-2 w-full">
        {/* Search Input Box */}
        <div className="relative flex-1 flex items-center">
          <Search className="absolute left-3.5 rtl:left-auto rtl:right-3.5 h-4 w-4 text-zinc-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={translate(lang, "searchSongsPlaceholder")}
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

        {/* Sort Menu Button */}
        <div className="relative" ref={sortRef}>
          <button
            type="button"
            onClick={() => setSortOpen(!sortOpen)}
            title={translate(lang, "sortByTitle")}
            aria-label={translate(lang, "sortByTitle")}
            className={`flex h-11 items-center gap-1.5 px-3.5 rounded-2xl border transition-all duration-200 cursor-pointer text-xs font-semibold shadow-sm active:scale-95 ${
              sortOpen
                ? "border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400"
                : "border-black/[0.08] bg-white/80 text-zinc-700 hover:bg-zinc-50 dark:border-white/[0.08] dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            <ArrowUpDown className="h-4 w-4" strokeWidth={2.2} />
            <span className="hidden sm:inline">
              {translate(
                lang,
                SORT_OPTIONS.find((s) => s.id === sortBy)?.labelKey || "sortNewest",
              )}
            </span>
          </button>

          {/* Sort Dropdown Popup */}
          {sortOpen && (
            <div className="absolute right-0 rtl:right-auto rtl:left-0 top-12 z-50 min-w-[200px] rounded-2xl border border-black/[0.08] bg-white/95 p-1.5 shadow-xl backdrop-blur-xl dark:border-white/[0.08] dark:bg-zinc-900/95 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                {translate(lang, "sortByTitle")}
              </div>
              <div className="flex flex-col gap-0.5">
                {SORT_OPTIONS.map((item) => {
                  const ItemIcon = item.icon;
                  const isSelected = sortBy === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSortBy(item.id);
                        setSortOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-orange-500 text-white shadow-sm"
                          : "text-zinc-700 hover:bg-black/[0.04] dark:text-zinc-300 dark:hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <ItemIcon className="h-3.5 w-3.5" />
                        <span>{translate(lang, item.labelKey)}</span>
                      </div>
                      {isSelected && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Rescan Button */}
        <button
          type="button"
          onClick={() => scanLibrary()}
          disabled={loading}
          title={translate(lang, "rescanLibrary")}
          aria-label={translate(lang, "rescanLibrary")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-black/[0.08] bg-white/80 text-zinc-600 hover:bg-zinc-50 dark:border-white/[0.08] dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer"
        >
          <RotateCw className={`h-4 w-4 ${loading ? "animate-spin text-orange-500" : ""}`} />
        </button>
      </div>

      {/* Main Track List Container */}
      <div className="glass-panel flex-1 flex flex-col rounded-3xl p-3 sm:p-4 min-h-0 overflow-hidden shadow-sm">
        {/* List Header Count */}
        <div className="shrink-0 flex items-center justify-between pb-2.5 border-b border-black/[0.05] dark:border-white/[0.05] px-1">
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300">
            {likedOnly ? (
              <Heart className="h-4 w-4 text-rose-500 fill-rose-500" />
            ) : (
              <Music2 className="h-4 w-4 text-orange-500" />
            )}
            <span>
              {filteredTracks.length === 1
                ? translate(lang, "singleSong")
                : translate(lang, "songCount").replace("{count}", String(filteredTracks.length))}
            </span>
          </div>
          {loading && (
            <span className="text-[11px] text-zinc-400 animate-pulse font-medium">
              {translate(lang, "scanningLibrary")}
            </span>
          )}
        </div>

        {/* Content Rows or Empty States */}
        {loading && tracks.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center min-h-[200px] gap-3 p-8 text-center">
            <RotateCw className="h-8 w-8 text-orange-500 animate-spin" />
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {translate(lang, "scanningLibrary")}
            </p>
          </div>
        ) : baseTracks.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center min-h-[200px] gap-3 p-8 text-center">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-3xl border shadow-lg ${
                likedOnly
                  ? "bg-rose-500/10 text-rose-500 border-rose-500/20 shadow-rose-500/10"
                  : "bg-orange-500/10 text-orange-500 border-orange-500/20 shadow-orange-500/10"
              }`}
            >
              {likedOnly ? (
                <Heart className="h-8 w-8 fill-rose-500" />
              ) : (
                <Music2 className="h-8 w-8" />
              )}
            </div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              {translate(lang, likedOnly ? "noLikedSongs" : "noSongsFound")}
            </h3>
            {likedOnly && (
              <p className="max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
                {translate(lang, "noLikedSongsHint")}
              </p>
            )}
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center min-h-[200px] gap-2 p-8 text-center">
            <Music2 className="h-7 w-7 text-zinc-400" />
            <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
              {translate(lang, "noSongsMatchingQuery").replace("{query}", searchQuery)}
            </h3>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="mt-1 text-xs font-semibold text-orange-500 hover:underline cursor-pointer"
              >
                {translate(lang, "searchClear")}
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-black/[0.04] dark:divide-white/[0.04] pr-1 pb-24">
            {filteredTracks.map((track) => (
              <TrackRow
                key={track.id || track.uri}
                track={track}
                playlist={filteredTracks}
              />
            ))}
          </div>
        )}
      </div>

      {/* Multi-Select Floating Bottom Action Bar */}
      <MultiSelectActionBar tracks={filteredTracks} />
    </div>
  );
}
