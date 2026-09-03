import { useState, useEffect } from "react";
import { useAppStore } from "../stores/useAppStore";
import { translate } from "../i18n";
import { AudioLines, Music, Sparkles, X } from "lucide-react";

export function ToolSwitcher(): React.JSX.Element {
  const activeTool = useAppStore((s) => s.activeTool);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const lang = useAppStore((s) => s.lang);

  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        const seen = localStorage.getItem("has-seen-converter-guide");
        if (!seen) {
          const timer = setTimeout(() => setShowGuide(true), 500);
          return () => clearTimeout(timer);
        }
      }
    } catch {}
  }, []);

  const dismissGuide = () => {
    setShowGuide(false);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("has-seen-converter-guide", "true");
      }
    } catch {}
  };

  const handleSelectConverter = () => {
    if (showGuide) dismissGuide();
    setActiveTool("converter");
  };

  const handleSelectPlayer = () => {
    if (showGuide) dismissGuide();
    setActiveTool("player");
  };

  const isConverter = activeTool === "converter";

  return (
    <div className="relative flex items-center">
      {/* Desktop / Tablet Segmented Switch (sm and up) */}
      <div
        role="tablist"
        aria-label="Tool Switcher"
        className="hidden sm:inline-flex relative items-center p-1 rounded-2xl bg-black/[0.04] border border-black/[0.06] dark:bg-white/[0.04] dark:border-white/[0.06] shadow-inner backdrop-blur-sm"
      >
        {/* Converter Tab */}
        <button
          type="button"
          role="tab"
          aria-selected={isConverter}
          onClick={handleSelectConverter}
          className={`relative z-10 flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer select-none ${
            isConverter
              ? "bg-white text-zinc-900 shadow-sm shadow-black/5 dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-black/40 font-bold"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          {/* Pulsing Guide Badge */}
          {showGuide && (
            <span className="absolute -top-1 -start-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500 shadow-sm" />
            </span>
          )}

          <AudioLines
            className={`h-3.5 w-3.5 transition-colors ${
              isConverter ? "text-orange-500" : "text-zinc-400 dark:text-zinc-500"
            }`}
            strokeWidth={isConverter ? 2.5 : 2}
          />
          <span>{translate(lang, "toolConverter")}</span>
        </button>

        {/* Music Player Tab */}
        <button
          type="button"
          role="tab"
          aria-selected={!isConverter}
          onClick={handleSelectPlayer}
          className={`relative z-10 flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer select-none ${
            !isConverter
              ? "bg-white text-zinc-900 shadow-sm shadow-black/5 dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-black/40 font-bold"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          <Music
            className={`h-3.5 w-3.5 transition-colors ${
              !isConverter ? "text-orange-500" : "text-zinc-400 dark:text-zinc-500"
            }`}
            strokeWidth={!isConverter ? 2.5 : 2}
          />
          <span>{translate(lang, "toolPlayer")}</span>
        </button>
      </div>

      {/* Mobile Compact Icon Switcher (< sm) */}
      <div
        role="tablist"
        aria-label="Tool Switcher"
        className="flex sm:hidden items-center p-0.5 rounded-xl bg-black/[0.04] border border-black/[0.06] dark:bg-white/[0.04] dark:border-white/[0.06]"
      >
        <button
          type="button"
          role="tab"
          aria-selected={isConverter}
          onClick={handleSelectConverter}
          title={translate(lang, "toolConverter")}
          aria-label={translate(lang, "toolConverter")}
          className={`relative flex h-8 w-8 items-center justify-center rounded-lg text-xs transition-all duration-200 cursor-pointer ${
            isConverter
              ? "bg-white text-orange-500 shadow-sm dark:bg-zinc-800 dark:text-orange-400"
              : "text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
          }`}
        >
          {showGuide && (
            <span className="absolute -top-1 -start-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-500" />
            </span>
          )}
          <AudioLines className="h-4 w-4" strokeWidth={isConverter ? 2.5 : 2} />
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={!isConverter}
          onClick={handleSelectPlayer}
          title={translate(lang, "toolPlayer")}
          aria-label={translate(lang, "toolPlayer")}
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs transition-all duration-200 cursor-pointer ${
            !isConverter
              ? "bg-white text-orange-500 shadow-sm dark:bg-zinc-800 dark:text-orange-400"
              : "text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
          }`}
        >
          <Music className="h-4 w-4" strokeWidth={!isConverter ? 2.5 : 2} />
        </button>
      </div>

      {/* =============================================================== */}
      {/* Onboarding Converter Guide Tooltip                             */}
      {/* =============================================================== */}
      {showGuide && (
        <div className="absolute top-full mt-3.5 left-1/2 -translate-x-1/2 z-50 w-64 sm:w-72 select-none animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Top Arrow Pointer */}
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-white dark:bg-zinc-900 border-t border-s border-orange-500/30 dark:border-orange-500/40" />

          {/* Card Body */}
          <div className="relative p-3.5 rounded-2xl bg-white/95 dark:bg-zinc-900/95 border border-orange-500/30 dark:border-orange-500/40 shadow-[0_12px_36px_rgba(249,115,22,0.18)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.6)] backdrop-blur-xl flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
                <Sparkles className="h-4 w-4" />
                <span className="text-xs font-bold">
                  {translate(lang, "converterGuideTitle")}
                </span>
              </div>
              <button
                type="button"
                onClick={dismissGuide}
                aria-label={translate(lang, "close")}
                className="flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300 font-medium">
              {translate(lang, "converterGuideDesc")}
            </p>

            <div className="flex items-center justify-end gap-2 pt-0.5">
              <button
                type="button"
                onClick={dismissGuide}
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-bold shadow-md shadow-orange-500/25 hover:brightness-105 active:scale-95 cursor-pointer transition-all"
              >
                {translate(lang, "converterGuideGotIt")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
