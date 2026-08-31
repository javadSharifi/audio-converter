import React from "react";
import { SlidersHorizontal, ShieldCheck } from "lucide-react";
import { translate } from "../../../i18n";
import { useAppStore } from "../../../stores/useAppStore";

import { ModernSlider } from "../../../components/ModernSlider";

interface GainSliderProps {
  gainPercent: number; // 0 to 200
  onChangeGain: (gain: number) => void;
  disabled?: boolean;
}

export function GainSlider({
  gainPercent,
  onChangeGain,
  disabled = false,
}: GainSliderProps): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);

  // Approximate dB calculation: 20 * log10(pct / 100)
  const dbValue =
    gainPercent > 0
      ? (20 * Math.log10(gainPercent / 100)).toFixed(1)
      : "-∞";

  const isHighBoost = gainPercent > 150;

  return (
    <div className="flex flex-col gap-3.5 rounded-3xl border border-black/[0.08] bg-white/80 p-5 shadow-sm backdrop-blur-md dark:border-white/[0.08] dark:bg-zinc-900/80">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400">
            <SlidersHorizontal className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
              {translate(lang, "customGainLevel")}
            </h4>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {translate(lang, "preciseGainDesc")}
            </span>
          </div>
        </div>
      </div>

      {/* Modern Slider Track & Spatial Labels */}
      <div className="relative flex flex-col gap-1.5 py-1" dir="ltr">
        <ModernSlider
          value={gainPercent}
          min={0}
          max={200}
          step={5}
          disabled={disabled}
          onChange={onChangeGain}
          color="orange"
          size="sm"
          leftLabel={(val) => `GAIN ${val}%`}
          rightLabel={() => (gainPercent >= 100 ? `+${dbValue} dB` : `${dbValue} dB`)}
        />

        <div className="flex justify-between px-1 text-[9.5px] font-semibold text-zinc-400 dark:text-zinc-500">
          <span>{translate(lang, "sliderMute")} (0%)</span>
          <span>{translate(lang, "sliderOriginal")} (100%)</span>
          <span>{translate(lang, "sliderMax")} (200%)</span>
        </div>
      </div>

      {/* High Boost Safety Hint */}
      {isHighBoost && (
        <div className="flex items-center gap-1.5 rounded-xl bg-amber-500/10 px-2.5 py-1.5 text-[10.5px] font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          <span>{translate(lang, "highBoostNotice")}</span>
        </div>
      )}
    </div>
  );
}
