import { useAppStore } from "../stores/useAppStore";
import { translate, type TranslationKey } from "../i18n";

export function Toasts(): React.JSX.Element | null {
  const toasts = useAppStore((s) => s.toasts);
  const lang = useAppStore((s) => s.lang);
  const dismissToast = useAppStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={`pointer-events-auto rounded-lg px-4 py-2 text-sm shadow-lg ${
            t.kind === "error"
              ? "bg-red-500 text-white"
              : t.kind === "warning"
                ? "bg-amber-500 text-white"
                : "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
          }`}
        >
          {translate(lang, t.text as TranslationKey)}
        </button>
      ))}
    </div>
  );
}
