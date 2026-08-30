import { useState } from "react";
import { useAppStore } from "../stores/useAppStore";
import { translate } from "../i18n";
import { pickVideos } from "../utils/dialog";

/** Ask App to (re)check and show the permission popup if needed. */
function requestPermissionCheck(): void {
  window.dispatchEvent(new CustomEvent("ac:show-permission-modal"));
}

export function DropZone(): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const addPaths = useAppStore((s) => s.addPaths);
  const probing = useAppStore((s) => s.probing);
  const [hover, setHover] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        requestPermissionCheck();
        void pickVideos().then(addPaths);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          requestPermissionCheck();
          void pickVideos().then(addPaths);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      data-testid="dropzone"
      className={`glass-panel group relative flex min-h-[300px] flex-col items-center justify-center gap-5 rounded-3xl p-8 md:p-12 text-center cursor-pointer transition-all duration-300 select-none overflow-hidden
        ${hover
          ? "scale-[1.01] border-orange-500/80 ring-4 ring-orange-500/20 bg-orange-500/[0.08]"
          : "hover:scale-[1.005] hover:border-orange-500/40"}`}
    >
      {/* Ambient background glow inside card */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-orange-500/[0.04] via-transparent to-transparent opacity-60 group-hover:opacity-100 transition-opacity" />

      {/* Prominent Glowing Upload & Audio Icon */}
      <div className={`relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-tr from-orange-500 via-amber-400 to-orange-400 text-white shadow-xl shadow-orange-500/30 transition-transform duration-300 group-hover:scale-105 ${probing ? "animate-pulse" : ""}`}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>

      <div className="space-y-1.5 z-10">
        <p className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white md:text-xl">
          {probing ? translate(lang, "preparingFiles") : translate(lang, "dropHere")}
        </p>
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {probing ? "..." : translate(lang, "supported")}
        </p>
      </div>

      {/* Explicit Stylish Button inside DropZone */}
      <div className="z-10 mt-1">
        <span className="inline-flex items-center gap-2 rounded-2xl bg-white/80 dark:bg-zinc-800/80 px-5 py-2.5 text-xs font-bold text-orange-600 dark:text-orange-400 shadow-sm border border-black/5 dark:border-white/10 group-hover:bg-orange-500 group-hover:text-white transition-all">
          {probing ? (
            <svg className="animate-spin h-4 w-4 text-orange-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <span>＋</span>
          )}
          <span>{probing ? translate(lang, "preparingFiles") : translate(lang, "orBrowse")}</span>
        </span>
      </div>
    </div>
  );
}
