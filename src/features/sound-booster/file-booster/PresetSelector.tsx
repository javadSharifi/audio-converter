import React from "react";
import { Sparkles, Music, Zap, SlidersHorizontal } from "lucide-react";
import type { BoosterPreset } from "../../../types";
import { BOOSTER_PRESETS } from "../shared/boosterTypes";
import { translate } from "../../../i18n";
import { useAppStore } from "../../../stores/useAppStore";

interface PresetSelectorProps {
  activePreset: BoosterPreset;
  onSelectPreset: (preset: BoosterPreset) => void;
  disabled?: boolean;
}

function getPresetIcon(id: BoosterPreset) {
  switch (id) {
    case "smart":
      return <Sparkles className="h-5 w-5" strokeWidth={2.2} />;
    case "music":
      return <Music className="h-5 w-5" strokeWidth={2.2} />;
    case "extreme":
      return <Zap className="h-5 w-5" strokeWidth={2.2} />;
    case "manual":
      return <SlidersHorizontal className="h-5 w-5" strokeWidth={2.2} />;
    default:
      return <Sparkles className="h-5 w-5" strokeWidth={2.2} />;
  }
}

export function PresetSelector({
  activePreset,
  onSelectPreset,
  disabled = false,
}: PresetSelectorProps): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between px-1">
        <label className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {translate(lang, "boosterPresetsTitle")}
        </label>
        <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">
          {translate(lang, "dspProtected")}
        </span>
      </div>

      {/* Balanced 2x2 Grid for the 4 Presets (3 Presets + 1 Manual) */}
      <div className="grid grid-cols-2 gap-2.5">
        {BOOSTER_PRESETS.map((preset) => {
          const isSelected = activePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelectPreset(preset.id)}
              className={`group relative flex flex-col items-start text-start rounded-2xl p-3.5 transition-all duration-200 active:scale-[0.97] ${
                isSelected
                  ? "border-2 border-orange-500 bg-gradient-to-b from-orange-500/[0.12] via-orange-500/[0.04] to-transparent shadow-lg shadow-orange-500/10 dark:border-orange-500 dark:from-orange-500/20"
                  : "border border-black/[0.08] bg-white/70 hover:border-black/20 hover:bg-white dark:border-white/[0.08] dark:bg-zinc-900/60 dark:hover:border-white/20 dark:hover:bg-zinc-800/80"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {/* Badge */}
              {preset.badge && (
                <span
                  className={`absolute top-2.5 end-2.5 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                    preset.id === "extreme"
                      ? "bg-red-500/15 text-red-600 dark:bg-red-500/25 dark:text-red-400 ring-1 ring-red-500/20"
                      : "bg-orange-500/15 text-orange-700 dark:bg-orange-500/25 dark:text-orange-300 ring-1 ring-orange-500/20"
                  }`}
                >
                  {preset.id === "smart"
                    ? translate(lang, "badgeRecommended")
                    : translate(lang, "badgeLoud")}
                </span>
              )}

              {/* Icon Container */}
              <div
                className={`mb-2.5 flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200 ${
                  isSelected
                    ? "bg-orange-500 text-white shadow-md shadow-orange-500/30"
                    : "bg-black/[0.05] text-zinc-600 group-hover:bg-black/[0.08] dark:bg-white/[0.08] dark:text-zinc-300 dark:group-hover:bg-white/[0.12]"
                }`}
              >
                {getPresetIcon(preset.id)}
              </div>

              {/* Title & Description with correct RTL text-start */}
              <div className="w-full text-start">
                <h4
                  className={`text-xs font-black tracking-tight ${
                    isSelected
                      ? "text-orange-600 dark:text-orange-400"
                      : "text-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {translate(lang, preset.labelKey as any)}
                </h4>

                <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed font-medium text-zinc-500 dark:text-zinc-400 text-start">
                  {translate(lang, preset.descKey as any)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
