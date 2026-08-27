import { useState } from "react";
import { useAppStore } from "../stores/useAppStore";
import { translate } from "../i18n";
import { pickVideos } from "../utils/dialog";

export function DropZone(): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const addPaths = useAppStore((s) => s.addPaths);
  const probing = useAppStore((s) => s.probing);
  const [hover, setHover] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => void pickVideos().then(addPaths)}
      onKeyDown={(e) => e.key === "Enter" && void pickVideos().then(addPaths)}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      data-testid="dropzone"
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors select-none
        ${hover
          ? "border-orange-400 bg-orange-400/10"
          : "border-zinc-300 dark:border-zinc-700 hover:border-orange-400/70"}`}
    >
      <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden
        className={probing ? "animate-pulse text-orange-500" : "text-zinc-400"}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <p className="text-base font-medium">{translate(lang, "dropHere")}</p>
      <p className="text-sm opacity-60">{translate(lang, "orBrowse")}</p>
      <p className="text-xs opacity-40">{translate(lang, "supported")}</p>
    </div>
  );
}
