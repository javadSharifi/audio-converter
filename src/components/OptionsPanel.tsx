import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../stores/useAppStore";
import { translate, type TranslationKey } from "../i18n";
import {
  MP3_BITRATES,
  AAC_OPUS_BITRATES,
  SAMPLE_RATES,
  SILENCE_THRESHOLDS_DB,
  SILENCE_MIN_DURATIONS,
  isLossy,
  type AudioFormat,
  type OutputMode,
  type QualityPreset,
} from "../types";
import { parseDurationInput, formatBytes } from "../utils/format";
import { estimateOutputBytes, growthHint } from "../utils/estimate";

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
  const [splitRaw, setSplitRaw] = useState("60");

  const lossy = isLossy(options.format);
  const bitrates = options.format === "mp3" ? MP3_BITRATES : AAC_OPUS_BITRATES;

  // Per-format size estimates (each format has its own typical bitrate).
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

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <h2 className="text-sm font-semibold">{translate(lang, "outputSettings")}</h2>

      {/* Format */}
      <div>
        <label className="mb-1 block text-xs opacity-60" htmlFor="format">{translate(lang, "format")}</label>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {FORMATS.map((f) => {
            const est = estFor(f);
            return (
              <button
                key={f}
                id="format"
                onClick={() =>
                  update({
                    format: f,
                    ...(f === "mp3"
                      ? { customBitrateKbps: null }
                      : {}),
                  })
                }
                className={`rounded-lg border px-2 py-1.5 text-xs font-medium uppercase transition-colors
                  ${options.format === f
                    ? "border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400"
                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"}`}
                title={est ? `${translate(lang, "estimatedSize")}: ${est.size} (${est.delta})` : undefined}
              >
                {f}
                {est && (
                  <span className={`block text-[10px] font-normal normal-case tracking-normal ${options.format === f ? "opacity-80" : "opacity-50"}`}>
                    ≈{est.size.replace("≈", "")}
                    {est.delta && (
                      <span className={est.delta.startsWith("+") ? "text-red-500 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                        {" "}{est.delta}
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quality presets / bitrate */}
      <div>
        <label className="mb-1 block text-xs opacity-60">{lossy ? translate(lang, "quality") : "—"}</label>
        {lossy ? (
          <>
            <div className="grid grid-cols-5 gap-1.5">
              {(["low", "medium", "high", "very_high", "custom"] as QualityPreset[]).map((q) => (
                <button
                  key={q}
                  onClick={() => update({ quality: q })}
                  className={`rounded-lg border px-2 py-1.5 text-xs transition-colors
                    ${options.quality === q
                      ? "border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400"
                      : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"}`}
                >
                  {translate(lang, qualityKey(q))}
                </button>
              ))}
            </div>
            {options.quality === "custom" && (
              <select
                value={options.customBitrateKbps ?? ""}
                onChange={(e) => update({ customBitrateKbps: Number(e.target.value) })}
                className="mt-2 w-full rounded-lg border border-zinc-200 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                aria-label={translate(lang, "bitrate")}
              >
                <option value="" disabled>{translate(lang, "bitrate")} (kbps)</option>
                {bitrates.map((b) => (
                  <option key={b} value={b}>{b} kbps</option>
                ))}
              </select>
            )}
          </>
        ) : (
          <p className="text-xs opacity-50">Lossless — bitrate not applicable.</p>
        )}
      </div>

      {/* Split */}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={options.splitEnabled}
          onChange={(e) => update({ splitEnabled: e.target.checked })}
          data-testid="split-toggle"
        />
        {translate(lang, "splitAudio")}
      </label>
      {options.splitEnabled && (
        <input
          type="text"
          value={splitRaw}
          onChange={(e) => applySplitInput(e.target.value)}
          placeholder={translate(lang, "splitDurationPlaceholder")}
          data-testid="split-input"
          className="w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700"
        />
      )}

      {/* Silence removal */}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={options.removeSilence}
          onChange={(e) => update({ removeSilence: e.target.checked })}
          data-testid="silence-toggle"
        />
        {translate(lang, "removeSilence")}
      </label>

      {/* Output location */}
      <div>
        <label className="mb-1 block text-xs opacity-60">{translate(lang, "outputLocation")}</label>
        <select
          value={options.outputMode}
          onChange={(e) => update({ outputMode: e.target.value as OutputMode })}
          className="w-full rounded-lg border border-zinc-200 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="same_as_source">{translate(lang, "outSameAsSource")}</option>
          <option value="custom_folder">{translate(lang, "outCustomFolder")}</option>
          <option value="per_source_folder">{translate(lang, "outPerSourceFolder")}</option>
        </select>
        {options.outputMode === "custom_folder" && (
          <div className="mt-2 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate rounded-lg border border-zinc-200 px-2 py-1.5 text-xs opacity-70 dark:border-zinc-700">
              {options.customOutputDir ?? "—"}
            </span>
            <button onClick={() => void pickFolder()} className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs hover:border-zinc-300 dark:border-zinc-700">
              {translate(lang, "chooseFolder")}
            </button>
          </div>
        )}
      </div>

      {/* Advanced */}
      <div>
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="text-xs opacity-60 hover:opacity-100 underline underline-offset-2"
          aria-expanded={advancedOpen}
        >
          {advancedOpen ? "▾" : "▸"} {translate(lang, "advanced")}
        </button>
        {advancedOpen && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs">
              <span className="mb-1 block opacity-60">{translate(lang, "sampleRate")} (Hz)</span>
              <select
                value={options.sampleRateHz ?? ""}
                onChange={(e) => update({ sampleRateHz: Number(e.target.value) })}
                className="w-full rounded-lg border border-zinc-200 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {SAMPLE_RATES.map((sr) => (
                  <option key={sr} value={sr}>{sr}</option>
                ))}
              </select>
            </label>

            <label className="text-xs">
              <span className="mb-1 block opacity-60">{translate(lang, "channels")}</span>
              <select
                value={options.channels ?? ""}
                onChange={(e) => update({ channels: Number(e.target.value) })}
                className="w-full rounded-lg border border-zinc-200 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value={1}>{translate(lang, "chMono")}</option>
                <option value={2}>{translate(lang, "chStereo")}</option>
              </select>
            </label>

            <label className="text-xs">
              <span className="mb-1 block opacity-60">{translate(lang, "silenceThreshold")} (dB)</span>
              <select
                value={SILENCE_THRESHOLDS_DB.includes(options.silenceThresholdDb as never)
                  ? options.silenceThresholdDb
                  : "custom"}
                onChange={(e) => update({ silenceThresholdDb: Number(e.target.value) })}
                className="w-full rounded-lg border border-zinc-200 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {SILENCE_THRESHOLDS_DB.map((db) => (
                  <option key={db} value={db}>{db} dB</option>
                ))}
                <option value="custom">—</option>
              </select>
            </label>

            <label className="text-xs">
              <span className="mb-1 block opacity-60">{translate(lang, "silenceMinDuration")} ({translate(lang, "seconds")})</span>
              <select
                value={SILENCE_MIN_DURATIONS.includes(options.silenceMinDurationSecs as never)
                  ? options.silenceMinDurationSecs
                  : "custom"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v !== "custom") update({ silenceMinDurationSecs: Number(v) });
                }}
                className="w-full rounded-lg border border-zinc-200 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {SILENCE_MIN_DURATIONS.map((d) => (
                  <option key={d} value={d}>{d}s</option>
                ))}
                <option value="custom">—</option>
              </select>
              {!SILENCE_MIN_DURATIONS.includes(options.silenceMinDurationSecs as never) && (
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={options.silenceMinDurationSecs}
                  onChange={(e) => update({ silenceMinDurationSecs: Number(e.target.value) || 0.1 })}
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
                />
              )}
            </label>
          </div>
        )}
      </div>
    </section>
  );
}
