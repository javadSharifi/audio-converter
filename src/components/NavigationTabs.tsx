import React from "react";
import { RefreshCw, Volume2 } from "lucide-react";
import { translate } from "../i18n";
import { useAppStore } from "../stores/useAppStore";
import { isAndroid } from "../utils/platform";
import type { AppTab } from "./BottomNavigation";

interface NavigationTabsProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
}

export function NavigationTabs({
  activeTab,
  onSelectTab,
}: NavigationTabsProps): React.JSX.Element | null {
  const lang = useAppStore((s) => s.lang);
  const showLiveTab = isAndroid();

  if (!showLiveTab) return null;

  return (
    <nav className="flex items-center justify-center p-1" aria-label="Main Navigation">
      <div className="flex items-center gap-1 rounded-2xl border border-black/[0.06] bg-black/[0.03] p-1 dark:border-white/[0.06] dark:bg-white/[0.04]">
        <button
          type="button"
          onClick={() => onSelectTab("converter")}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all duration-200 ${
            activeTab === "converter"
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-white"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />
          <span>{translate(lang, "tabConverterAndBooster" as any) || "Converter & Booster"}</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab("live_booster")}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all duration-200 ${
            activeTab === "live_booster"
              ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm shadow-orange-500/25"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          <Volume2 className="h-3.5 w-3.5" strokeWidth={2.2} />
          <span>{translate(lang, "tabLiveBooster" as any) || "Live Boost"}</span>
        </button>
      </div>
    </nav>
  );
}
