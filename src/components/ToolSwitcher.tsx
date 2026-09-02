import { useAppStore } from "../stores/useAppStore";
import { translate } from "../i18n";
import { AudioLines, Music } from "lucide-react";

export function ToolSwitcher(): React.JSX.Element {
  const activeTool = useAppStore((s) => s.activeTool);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const lang = useAppStore((s) => s.lang);

  const isConverter = activeTool === "converter";

  return (
    <div className="flex items-center">
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
          onClick={() => setActiveTool("converter")}
          className={`relative z-10 flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer select-none ${
            isConverter
              ? "bg-white text-zinc-900 shadow-sm shadow-black/5 dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-black/40 font-bold"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
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
          onClick={() => setActiveTool("player")}
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
          onClick={() => setActiveTool("converter")}
          title={translate(lang, "toolConverter")}
          aria-label={translate(lang, "toolConverter")}
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs transition-all duration-200 cursor-pointer ${
            isConverter
              ? "bg-white text-orange-500 shadow-sm dark:bg-zinc-800 dark:text-orange-400"
              : "text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
          }`}
        >
          <AudioLines className="h-4 w-4" strokeWidth={isConverter ? 2.5 : 2} />
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={!isConverter}
          onClick={() => setActiveTool("player")}
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
    </div>
  );
}
