import { useAppStore } from "../stores/useAppStore";
import { translate, type TranslationKey } from "../i18n";

export function Toasts(): React.JSX.Element | null {
  const toastList = useAppStore((s) => s.toasts);
  const lang = useAppStore((s) => s.lang);
  const dismissToast = useAppStore((s) => s.dismissToast);

  if (toastList.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 px-4 animate-in fade-in slide-in-from-top-4 duration-300">
      {toastList.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-white/15 bg-black/80 backdrop-blur-2xl px-5 py-2.5 text-xs font-semibold text-white shadow-2xl shadow-black/40 transition-all hover:scale-105 active:scale-95"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              t.kind === "error"
                ? "bg-red-500 shadow-sm shadow-red-500"
                : t.kind === "warning"
                  ? "bg-amber-400 shadow-sm shadow-amber-400"
                  : "bg-emerald-400 shadow-sm shadow-emerald-400"
            }`}
          />
          <span>{translate(lang, t.text as TranslationKey)}</span>
        </button>
      ))}
    </div>
  );
}
