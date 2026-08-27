import { useEffect } from "react";
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
      className="w-full rounded-xl bg-orange-500 py-3 text-sm font-semibold text-white shadow transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy || starting ? "…" : `▶ ${translate(lang, "startConversion")}`}
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

  // Window-wide native drop — lives here, not in DropZone, so drag&drop
  // keeps working after the drop zone unmounts (first file added).
  useNativeDragDrop(addPaths);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
    void loadSettings().catch(() => {});
    let cleanup: (() => void) | null = null;
    void initEventListeners().then((fn) => (cleanup = fn));

    // Auto-open output folder on queue completion (setting-dependent).
    let unlistenIdle: (() => void) | null = null;
    void listen<boolean>("queue-idle", () => {
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
    <div className="flex h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 select-none">
      <HeaderBar />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-y-auto px-3.5 py-4 md:gap-5 md:px-5 md:py-5">
        {/* Drop zone only until the first file lands — then the list takes over. */}
        {files.length === 0 && <DropZone />}
        <FileList />
        <OptionsPanel />
        <JobsPanel />
      </main>
      <footer className="border-t border-zinc-200 bg-white/80 backdrop-blur-md px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] dark:border-zinc-800 dark:bg-zinc-950/80 md:px-5 md:py-4">
        <div className="mx-auto w-full max-w-5xl">
          <StartBar />
        </div>
      </footer>
      <Toasts />
    </div>
  );
}
