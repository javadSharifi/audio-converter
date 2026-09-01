import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getVersion } from "@tauri-apps/api/app";
import { Settings as SettingsIcon, X, AudioLines, Sun, Moon, Languages } from "lucide-react";
import { useAppStore } from "../stores/useAppStore";
import { translate } from "../i18n";
import { resolveTheme } from "../hooks/useTheme";
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
    if (!settings) return;
    updateSettings(p);
    void persistSettings();
  };

  const toggleTheme = () => {
    const currentResolved = resolveTheme(theme);
    const nextTheme = currentResolved === "dark" ? "light" : "dark";
    patch({ theme: nextTheme });
  };

  const toggleLang = () => {
    const nextLang = lang === "fa" ? "en" : "fa";
    patch({ language: nextLang });
  };

  const isDark = resolveTheme(theme) === "dark";

  return (
    <header className="relative z-30 flex items-center justify-between border-b border-black/[0.06] bg-white/95 backdrop-blur-md px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] shadow-sm dark:border-white/[0.06] dark:bg-zinc-900/95 md:px-6">
      {/* Brand & App Title */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-orange-500 to-amber-400 text-white shadow-md shadow-orange-500/20">
          <AudioLines className="h-5 w-5" strokeWidth={2.4} />
        </div>
        <h1 className="text-sm font-bold tracking-tight md:text-base text-zinc-900 dark:text-zinc-100">
          {translate(lang, "appTitle")}
        </h1>
      </div>

      {/* Header Actions: Theme quick toggle + Settings */}
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={toggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/5 bg-black/[0.03] text-zinc-600 transition-all hover:bg-black/[0.06] active:scale-95 dark:border-white/5 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:bg-white/[0.08]"
          title={isDark ? translate(lang, "themeLight") : translate(lang, "themeDark")}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/5 bg-black/[0.03] text-zinc-600 transition-all hover:bg-black/[0.06] active:scale-95 dark:border-white/5 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:bg-white/[0.08]"
          title={translate(lang, "settingsTitle")}
          aria-label={translate(lang, "settingsTitle")}
        >
          <SettingsIcon className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {/* Settings Dialog Portal */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="glass-panel w-full max-w-md rounded-3xl p-6 shadow-2xl">
              {/* Settings Header */}
              <div className="flex items-center justify-between mb-5 border-b border-black/[0.05] pb-3 dark:border-white/[0.05]">
                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  {translate(lang, "settingsTitle")}
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-black/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Settings Options List */}
              <div className="space-y-3.5 text-sm">
                {/* Language Setting Row */}
                <div className="flex items-center justify-between rounded-2xl bg-black/[0.03] p-3 dark:bg-white/[0.03]">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400">
                      <Languages className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="block font-semibold text-zinc-800 dark:text-zinc-200">
                        {translate(lang, "language")}
                      </span>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {lang === "fa" ? "فارسی (Persian)" : "English"}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={toggleLang}
                    className="flex items-center gap-1.5 rounded-xl border border-black/5 bg-white px-3 py-1.5 text-xs font-bold text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 active:scale-95 dark:border-white/5 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    <span className="text-[11px] font-extrabold text-orange-500 uppercase">
                      {lang === "fa" ? "EN" : "FA"}
                    </span>
                    <span>{lang === "fa" ? "English" : "فارسی"}</span>
                  </button>
                </div>

                {/* Theme Mode Setting Row */}
                <div className="flex items-center justify-between rounded-2xl bg-black/[0.03] p-3 dark:bg-white/[0.03]">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400">
                      {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                    </div>
                    <div>
                      <span className="block font-semibold text-zinc-800 dark:text-zinc-200">
                        {translate(lang, "theme")}
                      </span>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {isDark ? translate(lang, "themeDark") : translate(lang, "themeLight")}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="flex items-center gap-1.5 rounded-xl border border-black/5 bg-white px-3 py-1.5 text-xs font-bold text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 active:scale-95 dark:border-white/5 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    {isDark ? (
                      <>
                        <Sun className="h-3.5 w-3.5 text-amber-400" />
                        <span>{translate(lang, "themeLight")}</span>
                      </>
                    ) : (
                      <>
                        <Moon className="h-3.5 w-3.5 text-zinc-600" />
                        <span>{translate(lang, "themeDark")}</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Concurrency Setting */}
                <label className="flex items-center justify-between rounded-2xl bg-black/[0.03] p-3 dark:bg-white/[0.03]">
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                    {translate(lang, "concurrency")}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={settings?.concurrency ?? 1}
                    onChange={(e) =>
                      updateSettings({
                        concurrency: Math.max(1, Math.min(32, Number(e.target.value) || 1)),
                      })
                    }
                    className="w-20 rounded-xl border border-black/10 bg-white/70 px-3 py-1.5 text-center font-bold outline-none dark:border-white/10 dark:bg-black/30"
                  />
                </label>

                {/* Auto Open Output Folder Setting */}
                <label className="flex items-center justify-between rounded-2xl bg-black/[0.03] p-3 dark:bg-white/[0.03]">
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                    {translate(lang, "autoOpenOutput")}
                  </span>
                  <input
                    type="checkbox"
                    checked={settings?.autoOpenOutputFolder ?? false}
                    onChange={(e) =>
                      updateSettings({ autoOpenOutputFolder: e.target.checked })
                    }
                    className="h-5 w-5 rounded-md accent-orange-500 cursor-pointer"
                  />
                </label>

                {/* App Version Info inside Settings */}
                {version && (
                  <div className="flex items-center justify-between px-2 pt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    <span>{translate(lang, "appTitle")}</span>
                    <span className="font-mono font-semibold">v{version}</span>
                  </div>
                )}
              </div>

              {/* Modal Actions */}
              <div className="mt-6 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-black/5 dark:text-zinc-400 dark:hover:bg-white/10"
                >
                  {translate(lang, "cancel")}
                </button>
                <button
                  type="button"
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
