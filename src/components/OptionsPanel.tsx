import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../stores/useAppStore";
import { translate, type TranslationKey } from "../i18n";
import {
  MP3_BITRATES,
  AAC_OPUS_BITRATES,
  SAMPLE_RATES,
  SILENCE_THRESHOLDS_DB,
  isLossy,
  type AudioFormat,
  type QualityPreset,
} from "../types";
import { parseDurationInput, formatBytes } from "../utils/format";
import { estimateOutputBytes, growthHint } from "../utils/estimate";
import { isAndroid } from "../utils/platform";
import { Folder, ChevronDown, ChevronRight } from "lucide-react";

const FORMATS: AudioFormat[] = ["mp3", "aac", "m4a", "opus", "wav", "flac"];

function qualityKey(q: QualityPreset): TranslationKey {
  switch (q) {
    case "low": return "qLow";
    case "medium": return "qMedium";
    case "high": return "qHigh";
    case "very_high": return "qVeryHigh";
    case "custom": return "qCustom";
  }
}

export function OptionsPanel(): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const options = useAppStore((s) => s.options);
  const files = useAppStore((s) => s.files);
  const update = useAppStore((s) => s.updateOptions);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const lossy = isLossy(options.format);
  const bitrates = options.format === "mp3" ? MP3_BITRATES : AAC_OPUS_BITRATES;

  const [splitRaw, setSplitRaw] = useState(() => String((options.splitDurationSecs ?? 3600) / 60));

  const estFor = (fmt: AudioFormat): { size: string; delta: string } | null => {
    const bytes = estimateOutputBytes(files, fmt, options);
    if (bytes === null) return null;
    return {
      size: `≈${formatBytes(bytes)}`,
      delta: growthHint(files, bytes) ?? "",
    };
  };

  const applySplitInput = (raw: string) => {
    setSplitRaw(raw);
    const secs = parseDurationInput(raw);
    if (secs !== null) update({ splitDurationSecs: secs });
  };

  const pickFolder = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") update({ customOutputDir: dir });
  };

  const android = isAndroid();

  return (
    <section className="glass-panel flex flex-col gap-5 rounded-3xl p-5 md:p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-black/[0.05] pb-3 dark:border-white/[0.05]">
        <h2 className="text-sm font-bold tracking-tight text-zinc-800 dark:text-zinc-100">{translate(lang, "outputSettings")}</h2>
        <span className="rounded-full bg-orange-500/10 px-2.5 py-0.5 text-[11px] font-bold text-orange-600 dark:text-orange-400">
          {options.format.toUpperCase()}
        </span>
      </div>

      {/* Format Selector */}
      <div>
        <label className="mb-2 block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider" htmlFor="format">
          {translate(lang, "format")}
        </label>

        {/* Mobile View: Compact Select */}
        <div className="sm:hidden">
          <select
            id="format"
            value={options.format}
            onChange={(e) =>
              update({
                format: e.target.value as AudioFormat,
                ...(e.target.value === "mp3" ? { customBitrateKbps: null } : {}),
              })
            }
            className="glass-pill w-full rounded-2xl px-3.5 py-2.5 text-xs font-bold text-zinc-800 outline-none dark:text-zinc-200 shadow-sm cursor-pointer"
            aria-label={translate(lang, "format")}
          >
            {FORMATS.map((f) => {
              const est = estFor(f);
              return (
                <option key={f} value={f} className="dark:bg-zinc-900 font-semibold">
                  {f.toUpperCase()} {est ? `(${est.size}${est.delta ? `, ${est.delta}` : ""})` : ""}
                </option>
              );
            })}
          </select>
        </div>

        {/* Desktop View: Full Button Grid */}
        <div className="hidden sm:grid grid-cols-6 gap-2 rounded-2xl border border-black/5 bg-black/[0.03] p-1.5 dark:border-white/5 dark:bg-white/[0.03]">
          {FORMATS.map((f) => {
            const est = estFor(f);
            const active = options.format === f;
            const isIncrease = est?.delta ? est.delta.startsWith("+") : false;
            return (
              <button
                key={f}
                type="button"
                onClick={() =>
                  update({
                    format: f,
                    ...(f === "mp3" ? { customBitrateKbps: null } : {}),
                  })
                }
                className={`group relative flex flex-col items-center justify-center rounded-xl py-2.5 px-1.5 text-xs transition-all duration-200 active:scale-95
                  ${active
                    ? "bg-white text-orange-600 shadow-md shadow-black/5 dark:bg-zinc-800 dark:text-orange-400 dark:shadow-black/30"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}
                title={est ? `${translate(lang, "estimatedSize")}: ${est.size} (${est.delta})` : undefined}
              >
                <span className="font-bold uppercase tracking-wide">{f}</span>
                {est && (
                  <div className="mt-1 flex flex-col items-center gap-0.5">
                    <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                      ≈{est.size.replace("≈", "")}
                    </span>
                    {est.delta && (
                      <span
                        className={`rounded-md px-1 py-0.2 text-[10px] font-bold tabular-nums ${
                          isIncrease
                            ? "bg-red-500/10 text-red-500 dark:text-red-400"
                            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {est.delta}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quality presets / bitrate */}
      <div>
        <label className="mb-2 block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          {lossy ? translate(lang, "quality") : "—"}
        </label>
        {lossy ? (
          <>
            {/* Mobile View: Compact Select */}
            <div className="sm:hidden">
              <select
                value={options.quality}
                onChange={(e) => update({ quality: e.target.value as QualityPreset })}
                className="glass-pill w-full rounded-2xl px-3.5 py-2.5 text-xs font-bold text-zinc-800 outline-none dark:text-zinc-200 shadow-sm cursor-pointer"
                aria-label={translate(lang, "quality")}
              >
                {(["low", "medium", "high", "very_high", "custom"] as QualityPreset[]).map((q) => (
                  <option key={q} value={q} className="dark:bg-zinc-900 font-semibold">
                    {translate(lang, qualityKey(q))}
                  </option>
                ))}
              </select>
            </div>

            {/* Desktop View: Button Grid */}
            <div className="hidden sm:grid grid-cols-5 gap-1.5 rounded-2xl border border-black/5 bg-black/[0.03] p-1.5 dark:border-white/5 dark:bg-white/[0.03]">
              {(["low", "medium", "high", "very_high", "custom"] as QualityPreset[]).map((q) => {
                const active = options.quality === q;
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={() => update({ quality: q })}
                    className={`rounded-xl py-2 px-2 text-xs font-semibold transition-all duration-200 active:scale-95
                      ${active
                        ? "bg-white text-orange-600 shadow-md shadow-black/5 dark:bg-zinc-800 dark:text-orange-400 dark:shadow-black/20"
                        : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}
                  >
                    {translate(lang, qualityKey(q))}
                  </button>
                );
              })}
            </div>

            {options.quality === "custom" && (
              <select
                value={options.customBitrateKbps ?? ""}
                onChange={(e) => update({ customBitrateKbps: Number(e.target.value) })}
                className="glass-pill mt-2.5 w-full rounded-xl px-3 py-2 text-xs font-semibold text-zinc-800 outline-none dark:text-zinc-200"
                aria-label={translate(lang, "bitrate")}
              >
                <option value="" disabled className="dark:bg-zinc-900">{translate(lang, "bitrate")} (kbps)</option>
                {bitrates.map((b) => (
                  <option key={b} value={b} className="dark:bg-zinc-900">{b} kbps</option>
                ))}
              </select>
            )}
          </>
        ) : (
          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Lossless — bitrate not applicable.</p>
        )}
      </div>

      {/* Feature Toggles (Split & Silence) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Split */}
        <div className="glass-card rounded-2xl p-3.5 space-y-2.5">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{translate(lang, "splitAudio")}</span>
            <input
              type="checkbox"
              checked={options.splitEnabled}
              onChange={(e) => {
                update({ splitEnabled: e.target.checked });
                if (e.target.checked) applySplitInput(splitRaw);
              }}
              data-testid="split-toggle"
              className="h-4 w-4 rounded accent-orange-500 cursor-pointer"
            />
          </label>
          {options.splitEnabled && (
            <input
              type="text"
              value={splitRaw}
              onChange={(e) => applySplitInput(e.target.value)}
              placeholder={translate(lang, "splitDurationPlaceholder")}
              data-testid="split-input"
              className="glass-pill w-full rounded-xl px-3 py-1.5 text-xs font-medium outline-none"
            />
          )}
        </div>

        {/* Silence */}
        <div className="glass-card rounded-2xl p-3.5 space-y-2.5">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{translate(lang, "removeSilence")}</span>
            <input
              type="checkbox"
              checked={options.removeSilence}
              onChange={(e) => update({ removeSilence: e.target.checked })}
              data-testid="silence-toggle"
              className="h-4 w-4 rounded accent-orange-500 cursor-pointer"
            />
          </label>
          {options.removeSilence && (
            <div className="flex gap-2">
              <select
                value={options.silenceThresholdDb}
                onChange={(e) => update({ silenceThresholdDb: Number(e.target.value) })}
                className="glass-pill flex-1 rounded-xl px-2 py-1.5 text-xs font-medium outline-none"
                aria-label={translate(lang, "silenceThreshold")}
              >
                {SILENCE_THRESHOLDS_DB.map((db) => (
                  <option key={db} value={db} className="dark:bg-zinc-900">{db} dB</option>
                ))}
              </select>
              <input
                type="number"
                min={0.1}
                max={30}
                step={0.5}
                value={options.silenceMinDurationSecs ?? 2.0}
                onChange={(e) => update({ silenceMinDurationSecs: Number(e.target.value) })}
                className="glass-pill w-20 rounded-xl px-2 py-1.5 text-center text-xs font-medium outline-none"
                title={`${translate(lang, "silenceMinDuration")} (s)`}
                aria-label={`${translate(lang, "silenceMinDuration")} (s)`}
              />
            </div>
          )}
        </div>
      </div>

      {/* Output folder options */}
      <div className="border-t border-black/[0.04] pt-3 dark:border-white/[0.04]">
        <label className="mb-2 block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          {translate(lang, "outputLocation")}
        </label>
        {android ? (
          <div className="glass-card flex items-center gap-3 rounded-2xl p-3.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <Folder className="h-4 w-4 shrink-0 text-orange-500" />
            <span>{translate(lang, "outAndroidHint")}</span>
          </div>
        ) : (
          <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(
              [
                ["same_as_source", "outSameAsSource"],
                ["custom_folder", "outCustomFolder"],
                ["per_source_folder", "outPerSourceFolder"],
              ] as const
            ).map(([mode, key]) => {
              const active = options.outputMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => update({ outputMode: mode })}
                  className={`rounded-2xl p-3 text-xs font-semibold transition-all duration-200 text-start active:scale-95
                    ${active
                      ? "bg-white text-orange-600 shadow-md shadow-black/5 dark:bg-zinc-800 dark:text-orange-400 dark:shadow-black/20"
                      : "text-zinc-600 hover:bg-black/[0.02] dark:text-zinc-400 dark:hover:bg-white/[0.02]"}`}
                >
                  {translate(lang, key)}
                </button>
              );
            })}
          </div>

          {options.outputMode === "custom_folder" && (
            <div className="glass-card mt-3 flex items-center justify-between gap-3 rounded-2xl p-3.5 animate-in fade-in duration-200">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500">
                  <Folder className="h-4 w-4" strokeWidth={2} />
                </div>
                <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300" title={options.customOutputDir ?? ""}>
                  {options.customOutputDir || "—"}
                </span>
              </div>
              <button
                onClick={() => void pickFolder()}
                className="shrink-0 rounded-xl bg-orange-500 px-3.5 py-2 text-xs font-bold text-white shadow-sm shadow-orange-500/25 hover:bg-orange-600 active:scale-95 transition-all"
              >
                {translate(lang, "chooseFolder")}
              </button>
            </div>
          )}
          </>
        )}
      </div>

      {/* Advanced */}
      <div className="border-t border-black/[0.04] pt-3 dark:border-white/[0.04]">
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-orange-500 dark:text-zinc-400"
          aria-expanded={advancedOpen}
        >
          {advancedOpen ? (
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.2} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
          )}
          <span>{translate(lang, "advanced")}</span>
        </button>
        {advancedOpen && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 animate-in fade-in duration-200">
            <label className="text-xs font-medium">
              <span className="mb-1 block text-zinc-500 dark:text-zinc-400">{translate(lang, "sampleRate")} (Hz)</span>
              <select
                value={options.sampleRateHz ?? ""}
                onChange={(e) => update({ sampleRateHz: Number(e.target.value) })}
                className="glass-pill w-full rounded-xl px-3 py-2 text-xs font-semibold text-zinc-800 outline-none dark:text-zinc-200"
              >
                <option value="" className="dark:bg-zinc-900">{translate(lang, "sameAsSource")}</option>
                {SAMPLE_RATES.map((sr) => (
                  <option key={sr} value={sr} className="dark:bg-zinc-900">{sr}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium">
              <span className="mb-1 block text-zinc-500 dark:text-zinc-400">{translate(lang, "channels")}</span>
              <select
                value={options.channels ?? ""}
                onChange={(e) => update({ channels: Number(e.target.value) })}
                className="glass-pill w-full rounded-xl px-3 py-2 text-xs font-semibold text-zinc-800 outline-none dark:text-zinc-200"
              >
                <option value="" className="dark:bg-zinc-900">{translate(lang, "sameAsSource")}</option>
                <option value="1" className="dark:bg-zinc-900">1 (Mono)</option>
                <option value="2" className="dark:bg-zinc-900">2 (Stereo)</option>
              </select>
            </label>
          </div>
        )}
      </div>
    </section>
  );
}
