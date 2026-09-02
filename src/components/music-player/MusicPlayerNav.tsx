import { useAppStore } from "../../stores/useAppStore";
import { translate } from "../../i18n";
import type { TranslationKey } from "../../i18n";
import { Music2, Disc3, Heart } from "lucide-react";

export type PlayerTab = "songs" | "album" | "like";

export interface TabItem {
  id: PlayerTab;
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

const PLAYER_TABS: TabItem[] = [
  { id: "songs", labelKey: "playerNavSongs", icon: Music2 },
  { id: "album", labelKey: "playerNavAlbums", icon: Disc3 },
  { id: "like", labelKey: "playerNavLiked", icon: Heart },
];

interface MusicPlayerNavProps {
  activeTab: PlayerTab;
  onSelectTab: (tab: PlayerTab) => void;
}

export function MusicPlayerNav({ activeTab, onSelectTab }: MusicPlayerNavProps): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);

  return (
    <nav
      aria-label="Music Player Navigation"
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-1.5rem)] select-none"
    >
      {/* Floating Glossy iOS Dock Container */}
      <div className="flex items-center gap-1 sm:gap-1.5 p-1.5 rounded-full bg-white/75 dark:bg-zinc-900/75 backdrop-blur-2xl border border-white/60 dark:border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.12)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.55)] transition-all duration-300">
        {PLAYER_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          const label = translate(lang, tab.labelKey);

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelectTab(tab.id)}
              title={label}
              className={`relative flex items-center justify-center gap-1.5 h-10 sm:h-10 px-3.5 sm:px-4.5 rounded-full text-xs font-semibold cursor-pointer transition-all duration-200 active:scale-95 ${
                isActive
                  ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/25 font-bold"
                  : "text-zinc-600 hover:text-zinc-900 hover:bg-black/[0.04] dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-white/[0.06]"
              }`}
            >
              <Icon
                className={`h-4 w-4 transition-transform duration-200 ${
                  isActive ? "scale-110" : ""
                }`}
                strokeWidth={isActive ? 2.4 : 2}
              />
              <span className="text-[11px] sm:text-xs tracking-tight whitespace-nowrap">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
