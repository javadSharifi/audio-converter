import React, { useId } from "react";

export type SliderColorTheme =
  | "orange"
  | "amber"
  | "emerald"
  | "blue"
  | "purple"
  | "rose"
  | "zinc";

export type SliderSize = "xs" | "sm" | "md" | "lg";

export interface ModernSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  color?: SliderColorTheme;
  size?: SliderSize;
  leftLabel?: React.ReactNode | ((val: number, pct: number) => React.ReactNode);
  rightLabel?: React.ReactNode | ((val: number, pct: number) => React.ReactNode);
  showIndicator?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  name?: string;
}

const COLOR_MAP: Record<
  SliderColorTheme,
  {
    gradient: string;
    shadow: string;
    text: string;
  }
> = {
  orange: {
    gradient: "bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500",
    shadow: "shadow-orange-500/20",
    text: "text-orange-500 dark:text-orange-400",
  },
  amber: {
    gradient: "bg-gradient-to-r from-amber-600 via-amber-500 to-yellow-500",
    shadow: "shadow-amber-500/20",
    text: "text-amber-500 dark:text-amber-400",
  },
  emerald: {
    gradient: "bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400",
    shadow: "shadow-emerald-500/20",
    text: "text-emerald-500 dark:text-emerald-400",
  },
  blue: {
    gradient: "bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-400",
    shadow: "shadow-blue-500/20",
    text: "text-blue-500 dark:text-blue-400",
  },
  purple: {
    gradient: "bg-gradient-to-r from-purple-600 via-purple-500 to-indigo-400",
    shadow: "shadow-purple-500/20",
    text: "text-purple-500 dark:text-purple-400",
  },
  rose: {
    gradient: "bg-gradient-to-r from-rose-600 via-rose-500 to-pink-400",
    shadow: "shadow-rose-500/20",
    text: "text-rose-500 dark:text-rose-400",
  },
  zinc: {
    gradient: "bg-gradient-to-r from-zinc-600 via-zinc-500 to-zinc-400",
    shadow: "shadow-zinc-500/20",
    text: "text-zinc-500 dark:text-zinc-400",
  },
};

const SIZE_MAP: Record<SliderSize, { container: string; text: string; indicator: string }> = {
  xs: {
    container: "h-5 rounded-lg",
    text: "text-[9px] px-2",
    indicator: "h-3 w-1 rounded-full",
  },
  sm: {
    container: "h-7 rounded-xl",
    text: "text-[10px] px-2.5",
    indicator: "h-4 w-1 rounded-full",
  },
  md: {
    container: "h-8 rounded-xl",
    text: "text-[11px] px-3",
    indicator: "h-5 w-1 rounded-full",
  },
  lg: {
    container: "h-10 rounded-2xl",
    text: "text-xs px-4",
    indicator: "h-6 w-1.5 rounded-full",
  },
};

export function ModernSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  color = "orange",
  size = "md",
  leftLabel,
  rightLabel,
  showIndicator = true,
  className = "",
  id: customId,
  "aria-label": ariaLabel,
  name,
}: ModernSliderProps): React.JSX.Element {
  const generatedId = useId();
  const inputId = customId ?? generatedId;

  // Calculate percentage clamped between 0 and 100
  const range = max - min;
  const pct = range > 0 ? Math.min(100, Math.max(0, ((value - min) / range) * 100)) : 0;

  const theme = COLOR_MAP[color] ?? COLOR_MAP.orange;
  const sizeConfig = SIZE_MAP[size] ?? SIZE_MAP.md;

  const resolvedLeftLabel =
    typeof leftLabel === "function" ? leftLabel(value, pct) : leftLabel;
  const resolvedRightLabel =
    typeof rightLabel === "function" ? rightLabel(value, pct) : rightLabel;

  return (
    <div
      dir="ltr"
      className={`group relative flex w-full select-none items-center overflow-hidden border border-black/[0.08] bg-zinc-200/80 shadow-inner backdrop-blur-md transition-all dark:border-white/[0.08] dark:bg-zinc-800/80 ${
        sizeConfig.container
      } ${disabled ? "cursor-not-allowed opacity-50" : "hover:border-black/15 dark:hover:border-white/15"} ${className}`}
    >
      {/* Active Fill Track (Left Side) */}
      <div
        className={`absolute inset-y-0 left-0 ${theme.gradient} transition-[width] duration-75 ease-out`}
        style={{ width: `${pct}%` }}
      />

      {/* Subtle Unfilled Right Track Highlight */}
      <div
        className="absolute inset-y-0 right-0 bg-black/[0.03] dark:bg-white/[0.04] transition-[width] duration-75 ease-out"
        style={{ width: `${100 - pct}%` }}
      />

      {/* Divider Indicator Bar */}
      {showIndicator && (
        <div
          className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white shadow-md shadow-black/30 transition-[left] duration-75 ease-out z-10 ${sizeConfig.indicator}`}
          style={{ left: `${pct}%` }}
        />
      )}

      {/* Floating Dynamic Labels */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-between font-bold tabular-nums ${sizeConfig.text}`}
      >
        {/* Left Label */}
        <div className="flex items-center gap-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)] text-white">
          {resolvedLeftLabel}
        </div>

        {/* Right Label */}
        <div className="flex items-center gap-1 drop-label text-zinc-700 dark:text-zinc-200 drop-shadow-[0_1px_1px_rgba(0,0,0,0.3)]">
          {resolvedRightLabel}
        </div>
      </div>

      {/* Invisible Accessible Native Range Input Overlay */}
      <input
        id={inputId}
        type="range"
        name={name}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 z-30 h-full w-full cursor-grab opacity-0 active:cursor-grabbing disabled:cursor-not-allowed m-0 p-0"
      />
    </div>
  );
}
