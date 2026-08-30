import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getVersion } from "@tauri-apps/api/app";
import { useAppStore } from "../stores/useAppStore";
import { translate } from "../i18n";
import type { AppSettings } from "../types";

export function HeaderBar(): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const theme = useAppStore((s) => s.theme);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const persistSettings = useAppStore((s) => s.persistSettings);
  const settings = useAppStore((s) => s.settings);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const patch = (p: Partial<AppSettings>) => {
    updateSettings(p);
    void persistSettings();
  };

  return (
    <header className="relative z-30 flex items-center justify-between border-b border-black/5 bg-white/60 backdrop-blur-2xl px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] shadow-sm dark:border-white/5 dark:bg-zinc-950/60 md:px-6">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-orange-500 to-amber-400 text-white shadow-md shadow-orange-500/20">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="3" y="9" width="3" height="6" rx="1.5" />
            <rect x="8" y="5" width="3" height="14" rx="1.5" />
            <rect x="13" y="2" width="3" height="20" rx="1.5" />
            <rect x="18" y="7" width="3" height="10" rx="1.5" />
          </svg>
        </div>
        <div className="flex items-baseline gap-1.5">
          <h1 className="text-sm font-bold tracking-tight md:text-base">{translate(lang, "appTitle")}</h1>
          {version && (
            <span className="rounded-full bg-zinc-200/60 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-400">
              v{version}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <div className="flex items-center rounded-xl border border-black/5 bg-black/[0.03] p-0.5 dark:border-white/5 dark:bg-white/[0.04]">
          <select
            value={lang}
            onChange={(e) => patch({ language: e.target.value as "en" | "fa" })}
            className="cursor-pointer rounded-lg bg-transparent px-2 py-1 font-medium outline-none transition-colors hover:bg-white/60 dark:hover:bg-white/10"
            aria-label={translate(lang, "language")}
          >
            <option value="en" className="dark:bg-zinc-900">EN</option>
            <option value="fa" className="dark:bg-zinc-900">FA</option>
          </select>

          <select
            value={theme}
            onChange={(e) => patch({ theme: e.target.value as "light" | "dark" | "system" })}
            className="cursor-pointer rounded-lg bg-transparent px-2 py-1 font-medium outline-none transition-colors hover:bg-white/60 dark:hover:bg-white/10"
            aria-label={translate(lang, "theme")}
          >
            <option value="light" className="dark:bg-zinc-900">☼ {translate(lang, "themeLight")}</option>
            <option value="dark" className="dark:bg-zinc-900">☾ {translate(lang, "themeDark")}</option>
            <option value="system" className="dark:bg-zinc-900">◐ {translate(lang, "themeSystem")}</option>
          </select>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/5 bg-black/[0.03] text-zinc-600 transition-all hover:bg-black/[0.06] active:scale-95 dark:border-white/5 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:bg-white/[0.08]"
          title={translate(lang, "settingsTitle")}
          aria-label={translate(lang, "settingsTitle")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>

      {open &&
        // Portal to <body>: the header's backdrop-filter makes it the
        // containing block for position:fixed children, which would clip
        // this overlay to the 56px header bar instead of the viewport.
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="glass-panel w-full max-w-md rounded-3xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold">{translate(lang, "settingsTitle")}</h2>
                <button
                  onClick={() => setOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-black/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4 text-sm">
                <label className="flex items-center justify-between">
                  <span className="font-medium">{translate(lang, "concurrency")}</span>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={settings?.concurrency ?? 1}
                    onChange={(e) => updateSettings({ concurrency: Math.max(1, Math.min(32, Number(e.target.value) || 1)) })}
                    className="w-20 rounded-xl border border-black/10 bg-white/50 px-3 py-1.5 text-center font-semibold outline-none dark:border-white/10 dark:bg-black/30"
                  />
                </label>

                <label className="flex items-center justify-between">
                  <span className="font-medium">{translate(lang, "autoOpenOutput")}</span>
                  <input
                    type="checkbox"
                    checked={settings?.autoOpenOutputFolder ?? false}
                    onChange={(e) => updateSettings({ autoOpenOutputFolder: e.target.checked })}
                    className="h-5 w-5 rounded-md accent-orange-500 cursor-pointer"
                  />
                </label>
              </div>

              <div className="mt-6 flex justify-end gap-2.5">
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-black/5 dark:text-zinc-400 dark:hover:bg-white/10"
                >
                  ✕
                </button>
                <button
                  onClick={() => {
                    void persistSettings();
                    setOpen(false);
                  }}
                  className="rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-2 text-xs font-semibold text-white shadow-md shadow-orange-500/20 hover:brightness-105 active:scale-95"
                >
                  {translate(lang, "saveSettings")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </header>
  );
}
