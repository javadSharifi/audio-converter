import React from "react";
import { Volume2, Check, Info } from "lucide-react";
import { translate } from "../../../i18n";
import { useAppStore } from "../../../stores/useAppStore";

interface ConsentExplainerSheetProps {
  open: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConsentExplainerSheet({
  open,
  onConfirm,
  onClose,
}: ConsentExplainerSheetProps): React.JSX.Element | null {
  const lang = useAppStore((s) => s.lang);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-black/[0.08] bg-white/95 p-6 text-center shadow-2xl backdrop-blur-xl dark:border-white/[0.08] dark:bg-zinc-900/95">
        {/* Glow Header */}
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-orange-500/20 via-amber-500/20 to-orange-500/30 text-orange-600 dark:text-orange-400 shadow-lg shadow-orange-500/15">
          <Volume2 className="h-8 w-8" strokeWidth={2.2} />
        </div>

        <h2 className="mb-1 text-base font-extrabold text-zinc-900 dark:text-zinc-100">
          {translate(lang, "liveBoostConsentTitle")}
        </h2>

        <p className="mb-4 text-xs font-medium leading-5 text-zinc-600 dark:text-zinc-300">
          {translate(lang, "liveBoostConsentBody")}
        </p>

        {/* Feature List */}
        <div className="mb-5 flex flex-col gap-2 rounded-2xl bg-black/[0.03] p-3 text-start text-[11px] text-zinc-600 dark:bg-white/[0.03] dark:text-zinc-300">
          <div className="flex items-center gap-2">
            <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" strokeWidth={2.5} />
            <span>{translate(lang, "zeroMicFeature")}</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" strokeWidth={2.5} />
            <span>{translate(lang, "speakerProtectFeature")}</span>
          </div>
          <div className="flex items-center gap-2">
            <Info className="h-3.5 w-3.5 text-amber-500 shrink-0" strokeWidth={2.5} />
            <span>{translate(lang, "phoneCallExcluded")}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 py-3 text-xs font-extrabold text-white shadow-lg shadow-orange-500/25 transition-all duration-200 active:scale-95 hover:brightness-105"
          >
            {translate(lang, "continueBtn")}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="py-2 text-xs font-bold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
          >
            {translate(lang, "permLater")}
          </button>
        </div>
      </div>
    </div>
  );
}
