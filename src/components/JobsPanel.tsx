import { useMemo, useState } from "react";
import { useAppStore, statusLabelKey } from "../stores/useAppStore";
import { translate } from "../i18n";
import type { QueueItem } from "../types";

function statusColor(status: QueueItem["status"]): string {
  switch (status) {
    case "waiting": return "bg-zinc-400";
    case "processing": return "bg-blue-500 animate-pulse";
    case "completed": return "bg-emerald-500";
    case "failed": return "bg-red-500";
    case "cancelled": return "bg-amber-500";
  }
}

function JobRow({ job }: { job: QueueItem }): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const cancelJob = useAppStore((s) => s.cancelJob);
  const [showTech, setShowTech] = useState(false);
  const name = job.sourcePath.split(/[\\/]/).pop() ?? job.sourcePath;

  const active = job.status === "processing" || job.status === "waiting";

  return (
    <li className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
      <div className="flex items-center gap-2 text-sm">
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor(job.status)}`} />
        <span className="min-w-0 flex-1 truncate" title={job.sourcePath}>{name}</span>
        <span className="text-xs opacity-60">{translate(lang, statusLabelKey(job.status))}</span>
        {active && (
          <button
            onClick={() => void cancelJob(job.id)}
            className="text-xs text-red-500 hover:underline"
          >
            ✕
          </button>
        )}
      </div>

      {(job.status === "processing") && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            data-testid={`progress-${job.id}`}
            className="h-full rounded-full bg-orange-500 transition-all duration-300"
            style={{ width: `${job.percent ?? 0}%` }}
          />
        </div>
      )}

      {job.warning && <p className="mt-1 text-xs text-amber-600">{translate(lang, "warnAllSilent")}</p>}
      {job.error && (
        <>
          <p className="mt-1 text-xs text-red-500">{job.error}</p>
          {(job.technical || null) && (
            <>
              <button
                onClick={() => setShowTech((v) => !v)}
                className="text-xs opacity-50 underline underline-offset-2 hover:opacity-100"
              >
                {showTech ? translate(lang, "hideDetails") : translate(lang, "showDetails")}
              </button>
              {showTech && (
                <pre data-testid="tech-details" className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-zinc-100 p-2 text-[11px] dark:bg-zinc-900">
                  {job.technical}
                </pre>
              )}
            </>
          )}
        </>
      )}
    </li>
  );
}

export function JobsPanel(): React.JSX.Element | null {
  const jobs = useAppStore((s) => s.jobs);
  const cancelAll = useAppStore((s) => s.cancelAll);
  const clearFinishedJobs = useAppStore((s) => s.clearFinishedJobs);
  const lang = useAppStore((s) => s.lang);

  const list = useMemo(
    () => Array.from(jobs.values()).sort((a, b) => a.id.localeCompare(b.id)),
    [jobs],
  );

  if (list.length === 0) {
    return (
      <p className="py-6 text-center text-sm opacity-40" data-testid="queue-empty">
        {translate(lang, "queueEmpty")}
      </p>
    );
  }

  const done = list.filter((j) => j.status === "completed").length;
  const total = list.length;
  const overall = total === 0 ? 0 : Math.round((done / total) * 100);
  const anyActive = list.some((j) => ["waiting", "processing"].includes(j.status));

  return (
    <section className="flex flex-col gap-3" data-testid="jobs-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {translate(lang, "filesCompleted", { done, total })}
        </h2>
        <div className="flex gap-2 text-xs">
          {anyActive && (
            <button onClick={() => void cancelAll()} className="rounded-lg border border-zinc-300 px-2 py-1 hover:border-red-400 hover:text-red-500 dark:border-zinc-700">
              {translate(lang, "cancelAll")}
            </button>
          )}
          {!anyActive && (
            <button onClick={() => void clearFinishedJobs()} className="opacity-60 hover:opacity-100">
              {translate(lang, "clearFinished")}
            </button>
          )}
        </div>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          data-testid="overall-progress"
          className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-500"
          style={{ width: `${overall}%` }}
        />
      </div>

      <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto pe-1">
        {list.map((j) => (
          <JobRow key={j.id} job={j} />
        ))}
      </ul>
    </section>
  );
}
