import { useState } from "react";
import { MusicPlayerNav, type PlayerTab } from "./MusicPlayerNav";
import { SongsView } from "./SongsView";
import { LikedView } from "./LikedView";
import { AlbumsView } from "./AlbumsView";
import { MiniPlayer } from "./MiniPlayer";
import { NowPlayingView } from "./NowPlayingView";
import { useMusicPlayerStore } from "../../stores/useMusicPlayerStore";

export function MusicPlayerView(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<PlayerTab>("songs");
  const setFullscreenOpen = useMusicPlayerStore((s) => s.setFullscreenOpen);

  const handleSelectTab = (tab: PlayerTab) => {
    setActiveTab(tab);
    setFullscreenOpen(false);
  };

  return (
    <div className="flex flex-col flex-1 w-full gap-3 min-h-0 overflow-hidden relative">
      {/* Active Tab View */}
      {activeTab === "songs" ? (
        <SongsView />
      ) : activeTab === "like" ? (
        <LikedView />
      ) : (
        <AlbumsView />
      )}

      {/* Fullscreen Now Playing View */}
      <NowPlayingView />

      {/* Floating Mini Player (Shown when track is active and not fullscreen) */}
      <MiniPlayer />

      {/* Floating iOS Glossy Bottom Navigation Bar (Stays on top) */}
      <MusicPlayerNav activeTab={activeTab} onSelectTab={handleSelectTab} />
    </div>
  );
}
