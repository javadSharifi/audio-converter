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
    <li className="glass-card flex flex-col rounded-2xl p-3.5 transition-all">
      <div className="flex items-center gap-2.5 text-xs font-semibold">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full shadow-sm ${statusColor(job.status)}`} />
        <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-100" title={job.sourcePath}>
          {name}
        </span>
        {job.status === "processing" && job.percent != null && (
          <span className="shrink-0 rounded-md bg-blue-500/10 px-2 py-0.5 font-bold tabular-nums text-blue-600 dark:text-blue-400">
            {Math.round(job.percent)}%
          </span>
        )}
        <span className="shrink-0 text-zinc-400 dark:text-zinc-500 font-medium">{translate(lang, statusLabelKey(job.status))}</span>
        {active && (
          <button
            onClick={() => void cancelJob(job.id)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-500/10 hover:text-red-500"
            title="Cancel"
          >
            ✕
          </button>
        )}
      </div>

      {(job.status === "processing") && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/5">
          <div
            data-testid={`progress-${job.id}`}
            className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-300 shadow-sm shadow-orange-500/30"
            style={{ width: `${job.percent ?? 0}%` }}
          />
        </div>
      )}

      {job.status === "completed" && job.outputs && job.outputs.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 rounded-xl bg-emerald-500/5 p-2 border border-emerald-500/10 dark:bg-emerald-500/10">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <span>✓</span>
            <span>{lang === "fa" ? "فایل‌های خروجی تولیدشده:" : "Output files created:"}</span>
          </div>
          <div className="flex flex-col gap-1">
            {job.outputs.map((outPath, idx) => {
              const outName = outPath.split(/[\\/]/).pop() ?? outPath;
              return (
                <span
                  key={idx}
                  className="font-mono text-[10px] text-zinc-700 dark:text-zinc-300 truncate"
                  title={outPath}
                >
                  📄 {outName}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {job.warning && <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">{translate(lang, "warnAllSilent")}</p>}
      {job.error && (
        <>
          <p className="mt-1.5 text-xs font-medium text-red-500">{job.error}</p>
          {(job.technical || null) && (
            <>
              <button
                onClick={() => setShowTech((v) => !v)}
                className="mt-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline underline-offset-2"
              >
                {showTech ? translate(lang, "hideDetails") : translate(lang, "showDetails")}
              </button>
              {showTech && (
                <pre data-testid="tech-details" className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-black/5 bg-black/[0.03] p-2.5 text-[10px] text-zinc-600 dark:border-white/5 dark:bg-black/40 dark:text-zinc-300">
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

  // Numeric-aware: "job-…-10" must sort after "job-…-2". Ids are monotonic
  // per enqueue, so this keeps rows in stable submission order — no jumping.
  const collator = useMemo(
    () => new Intl.Collator(undefined, { numeric: true }),
    [],
  );
  const list = useMemo(
    () => Array.from(jobs.values()).sort((a, b) => collator.compare(a.id, b.id)),
    [jobs, collator],
  );

  if (list.length === 0) {
    return (
      <p className="py-4 text-center text-xs font-medium text-zinc-400" data-testid="queue-empty">
        {translate(lang, "queueEmpty")}
      </p>
    );
  }

  const done = list.filter((j) => j.status === "completed").length;
  const failed = list.filter((j) => j.status === "failed").length;
  const active = list.filter((j) => j.status === "processing" || j.status === "waiting").length;
  const total = list.length;
  const overall = total === 0 ? 0 : Math.round((done / total) * 100);
  const anyActive = active > 0;

  return (
    <section className="glass-panel flex flex-col gap-4 rounded-3xl p-5 md:p-6 shadow-sm" data-testid="jobs-panel">
      <div className="flex items-center justify-between gap-2 border-b border-black/[0.05] pb-3 dark:border-white/[0.05]">
        {/* Compact per-status counters */}
        <div className="flex items-center gap-3 text-xs font-semibold tabular-nums">
          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400" title={translate(lang, "statusCompleted")}>
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
            {done}/{total}
          </span>
          {active > 0 && (
            <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400" title={translate(lang, "statusProcessing")}>
              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500 shadow-sm shadow-blue-500/50" />
              {active}
            </span>
          )}
          {failed > 0 && (
            <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400" title={translate(lang, "statusFailed")}>
              <span className="h-2 w-2 rounded-full bg-red-500 shadow-sm shadow-red-500/50" />
              {failed}
            </span>
          )}
        </div>
        <div className="flex gap-2 text-xs">
          {anyActive && (
            <button
              onClick={() => void cancelAll()}
              className="rounded-xl border border-red-500/30 px-3 py-1 text-xs font-semibold text-red-500 hover:bg-red-500/10 active:scale-95"
            >
              {translate(lang, "cancelAll")}
            </button>
          )}
          {!anyActive && (
            <button
              onClick={() => void clearFinishedJobs()}
              className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white"
            >
              {translate(lang, "clearFinished")}
            </button>
          )}
        </div>
      </div>

      <div className="relative h-2 overflow-hidden rounded-full bg-black/5 dark:bg-white/5">
        <div
          data-testid="overall-progress"
          className="h-full rounded-full bg-gradient-to-r from-orange-500 via-amber-400 to-orange-500 transition-all duration-500 shadow-sm shadow-orange-500/30"
          style={{ width: `${overall}%` }}
        />
      </div>

      <ul className="flex max-h-96 flex-col gap-2.5 overflow-y-auto pe-1">
        {list.map((j) => (
          <JobRow key={j.id} job={j} />
        ))}
      </ul>
    </section>
  );
}
