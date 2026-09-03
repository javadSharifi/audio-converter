import { useCallback, useEffect, useState } from "react";
import { HeaderBar } from "./components/HeaderBar";
import { DropZone } from "./components/DropZone";
import { FileList } from "./components/FileList";
import { OptionsPanel } from "./components/OptionsPanel";
import { JobsPanel } from "./components/JobsPanel";
import { MusicPlayerView } from "./components/music-player/MusicPlayerView";
import { Toasts } from "./components/Toasts";
import { useAppStore } from "./stores/useAppStore";
import { translate } from "./i18n";
import { useTheme, useDirection, resolveTheme } from "./hooks/useTheme";
import { openPath } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { isLossy } from "./types";
import { isAndroid } from "./utils/platform";
import * as api from "./utils/tauri";
import { useNativeDragDrop } from "./hooks/useNativeDragDrop";
import { handleIncomingFiles } from "./utils/openWith";
import { Loader2, Play, Lock } from "lucide-react";
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
    (options.splitEnabled &&
      (options.splitDurationSecs === null ||
        !Number.isFinite(options.splitDurationSecs) ||
        options.splitDurationSecs <= 0)) ||
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
          <Loader2 className="h-4 w-4 animate-spin text-white" />
          <span>{translate(lang, "statusProcessing")}</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <Play className="h-4 w-4 fill-current" strokeWidth={0} />
          <span>{translate(lang, "startConversion")}</span>
        </span>
      )}
    </button>
  );
}

export default function App(): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const theme = useAppStore((s) => s.theme);
  const activeTool = useAppStore((s) => s.activeTool);
  const files = useAppStore((s) => s.files);
  const addPaths = useAppStore((s) => s.addPaths);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const initEventListeners = useAppStore((s) => s.initEventListeners);

  // Android permission gate — honors grant, clears session flag, handles focus
  const [permOpen, setPermOpen] = useState(false);
  useEffect(() => {
    if (!isAndroid()) return;
    let cancelled = false;
    const check = () => {
      void api.hasMediaPermissions().then((granted) => {
        if (cancelled) return;
        if (granted) {
          try {
            sessionStorage.removeItem("ac:perm-modal-shown");
          } catch {}
          setPermOpen(false);
          return;
        }
        try {
          if (sessionStorage.getItem("ac:perm-modal-shown")) return;
          sessionStorage.setItem("ac:perm-modal-shown", "1");
        } catch {}
        setPermOpen(true);
      });
    };
    check();
    const onShow = () => {
      try {
        sessionStorage.removeItem("ac:perm-modal-shown");
      } catch {}
      check();
    };
    const onFocus = () => check();
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("ac:show-permission-modal", onShow);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("ac:show-permission-modal", onShow);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Handle files opened via Open With, file association, or share sheet (cross-platform)
  useEffect(() => {
    let unlistenOpenFiles: (() => void) | null = null;
    void listen<string[]>("open-files", (e) => {
      if (e.payload && e.payload.length > 0) {
        void handleIncomingFiles(e.payload);
      }
    }).then((fn) => (unlistenOpenFiles = fn));

    const handleCustomOpen = (e: Event) => {
      const customEvent = e as CustomEvent<{ paths?: string[] }>;
      const paths = customEvent.detail?.paths;
      if (paths && paths.length > 0) {
        void handleIncomingFiles(paths);
      }
    };

    const handleShared = (e: Event) => {
      const customEvent = e as CustomEvent<{ uri?: string }>;
      const uri = customEvent.detail?.uri;
      if (uri) {
        void handleIncomingFiles([uri]);
      }
    };

    window.addEventListener("ac:open-files", handleCustomOpen);
    window.addEventListener("ac:shared-media", handleShared);

    // Drain any cold-start files received before listeners mounted
    void api.getPendingOpenFiles().then((pending) => {
      if (pending && pending.length > 0) {
        void handleIncomingFiles(pending);
      }
    });

    return () => {
      unlistenOpenFiles?.();
      window.removeEventListener("ac:open-files", handleCustomOpen);
      window.removeEventListener("ac:shared-media", handleShared);
    };
  }, []);

  // Window-wide native drop
  const handleNativeDrop = useCallback(
    (paths: string[]) => {
      addPaths(paths);
    },
    [addPaths],
  );

  useNativeDragDrop(handleNativeDrop);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
    void loadSettings().catch(() => {});
    let cleanup: (() => void) | null = null;
    void initEventListeners().then((fn) => (cleanup = fn));

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

  // Synchronize document title with active tool
  useEffect(() => {
    document.title =
      activeTool === "player"
        ? translate(lang, "musicPlayerTitle")
        : translate(lang, "appTitle");
  }, [activeTool, lang]);

  useTheme();
  useDirection(lang);

  const isConverter = activeTool === "converter";

  return (
    <div className="relative flex h-screen max-w-full flex-col overflow-hidden overflow-x-hidden bg-zinc-100/90 text-zinc-900 select-none dark:bg-[#09090b] dark:text-zinc-100">
      <HeaderBar />

      <main
        className={`relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 overflow-x-hidden px-4 pt-4 md:gap-5 md:px-6 min-h-0 ${
          isConverter
            ? `overflow-y-auto ${files.length > 0 ? "pb-36" : "pb-24"} py-5`
            : "overflow-hidden pb-4"
        }`}
      >
        {isConverter ? (
          <>
            {files.length === 0 && <DropZone />}
            <FileList />
            <OptionsPanel />
            <JobsPanel />
          </>
        ) : (
          <MusicPlayerView />
        )}
      </main>

      {/* Converter Start Bar */}
      {isConverter && files.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-black/[0.06] bg-white/95 backdrop-blur-md px-4 py-3 shadow-sm dark:border-white/[0.06] dark:bg-zinc-900/95 md:px-6">
          <div className="mx-auto w-full max-w-4xl">
            <StartBar />
          </div>
        </div>
      )}

      <Toasts />

      {permOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/15 text-orange-600 dark:text-orange-400">
              <Lock className="h-7 w-7" strokeWidth={2.2} />
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
