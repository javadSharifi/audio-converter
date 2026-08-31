import React from "react";
import { Power } from "lucide-react";
import { translate } from "../../../i18n";
import { useAppStore } from "../../../stores/useAppStore";
import { ModernSlider } from "../../../components/ModernSlider";

interface LiveBoosterToggleProps {
  isRunning: boolean;
  onToggle: () => void;
  gain: number;
  onChangeGain: (gain: number) => void;
}

export function LiveBoosterToggle({
  isRunning,
  onToggle,
  gain,
  onChangeGain,
}: LiveBoosterToggleProps): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);

  // dB calculation: 20 * log10(gain)
  const dbValue = (20 * Math.log10(gain)).toFixed(1);
  const gainPresets = [1.2, 1.5, 2.0, 2.5, 3.0, 4.0];

  return (
    <div className="flex flex-col items-center gap-7 rounded-3xl border border-black/[0.08] bg-white/85 p-8 shadow-sm backdrop-blur-xl dark:border-white/[0.08] dark:bg-zinc-900/85">
      {/* Power Button */}
      <div className="relative flex items-center justify-center py-2">
        <button
          type="button"
          onClick={onToggle}
          className={`group relative z-10 flex h-32 w-32 flex-col items-center justify-center rounded-full transition-all duration-300 active:scale-95 ${
            isRunning
              ? "bg-gradient-to-tr from-orange-500 via-amber-500 to-orange-500 text-white shadow-2xl shadow-orange-500/40 ring-4 ring-orange-500/25"
              : "border-2 border-black/10 bg-zinc-100 text-zinc-400 hover:border-orange-500/40 hover:text-zinc-600 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-300"
          }`}
          aria-label={isRunning ? "Turn Off Live Boost" : "Turn On Live Boost"}
        >
          {/* Lucide Power SVG Icon */}
          <Power
            className={`h-11 w-11 transition-transform duration-300 group-hover:scale-105 ${
              isRunning ? "stroke-white drop-shadow-md" : "stroke-current"
            }`}
            strokeWidth={2.4}
          />

          <span className="mt-1 text-[11px] font-black uppercase tracking-wider">
            {isRunning
              ? translate(lang, "liveBoostActive")
              : translate(lang, "liveBoostOff")}
          </span>
        </button>
      </div>

      {/* Live VU / Gain Readout */}
      <div className="flex flex-col items-center gap-1.5 text-center">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black tracking-tight text-orange-600 dark:text-orange-400">
            {gain.toFixed(1)}x
          </span>
          <span className="text-sm font-extrabold text-zinc-500 dark:text-zinc-400">
            (+{dbValue} dB)
          </span>
        </div>

        <div className="flex items-center gap-2 rounded-full bg-black/[0.04] px-3.5 py-1 text-[11px] font-semibold text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
          <span
            className={`h-2 w-2 rounded-full ${
              isRunning ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"
            }`}
          />
          <span>
            {isRunning
              ? translate(lang, "liveBoostRunningStatus")
              : translate(lang, "liveBoostReadyStatus")}
          </span>
        </div>
      </div>

      {/* Fader Slider */}
      <div className="flex w-full max-w-sm flex-col gap-2" dir="ltr">
        <div className="flex items-center justify-between text-[11px] font-bold text-zinc-500 dark:text-zinc-400">
          <span>{translate(lang, "liveBoostNormal")} (1.0x)</span>
          <span className="text-[10px] uppercase tracking-wider text-orange-600 dark:text-orange-400 font-extrabold">
            {translate(lang, "liveBoostMultiplier")}
          </span>
          <span>{translate(lang, "liveBoostMax")} (4.0x)</span>
        </div>

        <ModernSlider
          value={gain}
          min={1.0}
          max={4.0}
          step={0.1}
          onChange={onChangeGain}
          color="orange"
          size="sm"
          leftLabel={(val) => `${val.toFixed(1)}x GAIN`}
          rightLabel={() => `+${dbValue} dB`}
        />
      </div>

      {/* Quick Presets */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {gainPresets.map((preset) => {
          const isSelected = Math.abs(gain - preset) < 0.05;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChangeGain(preset)}
              className={`rounded-xl px-3 py-1.5 text-xs font-black transition-all duration-200 active:scale-95 ${
                isSelected
                  ? "bg-orange-500 text-white shadow-md shadow-orange-500/25"
                  : "bg-black/[0.05] text-zinc-600 hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-zinc-300 dark:hover:bg-white/[0.1]"
              }`}
            >
              {preset.toFixed(1)}x
            </button>
          );
        })}
      </div>
    </div>
  );
}
