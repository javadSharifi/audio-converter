import { useAppStore } from "../stores/useAppStore";
import { translate } from "../i18n";
import { formatBytes, formatDuration } from "../utils/format";
import { pickVideos } from "../utils/dialog";
import type { InputFile } from "../types";

function FileRow({ file }: { file: InputFile }): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const removeFile = useAppStore((s) => s.removeFile);

  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <td className="max-w-[280px] truncate px-2 py-2" title={file.path}>
        {file.name}
        {file.error && (
          <span className="block text-xs text-red-500">{file.error}</span>
        )}
      </td>
      <td className="px-2 py-2 text-sm opacity-70">{formatBytes(file.sizeBytes)}</td>
      <td className="px-2 py-2 text-sm opacity-70">
        {file.hasAudio ? formatDuration(file.durationSecs) : "—"}
      </td>
      <td className="px-2 py-2 text-xs uppercase opacity-50">{file.formatName.split(",")[0]}</td>
      <td className="px-2 py-2">
        <button
          onClick={() => removeFile(file.path)}
          className="rounded-md px-2 py-1 text-xs opacity-60 hover:bg-zinc-100 hover:opacity-100 dark:hover:bg-zinc-800"
          aria-label={translate(lang, "removeFile")}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

export function FileList(): React.JSX.Element | null {
  const files = useAppStore((s) => s.files);
  const lang = useAppStore((s) => s.lang);
  const clearFiles = useAppStore((s) => s.clearFiles);
  const addPaths = useAppStore((s) => s.addPaths);

  if (files.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
    <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">{translate(lang, "colFile")} ({files.length})</h2>
        <button
          onClick={clearFiles}
          className="text-xs opacity-60 hover:text-red-500 hover:opacity-100"
        >
          {translate(lang, "clearList")}
        </button>
      </div>
      <table className="w-full table-fixed" data-testid="file-list">
        <thead>
          <tr className="text-start text-xs uppercase tracking-wide opacity-40">
            <th className="px-2 py-1.5 text-start font-medium">{translate(lang, "colFile")}</th>
            <th className="px-2 py-1.5 text-start font-medium">{translate(lang, "colSize")}</th>
            <th className="px-2 py-1.5 text-start font-medium">{translate(lang, "colDuration")}</th>
            <th className="px-2 py-1.5 text-start font-medium">{translate(lang, "colFormat")}</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <FileRow key={f.path} file={f} />
          ))}
        </tbody>
      </table>
      </div>
      <button
        onClick={() => void pickVideos().then(addPaths)}
        data-testid="add-more"
        className="self-start rounded-lg border-2 border-dashed border-zinc-300 px-4 py-2 text-sm font-medium opacity-80 transition-colors hover:border-orange-400 hover:text-orange-600 dark:border-zinc-700 dark:hover:text-orange-400"
      >
        ＋ {translate(lang, "addFiles")}
      </button>
    </div>
  );
}
