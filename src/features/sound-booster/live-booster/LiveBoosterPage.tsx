import React from "react";
import { useLiveBooster } from "./hooks/useLiveBooster";
import { LiveBoosterToggle } from "./LiveBoosterToggle";
import { ConsentExplainerSheet } from "./ConsentExplainerSheet";
import { translate } from "../../../i18n";
import { useAppStore } from "../../../stores/useAppStore";
import { isAndroid } from "../../../utils/platform";

export function LiveBoosterPage(): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const {
    isRunning,
    gain,
    consentSheetOpen,
    error,
    handleToggle,
    handleChangeGain,
    handleConsentConfirm,
    setConsentSheetOpen,
  } = useLiveBooster();

  if (!isAndroid()) {
    return (
      <div className="flex flex-col items-center justify-center gap-3.5 rounded-3xl border border-black/[0.08] bg-white/70 p-8 text-center shadow-sm backdrop-blur-md dark:border-white/[0.08] dark:bg-zinc-900/70">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/15 text-3xl text-orange-600 dark:text-orange-400">
          📱
        </div>
        <h2 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
          {translate(lang, "liveBoostAndroidOnly")}
        </h2>
        <p className="max-w-md text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          {translate(lang, "liveBoostAndroidOnlyDesc")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-12">
      {/* Error Alert if any */}
      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-red-500/10 p-3.5 text-xs font-bold text-red-600 dark:text-red-400">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Main Hero Toggle and Controls */}
      <LiveBoosterToggle
        isRunning={isRunning}
        onToggle={handleToggle}
        gain={gain}
        onChangeGain={handleChangeGain}
      />

      {/* Privacy & Scope Card */}
      <div className="flex flex-col gap-2 rounded-3xl border border-black/[0.06] bg-black/[0.02] p-4 text-[11px] text-zinc-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-zinc-400">
        <div className="flex items-center gap-2 font-bold text-zinc-700 dark:text-zinc-300">
          <span>🔒</span>
          <span>{translate(lang, "zeroMicPrivacy")}</span>
        </div>
        <p className="leading-4.5">
          {translate(lang, "liveBoostBannerDesc")}
        </p>
      </div>

      {/* First-time consent explainer modal */}
      <ConsentExplainerSheet
        open={consentSheetOpen}
        onConfirm={handleConsentConfirm}
        onClose={() => setConsentSheetOpen(false)}
      />
    </div>
  );
}
