import React from "react";
import { RefreshCw, Volume2 } from "lucide-react";
import { translate } from "../i18n";
import { useAppStore } from "../stores/useAppStore";
import { useLiveBoosterStore } from "../features/sound-booster/stores/useLiveBoosterStore";
import { isAndroid } from "../utils/platform";

export type AppTab = "converter" | "live_booster";

interface BottomNavigationProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
}

export function BottomNavigation({
  activeTab,
  onSelectTab,
}: BottomNavigationProps): React.JSX.Element | null {
  const lang = useAppStore((s) => s.lang);
  const fileCount = useAppStore((s) => s.files.length);
  const isBoostEnabled = useAppStore((s) => s.options.boostEnabled);
  const isLiveRunning = useLiveBoosterStore((s) => s.isRunning);
  const showLiveTab = isAndroid();

  // On desktop, with File Booster unified into Converter, only 1 tab exists
  if (!showLiveTab) {
    return null;
  }

  const tabs: Array<{
    id: AppTab;
    label: string;
    icon: (active: boolean) => React.JSX.Element;
    badge?: React.ReactNode;
  }> = [
    {
      id: "converter",
      label: translate(lang, "tabConverterAndBooster" as any) || "Converter & Booster",
      icon: (active) => (
        <RefreshCw
          className={`h-5 w-5 transition-transform duration-200 ${active ? "scale-110" : ""}`}
          strokeWidth={active ? 2.3 : 1.8}
        />
      ),
      badge:
        fileCount > 0 ? (
          <span className="absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-black text-white shadow-sm">
            {fileCount}
          </span>
        ) : isBoostEnabled ? (
          <span className="absolute -top-0.5 -right-1 flex h-2 w-2 rounded-full bg-amber-500" />
        ) : null,
    },
    {
      id: "live_booster",
      label: translate(lang, "tabLiveBooster" as any) || "Live Boost",
      icon: (active) => (
        <Volume2
          className={`h-5 w-5 transition-transform duration-200 ${active ? "scale-110" : ""}`}
          strokeWidth={active ? 2.3 : 1.8}
        />
      ),
      badge: isLiveRunning ? (
        <span className="absolute -top-0.5 -right-1 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
      ) : null,
    },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-black/[0.06] bg-white/90 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-4px_20px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-zinc-950/90 dark:shadow-[0_-4px_20px_rgba(0,0,0,0.4)]"
      aria-label="Bottom Navigation"
    >
      <div className="mx-auto flex h-16 max-w-md items-center justify-around px-4">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-1 transition-all duration-200 active:scale-95 ${
                isActive
                  ? "text-orange-500 dark:text-orange-400"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              <div className="relative flex items-center justify-center">
                {tab.icon(isActive)}
                {tab.badge}
              </div>
              <span
                className={`text-[11px] font-bold tracking-tight transition-all duration-200 ${
                  isActive
                    ? "font-extrabold text-orange-600 dark:text-orange-400"
                    : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {tab.label}
              </span>
              {isActive && (
                <div className="absolute bottom-0 h-1 w-8 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 shadow-sm shadow-orange-500/50" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
