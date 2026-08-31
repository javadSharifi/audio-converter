import { useEffect, useState } from "react";
import { HeaderBar } from "./components/HeaderBar";
import { DropZone } from "./components/DropZone";
import { FileList } from "./components/FileList";
import { OptionsPanel } from "./components/OptionsPanel";
import { JobsPanel } from "./components/JobsPanel";
import { Toasts } from "./components/Toasts";
import { useAppStore } from "./stores/useAppStore";
import { translate } from "./i18n";
import { useTheme, useDirection, resolveTheme } from "./hooks/useTheme";
import { openPath } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { isLossy } from "./types";
import { parseDurationInput } from "./utils/format";
import { isAndroid } from "./utils/platform";
import * as api from "./utils/tauri";
import { useNativeDragDrop } from "./hooks/useNativeDragDrop";
import type { QueueItem } from "./types";

function StartBar(): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const files = useAppStore((s) => s.files);
  const options = useAppStore((s) => s.options);
  const jobs = useAppStore((s) => s.jobs);
  const starting = useAppStore((s) => s.starting);
  const startQueue = useAppStore((s) => s.startQueue);
  const pushToast = useAppStore((s) => s.pushToast);

  const validCount = files.filter((f) => !f.error && f.hasAudio).length;
  const busy = Array.from(jobs.values()).some((j) =>
    ["waiting", "processing"].includes(j.status),
  );

  const disabled =
    validCount === 0 ||
    busy ||
    starting ||
    (isLossy(options.format) && options.quality === "custom" && !options.customBitrateKbps) ||
    (options.splitEnabled && parseDurationInput(String(options.splitDurationSecs)) === null) ||
    (options.outputMode === "custom_folder" && !options.customOutputDir);

  const onStart = () => {
    if (disabled) return;
    if (validCount < files.length) pushToast("warning", "errSomeFilesInvalid");
    void startQueue();
  };

  return (
    <button
      onClick={onStart}
      disabled={disabled}
      data-testid="start-conversion"
      className="relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition-all duration-200 hover:brightness-105 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
    >
      {busy || starting ? (
        <span className="inline-flex items-center gap-2">
          <svg className="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span>{translate(lang, "statusProcessing")}</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>{translate(lang, "startConversion")}</span>
        </span>
      )}
    </button>
  );
}

export default function App(): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const theme = useAppStore((s) => s.theme);
  const files = useAppStore((s) => s.files);
  const addPaths = useAppStore((s) => s.addPaths);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const initEventListeners = useAppStore((s) => s.initEventListeners);

  // Android permission gate: shown once per session at startup when access is
  // missing, and again when a pick/stat actually fails with "permission
  // denied" (SAF picks often work without the media permissions, so we never
  // nag before the user needs it).
  const [permOpen, setPermOpen] = useState(false);
  useEffect(() => {
    if (!isAndroid()) return;
    let cancelled = false;
    const check = () => {
      void api.hasMediaPermissions().then((granted) => {
        if (cancelled || granted) return;
        try {
          if (sessionStorage.getItem("ac:perm-modal-shown")) return;
          sessionStorage.setItem("ac:perm-modal-shown", "1");
        } catch {
          /* storage unavailable */
        }
        setPermOpen(true);
      });
    };
    check();
    const onShow = () => check();
    window.addEventListener("ac:show-permission-modal", onShow);
    return () => {
      cancelled = true;
      window.removeEventListener("ac:show-permission-modal", onShow);
    };
  }, []);

  // Window-wide native drop — lives here, not in DropZone, so drag&drop
  // keeps working after the drop zone unmounts (first file added).
  useNativeDragDrop(addPaths);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
    void loadSettings().catch(() => {});
    let cleanup: (() => void) | null = null;
    void initEventListeners().then((fn) => (cleanup = fn));

    // Auto-open output folder on queue completion (setting-dependent; not
    // applicable on Android — outputs live in the shared media store).
    let unlistenIdle: (() => void) | null = null;
    void listen<boolean>("queue-idle", () => {
      if (isAndroid()) return;
      const { settings, jobs } = useAppStore.getState();
      if (!settings?.autoOpenOutputFolder) return;
      const done = Array.from(jobs.values()).find(
        (j: QueueItem) => j.status === "completed" && j.outputs.length > 0,
      );
      if (done) {
        const dir = done.outputs[0].replace(/[\\/][^\\/]+$/, "");
        void openPath(dir);
      }
    }).then((fn) => (unlistenIdle = fn));

    return () => {
      cleanup?.();
      unlistenIdle?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useTheme();
  useDirection(lang);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-zinc-100/90 text-zinc-900 select-none dark:bg-[#09090b] dark:text-zinc-100">
      <HeaderBar />
      
      <main className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 md:gap-5 md:px-6">
        {/* Drop zone only until the first file lands — then the list takes over. */}
        {files.length === 0 && <DropZone />}
        <FileList />
        <OptionsPanel />
        <JobsPanel />
      </main>

      <footer className="relative z-20 border-t border-black/[0.06] bg-white/95 backdrop-blur-md px-4 py-3.5 pb-[calc(0.85rem+env(safe-area-inset-bottom,0px))] shadow-sm dark:border-white/[0.06] dark:bg-zinc-900/95 md:px-6 md:py-4">
        <div className="mx-auto w-full max-w-4xl">
          <StartBar />
        </div>
      </footer>
      <Toasts />

      {permOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/15 text-2xl">
              🔒
            </div>
            <h2 className="mb-2 text-base font-bold">{translate(lang, "permRequiredTitle")}</h2>
            <p className="mb-5 text-xs font-medium leading-5 text-zinc-600 dark:text-zinc-300">
              {translate(lang, "permRequiredBody")}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  api.openAppSettings();
                  setPermOpen(false);
                }}
                className="rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-orange-500/25 active:scale-95 transition-all"
              >
                {translate(lang, "permGoSettings")}
              </button>
              <button
                onClick={() => {
                  api.requestMediaPermissions();
                  setPermOpen(false);
                }}
                className="rounded-2xl border border-black/10 bg-white/60 px-5 py-2.5 text-xs font-bold text-zinc-700 dark:border-white/10 dark:bg-zinc-800/60 dark:text-zinc-200 active:scale-95 transition-all"
              >
                {translate(lang, "permGrantNow")}
              </button>
              <button
                onClick={() => setPermOpen(false)}
                className="px-5 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                {translate(lang, "permLater")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
