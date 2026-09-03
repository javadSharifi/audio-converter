import { useEffect, useState } from "react";
import { MusicPlayerNav, type PlayerTab } from "./MusicPlayerNav";
import { SongsView } from "./SongsView";
import { LikedView } from "./LikedView";
import { AlbumsView } from "./AlbumsView";
import { MiniPlayer } from "./MiniPlayer";
import { NowPlayingView } from "./NowPlayingView";
import { useMusicPlayerStore } from "../../stores/useMusicPlayerStore";
import { ANDROID_BACK_EVENT, markBackConsumed, wasBackConsumed } from "../../utils/androidBack";
import { isAndroid } from "../../utils/platform";

export function MusicPlayerView(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<PlayerTab>("songs");
  const setFullscreenOpen = useMusicPlayerStore((s) => s.setFullscreenOpen);
  const fullscreenOpen = useMusicPlayerStore((s) => s.fullscreenOpen);

  const handleSelectTab = (tab: PlayerTab) => {
    setActiveTab(tab);
    setFullscreenOpen(false);
  };

  // Android back: album/like tabs go home to songs first (consumes the press
  // so App doesn't also jump to converter on the same press).
  useEffect(() => {
    if (!isAndroid()) return;
    const onBack = () => {
      if (wasBackConsumed()) return;
      if (fullscreenOpen) return; // NowPlayingView handles fullscreen/sheets.
      if (activeTab !== "songs") {
        setActiveTab("songs");
        setFullscreenOpen(false);
        markBackConsumed();
      }
    };
    window.addEventListener(ANDROID_BACK_EVENT, onBack as EventListener);
    return () => window.removeEventListener(ANDROID_BACK_EVENT, onBack as EventListener);
  }, [activeTab, fullscreenOpen, setFullscreenOpen]);

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

      {/* Fullscreen Now Playing View (covers nav + mini player) */}
      <NowPlayingView />

      {/* Floating Mini Player (hidden in fullscreen so it never covers popups) */}
      {!fullscreenOpen && <MiniPlayer />}

      {/* Floating iOS Glossy Bottom Navigation Bar (hidden in fullscreen so
          speed/booster/queue sheets sit on top without nav bleeding through) */}
      {!fullscreenOpen && (
        <MusicPlayerNav activeTab={activeTab} onSelectTab={handleSelectTab} />
      )}
    </div>
  );
}
