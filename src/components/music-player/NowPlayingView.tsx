import React, { useState, useMemo } from "react";
import { useAppStore } from "../../stores/useAppStore";
import { useMusicPlayerStore, isTrackLiked } from "../../stores/useMusicPlayerStore";
import { translate } from "../../i18n";
import { TrackCover } from "./TrackCover";
import { WaveformSeekbar } from "./WaveformSeekbar";
import { TrackOptionsSheet } from "./TrackOptionsSheet";
import {
  ChevronDown,
  MoreHorizontal,
  Heart,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Repeat1,
  Shuffle,
  Gauge,
  Flame,
  ArrowLeftRight,
  ListMusic,
  Search,
  X,
  Volume2,
  RotateCcw,
} from "lucide-react";

const SPEED_PRESETS = [0.5, 1.0, 1.5, 2.0, 2.5];
const BOOST_PRESETS = [
  { label: "100%", value: 100 },
  { label: "150%", value: 150 },
  { label: "200%", value: 200 },
  { label: "300%", value: 300 },
  { label: "400%", value: 400 },
];

export function NowPlayingView(): React.JSX.Element | null {
  const lang = useAppStore((s) => s.lang);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const addPaths = useAppStore((s) => s.addPaths);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const currentTime = useMusicPlayerStore((s) => s.currentTime);
  const duration = useMusicPlayerStore((s) => s.duration);
  const currentPlaylist = useMusicPlayerStore((s) => s.currentPlaylist);
  const tracks = useMusicPlayerStore((s) => s.tracks);
  const repeatMode = useMusicPlayerStore((s) => s.repeatMode);
  const shuffleMode = useMusicPlayerStore((s) => s.shuffleMode);
  const playbackRate = useMusicPlayerStore((s) => s.playbackRate);
  const volumeGainPercent = useMusicPlayerStore((s) => s.volumeGainPercent);
  const fullscreenOpen = useMusicPlayerStore((s) => s.fullscreenOpen);
  const setFullscreenOpen = useMusicPlayerStore((s) => s.setFullscreenOpen);
  const playTrack = useMusicPlayerStore((s) => s.playTrack);
  const pauseTrack = useMusicPlayerStore((s) => s.pauseTrack);
  const resumeTrack = useMusicPlayerStore((s) => s.resumeTrack);
  const playNextTrack = useMusicPlayerStore((s) => s.playNextTrack);
  const playPreviousTrack = useMusicPlayerStore((s) => s.playPreviousTrack);
  const seekTo = useMusicPlayerStore((s) => s.seekTo);
  const toggleRepeat = useMusicPlayerStore((s) => s.toggleRepeat);
  const toggleShuffle = useMusicPlayerStore((s) => s.toggleShuffle);
  const setPlaybackRate = useMusicPlayerStore((s) => s.setPlaybackRate);
  const setVolumeGainPercent = useMusicPlayerStore((s) => s.setVolumeGainPercent);
  const likedPaths = useMusicPlayerStore((s) => s.likedPaths);
  const toggleLike = useMusicPlayerStore((s) => s.toggleLike);

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [boosterOpen, setBoosterOpen] = useState(false);
  const [desktopSearch, setDesktopSearch] = useState("");

  // Active playlist
  const activeList = useMemo(() => {
    return currentPlaylist.length > 0 ? currentPlaylist : tracks;
  }, [currentPlaylist, tracks]);

  const desktopFilteredList = useMemo(() => {
    if (!desktopSearch.trim()) return activeList;
    const q = desktopSearch.toLowerCase();
    return activeList.filter(
      (t) =>
        t.title?.toLowerCase().includes(q) ||
        t.name?.toLowerCase().includes(q) ||
        t.artist?.toLowerCase().includes(q) ||
        t.album?.toLowerCase().includes(q),
    );
  }, [activeList, desktopSearch]);

  if (!fullscreenOpen || !currentTrack) return null;

  const currentIndex = activeList.findIndex(
    (t) => t.id === currentTrack.id || t.uri === currentTrack.uri,
  );
  const trackCounter = `${currentIndex >= 0 ? currentIndex + 1 : 1}/${activeList.length || 1}`;
  const playlistName = currentTrack.album || translate(lang, "nowPlayingTitle");
  const isLiked = isTrackLiked(currentTrack, likedPaths);

  const handleTogglePlay = () => {
    if (isPlaying) {
      pauseTrack();
    } else {
      resumeTrack();
    }
  };

  const handleOpenInConverter = () => {
    if (currentTrack) {
      const targetPath = currentTrack.path || currentTrack.uri;
      if (targetPath) {
        void addPaths([targetPath]);
      }
    }
    setFullscreenOpen(false);
    setActiveTool("converter");
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col w-full h-full min-h-0 bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 p-4 sm:p-6 pb-24 sm:pb-28 select-none overflow-hidden justify-between animate-in slide-in-from-bottom duration-300">
      {/* Top Ambient Glow */}
      <div className="absolute top-0 inset-x-0 h-48 bg-gradient-to-b from-orange-500/15 via-amber-500/5 to-transparent pointer-events-none" />

      {/* Main Container: Split into 2 columns on desktop (lg:flex-row) */}
      <div className="relative z-10 flex flex-col lg:flex-row flex-1 w-full min-h-0 gap-6 overflow-hidden max-w-5xl mx-auto">
        {/* =============================================================== */}
        {/* LEFT COLUMN: MAIN MUSIC PLAYER                                  */}
        {/* =============================================================== */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0 justify-between overflow-hidden max-w-xl mx-auto w-full">
          {/* =============================================================== */}
          {/* 1. TOP HEADER BAR                                               */}
          {/* =============================================================== */}
          <div className="relative z-10 flex items-center justify-between pb-2 shrink-0">
            {/* Collapse / Minimize / Back Button */}
            <button
              type="button"
              onClick={() => setFullscreenOpen(false)}
              title={translate(lang, "collapsePlayer")}
              className="flex items-center gap-1.5 h-9 px-3 rounded-2xl bg-black/[0.05] hover:bg-black/10 dark:bg-white/[0.08] dark:hover:bg-white/15 text-zinc-800 dark:text-zinc-200 transition-all cursor-pointer active:scale-95 shadow-sm"
            >
              <ChevronDown className="h-4 w-4 stroke-[2.5]" />
              <span className="text-xs font-bold">{lang === "fa" ? "بازگشت" : "Back"}</span>
            </button>

            {/* Center Info */}
            <div className="flex flex-col items-center text-center">
              <span className="text-[11px] font-mono font-bold tracking-widest text-orange-600 dark:text-orange-400">
                {trackCounter}
              </span>
              <span className="text-xs sm:text-sm font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight truncate max-w-[200px]">
                {playlistName}
              </span>
            </div>

            {/* 3-Dots Options Button */}
            <button
              type="button"
              onClick={() => setOptionsOpen(true)}
              title={translate(lang, "moreOptions")}
              className="flex h-9 w-9 items-center justify-center rounded-2xl bg-black/[0.04] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/15 text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer active:scale-90"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </div>

          {/* =============================================================== */}
          {/* 2. HERO CENTER CARD: LARGE ALBUM ARTWORK                        */}
          {/* =============================================================== */}
          <div className="relative z-10 flex-1 min-h-0 my-2 flex items-center justify-center">
            <div className="relative aspect-square max-h-full max-w-[280px] sm:max-w-[320px] w-full rounded-3xl overflow-hidden shadow-2xl border border-black/10 dark:border-white/10 bg-zinc-800 flex items-center justify-center">
              <TrackCover track={currentTrack} size="full" className="rounded-3xl" />
            </div>
          </div>

          {/* =============================================================== */}
          {/* 3. TOOLBAR: Converter, Speed, Booster, Repeat, Shuffle, Queue   */}
          {/* =============================================================== */}
          <div className="relative z-10 flex items-center justify-between gap-2 py-1.5 shrink-0">
            {/* Left: Converter integration button */}
            <button
              type="button"
              onClick={handleOpenInConverter}
              title={translate(lang, "openInConverter")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/25 text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-sm"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              <span>{translate(lang, "converterTool")}</span>
            </button>

            {/* Right: Speed, Sound Booster, Repeat, Shuffle, Queue */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Playback Speed Controller with Micro Badge */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setSpeedOpen(!speedOpen);
                    setBoosterOpen(false);
                  }}
                  title={translate(lang, "playbackSpeed")}
                  className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold transition-colors cursor-pointer active:scale-90 ${
                    playbackRate !== 1.0
                      ? "text-orange-600 dark:text-orange-400 bg-orange-500/15 border border-orange-500/30"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  }`}
                >
                  <Gauge className="h-4 w-4" />
                </button>
                {playbackRate !== 1.0 && (
                  <span className="absolute -top-1.5 -end-1 px-1 py-0.2 min-w-4 text-center text-[9px] font-extrabold font-mono rounded-full bg-orange-500 text-white leading-tight shadow-sm pointer-events-none">
                    {playbackRate}x
                  </span>
                )}
              </div>

              {/* Real-time Sound Booster with Micro Badge */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setBoosterOpen(!boosterOpen);
                    setSpeedOpen(false);
                  }}
                  title={translate(lang, "soundBooster")}
                  className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold transition-colors cursor-pointer active:scale-90 ${
                    volumeGainPercent > 100
                      ? "text-amber-500 bg-amber-500/15 border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.25)]"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  }`}
                >
                  <Flame className="h-4 w-4 text-orange-500" />
                </button>
                {volumeGainPercent > 100 && (
                  <span className="absolute -top-1.5 -end-1 px-1 py-0.2 min-w-4 text-center text-[9px] font-extrabold font-mono rounded-full bg-amber-500 text-white leading-tight shadow-sm pointer-events-none">
                    {volumeGainPercent}%
                  </span>
                )}
              </div>

              {/* Repeat Toggle */}
              <button
                type="button"
                onClick={toggleRepeat}
                title={translate(
                  lang,
                  repeatMode === "one"
                    ? "repeatOne"
                    : repeatMode === "all"
                    ? "repeatAll"
                    : "repeatOff",
                )}
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors cursor-pointer active:scale-90 ${
                  repeatMode !== "off"
                    ? "text-orange-600 dark:text-orange-400 bg-orange-500/15 border border-orange-500/30"
                    : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                }`}
              >
                {repeatMode === "one" ? (
                  <Repeat1 className="h-4 w-4" />
                ) : (
                  <Repeat className="h-4 w-4" />
                )}
              </button>

              {/* Shuffle Toggle */}
              <button
                type="button"
                onClick={toggleShuffle}
                title={translate(lang, shuffleMode ? "shuffleOn" : "shuffleOff")}
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors cursor-pointer active:scale-90 ${
                  shuffleMode
                    ? "text-orange-600 dark:text-orange-400 bg-orange-500/15 border border-orange-500/30"
                    : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                }`}
              >
                <Shuffle className="h-4 w-4" />
              </button>

              {/* Mobile Queue Toggle (hidden on desktop where queue is side-by-side) */}
              <button
                type="button"
                onClick={() => {
                  setQueueOpen(!queueOpen);
                  setSpeedOpen(false);
                  setBoosterOpen(false);
                }}
                title={translate(lang, "queueDrawer")}
                className={`lg:hidden flex h-9 w-9 items-center justify-center rounded-xl transition-colors cursor-pointer active:scale-90 ${
                  queueOpen
                    ? "text-orange-600 dark:text-orange-400 bg-orange-500/15 border border-orange-500/30"
                    : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                }`}
              >
                <ListMusic className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* =============================================================== */}
          {/* 4. TRACK METADATA & LIKE BUTTON ROW                             */}
          {/* =============================================================== */}
          <div className="relative z-10 flex items-center justify-between gap-4 pt-1 pb-1 shrink-0">
            <div className="flex flex-col min-w-0 flex-1">
              <h1 className="text-lg sm:text-xl font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight truncate">
                {currentTrack.title || currentTrack.name}
              </h1>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                {currentTrack.artist || "Unknown Artist"}
              </p>
            </div>

            {/* Heart/Like Button */}
            <button
              type="button"
              onClick={() => toggleLike(currentTrack)}
              title={translate(lang, isLiked ? "unlikeTrack" : "likeTrack")}
              className={`relative flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200 cursor-pointer active:scale-90 ${
                isLiked
                  ? "text-rose-500 bg-rose-500/10 dark:bg-rose-500/20 border border-rose-500/30 shadow-sm"
                  : "text-zinc-400 hover:text-rose-500 bg-black/[0.04] dark:bg-white/[0.06] border border-black/5 dark:border-white/5"
              }`}
            >
              <Heart
                className={`h-5 w-5 ${isLiked ? "fill-rose-500 scale-110" : ""}`}
                strokeWidth={isLiked ? 0 : 2}
              />
            </button>
          </div>

          {/* =============================================================== */}
          {/* 5. WAVEFORM VISUALIZER & PROGRESS SCRUBBING                      */}
          {/* =============================================================== */}
          <div className="relative z-10 py-1 shrink-0">
            <WaveformSeekbar
              currentTime={currentTime}
              duration={duration}
              onSeek={(newTime) => seekTo(newTime)}
              trackSeed={currentTrack.id || currentTrack.name}
            />
          </div>

          {/* =============================================================== */}
          {/* 6. HALO PLAYBACK CONTROLS (Prev / Halo Play / Next)              */}
          {/* =============================================================== */}
          <div className="relative z-10 flex items-center justify-center gap-6 sm:gap-8 py-2 pb-1 shrink-0">
            {/* Previous Track */}
            <button
              type="button"
              onClick={() => void playPreviousTrack()}
              title={translate(lang, "previousSong")}
              className="flex h-12 w-12 items-center justify-center rounded-2xl text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-all cursor-pointer active:scale-90"
            >
              <SkipBack className="h-6 w-6 stroke-[2]" />
            </button>

            {/* HALO PLAY / PAUSE BUTTON */}
            <div className="relative flex items-center justify-center">
              {/* Pulsing ambient glowing rings when active */}
              {isPlaying && (
                <>
                  <div className="absolute -inset-2.5 rounded-full bg-orange-500/25 blur-md animate-pulse pointer-events-none" />
                  <div className="absolute -inset-1 rounded-full bg-amber-500/40 blur-sm pointer-events-none" />
                </>
              )}

              <button
                type="button"
                onClick={handleTogglePlay}
                title={translate(lang, isPlaying ? "pauseSong" : "playSong")}
                className={`relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-tr from-orange-500 via-amber-500 to-orange-400 text-white shadow-xl transition-transform duration-200 cursor-pointer active:scale-90 hover:scale-105 ${
                  isPlaying ? "shadow-orange-500/40" : "shadow-orange-500/20"
                }`}
              >
                {isPlaying ? (
                  <Pause className="h-7 w-7 fill-white" />
                ) : (
                  <Play className="h-7 w-7 fill-white translate-x-0.5" />
                )}
              </button>
            </div>

            {/* Next Track */}
            <button
              type="button"
              onClick={() => void playNextTrack()}
              title={translate(lang, "nextSong")}
              className="flex h-12 w-12 items-center justify-center rounded-2xl text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-all cursor-pointer active:scale-90"
            >
              <SkipForward className="h-6 w-6 stroke-[2]" />
            </button>
          </div>
        </div>

        {/* =============================================================== */}
        {/* RIGHT COLUMN: DESKTOP QUEUE SIDEBAR (lg: & xl: screens)          */}
        {/* =============================================================== */}
        <div className="hidden lg:flex flex-col lg:w-80 xl:w-96 shrink-0 rounded-3xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06] p-4 min-h-0 overflow-hidden shadow-inner">
          {/* Desktop Sidebar Header */}
          <div className="flex items-center justify-between pb-3 border-b border-black/[0.06] dark:border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400">
                <ListMusic className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <h2 className="text-xs font-extrabold text-zinc-900 dark:text-zinc-100">
                  {translate(lang, "queueDrawer")}
                </h2>
                <span className="text-[10px] text-zinc-400 font-semibold">
                  {activeList.length} {lang === "fa" ? "آهنگ" : "songs"}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Search in Queue */}
          <div className="relative my-2.5 shrink-0">
            <Search className="absolute left-3 rtl:left-auto rtl:right-3 top-2.5 h-3.5 w-3.5 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              value={desktopSearch}
              onChange={(e) => setDesktopSearch(e.target.value)}
              placeholder={translate(lang, "searchSongsPlaceholder")}
              className="w-full h-8 pl-8 pr-7 rtl:pl-7 rtl:pr-8 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/5 dark:border-white/5 text-[11px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:ring-1 focus:ring-orange-500/30"
            />
            {desktopSearch && (
              <button
                type="button"
                onClick={() => setDesktopSearch("")}
                className="absolute right-2 rtl:right-auto rtl:left-2 top-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Desktop Queue Tracks List */}
          <div className="flex-1 overflow-y-auto divide-y divide-black/[0.03] dark:divide-white/[0.03] pr-1 space-y-0.5 min-h-0">
            {desktopFilteredList.map((track, idx) => {
              const isCurrent =
                currentTrack &&
                (track.id === currentTrack.id || track.uri === currentTrack.uri);
              return (
                <div
                  key={track.id || track.uri || idx}
                  onClick={() => void playTrack(track, activeList)}
                  className={`group flex items-center justify-between p-2 rounded-2xl transition-all cursor-pointer select-none ${
                    isCurrent
                      ? "bg-orange-500/10 dark:bg-orange-500/20 border border-orange-500/30 text-orange-600 dark:text-orange-400"
                      : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04] text-zinc-700 dark:text-zinc-300 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <TrackCover track={track} size="sm" />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span
                        className={`text-xs font-bold truncate ${
                          isCurrent
                            ? "text-orange-600 dark:text-orange-400"
                            : "group-hover:text-orange-600 dark:group-hover:text-orange-400"
                        }`}
                      >
                        {track.title || track.name}
                      </span>
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                        {track.artist || "Unknown Artist"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isCurrent && isPlaying ? (
                      <div className="flex items-end gap-0.5 h-3 px-1">
                        <span className="w-1 bg-orange-500 rounded-full animate-music-bar-1" />
                        <span className="w-1 bg-orange-500 rounded-full animate-music-bar-2" />
                        <span className="w-1 bg-orange-500 rounded-full animate-music-bar-3" />
                      </div>
                    ) : (
                      <span className="text-[10px] font-mono text-zinc-400">
                        {Math.floor((track.durationSecs || 0) / 60)}:
                        {String(Math.floor((track.durationSecs || 0) % 60)).padStart(2, "0")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 7. PLAYBACK SPEED POPUP (0.5x to 2.5x with Reset)                 */}
      {/* ================================================================= */}
      {speedOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="absolute inset-0" onClick={() => setSpeedOpen(false)} />

          <div
            className="relative z-10 w-full max-w-lg mx-auto rounded-t-3xl bg-white dark:bg-zinc-900 border-t border-black/10 dark:border-white/10 shadow-2xl p-5 flex flex-col gap-4 animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-black/[0.06] dark:border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-orange-500" />
                <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  {translate(lang, "playbackSpeed")}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPlaybackRate(1.0)}
                  title={translate(lang, "resetSpeed")}
                  className="flex items-center gap-1 h-7 px-2.5 rounded-full bg-black/[0.05] hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 text-[11px] font-bold text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer active:scale-95"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>{translate(lang, "reset")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSpeedOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/10 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Speed Presets Grid (0.5x, 1x, 1.5x, 2x, 2.5x) */}
            <div className="grid grid-cols-5 gap-2">
              {SPEED_PRESETS.map((preset) => {
                const isSelected = playbackRate === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setPlaybackRate(preset);
                      setSpeedOpen(false);
                    }}
                    className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isSelected
                        ? "bg-orange-500 text-white shadow-md shadow-orange-500/25"
                        : "bg-black/[0.04] dark:bg-white/[0.06] text-zinc-700 dark:text-zinc-300 hover:bg-orange-500/10"
                    }`}
                  >
                    {preset}x
                  </button>
                );
              })}
            </div>

            {/* Slider for continuous speed tuning (Strictly LTR) */}
            <div dir="ltr" className="flex flex-col gap-1.5 pt-1">
              <div className="flex justify-between text-xs font-medium text-zinc-500">
                <span>0.5x</span>
                <span className="font-bold text-orange-500">{playbackRate}x</span>
                <span>2.5x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.05"
                value={playbackRate}
                onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-orange-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 8. SOUND BOOSTER POPUP (100% to 400% with Reset)                  */}
      {/* ================================================================= */}
      {boosterOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="absolute inset-0" onClick={() => setBoosterOpen(false)} />

          <div
            className="relative z-10 w-full max-w-lg mx-auto rounded-t-3xl bg-white dark:bg-zinc-900 border-t border-black/10 dark:border-white/10 shadow-2xl p-5 flex flex-col gap-4 animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-black/[0.06] dark:border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-orange-500" />
                <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  {translate(lang, "soundBooster")}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVolumeGainPercent(100)}
                  title={translate(lang, "resetBoost")}
                  className="flex items-center gap-1 h-7 px-2.5 rounded-full bg-black/[0.05] hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 text-[11px] font-bold text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer active:scale-95"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>{translate(lang, "reset")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBoosterOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/10 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Booster Preset Buttons */}
            <div className="grid grid-cols-5 gap-2">
              {BOOST_PRESETS.map((preset) => {
                const isSelected = volumeGainPercent === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      setVolumeGainPercent(preset.value);
                      setBoosterOpen(false);
                    }}
                    className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isSelected
                        ? "bg-amber-500 text-white shadow-md shadow-amber-500/25"
                        : "bg-black/[0.04] dark:bg-white/[0.06] text-zinc-700 dark:text-zinc-300 hover:bg-amber-500/10"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Booster Slider (Strictly LTR) */}
            <div dir="ltr" className="flex flex-col gap-1.5 pt-1">
              <div className="flex justify-between text-xs font-medium text-zinc-500">
                <span className="flex items-center gap-1">
                  <Volume2 className="h-3.5 w-3.5" /> 100%
                </span>
                <span className="font-bold text-orange-500">
                  {translate(lang, "boostLevel", { percent: volumeGainPercent })}
                </span>
                <span>400% (Max)</span>
              </div>
              <input
                type="range"
                min="100"
                max="400"
                step="10"
                value={volumeGainPercent}
                onChange={(e) => setVolumeGainPercent(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-orange-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 9. MOBILE QUEUE / UP NEXT SLIDE-UP DRAWER                         */}
      {/* ================================================================= */}
      {queueOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/50 backdrop-blur-sm animate-in fade-in duration-150 lg:hidden">
          <div className="absolute inset-0" onClick={() => setQueueOpen(false)} />

          <div
            className="relative z-10 w-full rounded-t-3xl bg-white dark:bg-zinc-900 border-t border-black/10 dark:border-white/10 shadow-2xl p-4 flex flex-col gap-2.5 max-h-[65%] overflow-hidden animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-2 border-b border-black/[0.06] dark:border-white/[0.06]">
              <div className="flex items-center gap-2">
                <ListMusic className="h-4 w-4 text-orange-500" />
                <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  {translate(lang, "queueDrawer")} ({activeList.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQueueOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/10 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Track List */}
            <div className="flex flex-col gap-1 overflow-y-auto pr-1">
              {activeList.map((track, idx) => {
                const isCurrent =
                  currentTrack &&
                  (track.id === currentTrack.id || track.uri === currentTrack.uri);
                return (
                  <button
                    key={track.id || track.uri || idx}
                    type="button"
                    onClick={() => {
                      void playTrack(track, activeList);
                      setQueueOpen(false);
                    }}
                    className={`flex items-center justify-between p-2.5 rounded-2xl text-start transition-all cursor-pointer ${
                      isCurrent
                        ? "bg-orange-500/10 dark:bg-orange-500/20 border border-orange-500/30 text-orange-600 dark:text-orange-400"
                        : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04] text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <TrackCover track={track} size="sm" />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-xs font-bold truncate">
                          {track.title || track.name}
                        </span>
                        <span className="text-[10px] text-zinc-400 truncate">
                          {track.artist || "-"}
                        </span>
                      </div>
                    </div>

                    {isCurrent && isPlaying && (
                      <div className="flex items-end gap-0.5 h-3 px-1">
                        <span className="w-1 bg-orange-500 rounded-full animate-music-bar-1" />
                        <span className="w-1 bg-orange-500 rounded-full animate-music-bar-2" />
                        <span className="w-1 bg-orange-500 rounded-full animate-music-bar-3" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 3-Dots Track Options Bottom Sheet */}
      {optionsOpen && (
        <TrackOptionsSheet
          track={currentTrack}
          onClose={() => setOptionsOpen(false)}
        />
      )}
    </div>
  );
}
