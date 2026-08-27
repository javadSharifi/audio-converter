import { useEffect, useState } from "react";
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
    <header className="flex items-center justify-between border-b border-zinc-200 bg-white/50 backdrop-blur-md px-3.5 py-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] dark:border-zinc-800 dark:bg-zinc-950/50 md:px-5">
      <div className="flex items-center gap-2">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="text-orange-500">
          <rect x="2" y="9" width="3" height="6" rx="1.5" />
          <rect x="7" y="5" width="3" height="14" rx="1.5" />
          <rect x="12" y="2" width="3" height="20" rx="1.5" />
          <rect x="17" y="7" width="3" height="10" rx="1.5" />
        </svg>
        <h1 className="text-sm font-bold md:text-base">{translate(lang, "appTitle")}</h1>
        {version && <span className="text-[10px] opacity-40">v{version}</span>}
      </div>

      <div className="flex items-center gap-2 text-xs">
        <select
          value={lang}
          onChange={(e) => patch({ language: e.target.value as "en" | "fa" })}
          className="rounded-lg border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          aria-label={translate(lang, "language")}
        >
          <option value="en">English</option>
          <option value="fa">فارسی</option>
        </select>

        <select
          value={theme}
          onChange={(e) => patch({ theme: e.target.value as "light" | "dark" | "system" })}
          className="rounded-lg border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          aria-label={translate(lang, "theme")}
        >
          <option value="light">{translate(lang, "themeLight")}</option>
          <option value="dark">{translate(lang, "themeDark")}</option>
          <option value="system">{translate(lang, "themeSystem")}</option>
        </select>

        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-zinc-200 px-2 py-1 hover:border-zinc-300 dark:border-zinc-700"
        >
          ⚙ {translate(lang, "settingsTitle")}
        </button>
      </div>

      {open && (
        <div className="absolute inset-x-0 top-14 z-20 mx-auto w-[420px] max-w-[92vw] rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="mb-3 text-sm font-semibold">{translate(lang, "settingsTitle")}</h2>
          <label className="mb-2 flex items-center justify-between text-sm">
            <span>{translate(lang, "concurrency")}</span>
            <input
              type="number"
              min={1}
              max={32}
              value={settings?.concurrency ?? 1}
              onChange={(e) => updateSettings({ concurrency: Math.max(1, Math.min(32, Number(e.target.value) || 1)) })}
              className="w-20 rounded-lg border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-700"
            />
          </label>
          <label className="mb-3 flex items-center justify-between text-sm">
            <span>{translate(lang, "autoOpenOutput")}</span>
            <input
              type="checkbox"
              checked={settings?.autoOpenOutputFolder ?? false}
              onChange={(e) => updateSettings({ autoOpenOutputFolder: e.target.checked })}
            />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-700">
              ✕
            </button>
            <button
              onClick={() => {
                void persistSettings();
                setOpen(false);
              }}
              className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600"
            >
              {translate(lang, "saveSettings")}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
