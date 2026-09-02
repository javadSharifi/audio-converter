import { useState } from "react";
import { MusicPlayerNav, type PlayerTab } from "./MusicPlayerNav";
import { SongsView } from "./SongsView";
import { LikedView } from "./LikedView";
import { AlbumsView } from "./AlbumsView";
import { MiniPlayer } from "./MiniPlayer";
import { NowPlayingView } from "./NowPlayingView";

export function MusicPlayerView(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<PlayerTab>("songs");

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

      {/* Floating Mini Player (Shown when track is active) */}
      <MiniPlayer />

      {/* Floating iOS Glossy Bottom Navigation Bar */}
      <MusicPlayerNav activeTab={activeTab} onSelectTab={setActiveTab} />

      {/* Fullscreen Now Playing View Modal */}
      <NowPlayingView />
    </div>
  );
}
