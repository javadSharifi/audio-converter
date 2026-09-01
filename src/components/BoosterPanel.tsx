import React, { useCallback, useEffect, useState } from "react";
import { Power, Ban, RefreshCw, Volume2 } from "lucide-react";
import { translate } from "../i18n";
import { useAppStore } from "../stores/useAppStore";
import { isAndroid, isMacOS, isWindows, isLinux } from "../utils/platform";
import * as api from "../utils/tauri";
import { ModernSlider } from "./ModernSlider";
import { useLiveBooster } from "../features/sound-booster/live-booster/hooks/useLiveBooster";
import { ConsentExplainerSheet } from "../features/sound-booster/live-booster/ConsentExplainerSheet";
import type { AudioSession, BoosterCapability } from "../types/generated";

// ---------- Helpers ----------
function gainToLevel(gain: number): number {
  // 1.0..4.0 -> 0..100
  return Math.round(((gain - 1.0) / 3.0) * 100);
}
function levelToGain(level: number): number {
  return 1.0 + (level / 100) * 3.0;
}


// ---------- Android Unified ----------
function UnifiedAndroidBoosterPanel(): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const {
    isRunning: liveRunning,
    gain,
    consentSheetOpen,
    error,
    handleToggle: liveToggle,
    handleChangeGain,
    handleConsentConfirm,
    setConsentSheetOpen,
  } = useLiveBooster();

  const [mode, setMode] = useState<"standard" | "live">(() => {
    try {
      const v = localStorage.getItem("ac:booster-mode");
      return v === "live" ? "live" : "standard";
    } catch {
      return "standard";
    }
  });
  const [standardRunning, setStandardRunning] = useState(false);
  const [standardLevel, setStandardLevel] = useState(50);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("ac:booster-mode", mode);
    } catch {}
  }, [mode]);

  const isUnifiedRunning = mode === "live" ? liveRunning : standardRunning;
  const currentLevel = mode === "live" ? gainToLevel(gain) : standardLevel;

  const handleModeSwitch = useCallback(
    async (next: "standard" | "live") => {
      if (busy || next === mode) return;
      setBusy(true);
      try {
        // exclusive: stop other engine before switch
        if (liveRunning) {
          await api.stopLiveBoost().catch(() => {});
        }
        if (standardRunning) {
          setStandardRunning(false);
        }
        setMode(next);
      } finally {
        setTimeout(() => setBusy(false), 350);
      }
    },
    [busy, mode, liveRunning, standardRunning],
  );

  const handlePowerToggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "live") {
        await liveToggle();
      } else {
        // standard placeholder: toggle local state; exclusive stop live if needed
        if (liveRunning) await api.stopLiveBoost().catch(() => {});
        setStandardRunning((v) => !v);
      }
    } finally {
      setTimeout(() => setBusy(false), 400);
    }
  }, [busy, mode, liveToggle, liveRunning]);

  const handleSlider = useCallback(
    (lvl: number) => {
      if (mode === "live") handleChangeGain(levelToGain(lvl));
      else setStandardLevel(lvl);
    },
    [mode, handleChangeGain],
  );

  const isLoading = busy;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-red-500/10 p-3.5 text-xs font-bold text-red-600 dark:text-red-400">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col items-center gap-6 rounded-3xl border border-black/[0.08] bg-white/85 p-6 shadow-sm backdrop-blur-xl dark:border-white/[0.08] dark:bg-zinc-900/85">
        {/* Header + badge */}
        <div className="flex w-full items-center justify-between">
          <div>
            <h2 className="text-sm font-black text-zinc-900 dark:text-zinc-100">
              {translate(lang, "unifiedBoosterTitle")}
            </h2>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {translate(lang, "unifiedBoosterSubtitle")}
            </p>
          </div>
          <span className="rounded-full bg-orange-500/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-orange-600 dark:text-orange-400">
            {mode === "live" ? translate(lang, "engineBadgeLive") : translate(lang, "engineBadgeStandard")}
          </span>
        </div>

        {/* Segmented control */}
        <div className="flex w-full max-w-xs rounded-2xl bg-black/[0.05] p-1 dark:bg-white/[0.06]">
          {(["standard", "live"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => void handleModeSwitch(m)}
              disabled={busy}
              className={`flex-1 rounded-xl px-3 py-1.5 text-xs font-black transition-all ${
                mode === m
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
              }`}
            >
              {translate(lang, m === "standard" ? "modeStandard" : "modeLive")}
            </button>
          ))}
        </div>
        <p className="text-center text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
          {mode === "live"
            ? translate(lang, "unifiedHintLive")
            : translate(lang, "unifiedHintStandard")}
        </p>

        {/* Power */}
        <button
          type="button"
          onClick={() => void handlePowerToggle()}
          disabled={isLoading}
          className={`group relative flex h-28 w-28 flex-col items-center justify-center rounded-full transition-all duration-300 active:scale-95 disabled:opacity-60 ${
            isUnifiedRunning
              ? "bg-gradient-to-tr from-orange-500 via-amber-500 to-orange-500 text-white shadow-2xl shadow-orange-500/40 ring-4 ring-orange-500/25"
              : "border-2 border-black/10 bg-zinc-100 text-zinc-400 hover:border-orange-500/40 dark:border-white/10 dark:bg-zinc-800"
          }`}
          aria-label={isUnifiedRunning ? translate(lang, "unifiedPowerOn") : translate(lang, "unifiedPowerOff")}
        >
          <Power className={`h-10 w-10 ${isUnifiedRunning ? "stroke-white" : "stroke-current"}`} strokeWidth={2.4} />
          <span className="mt-1 text-[10px] font-black uppercase tracking-wider">
            {isUnifiedRunning ? translate(lang, "liveBoostActive") : translate(lang, "liveBoostOff")}
          </span>
        </button>

        {/* Slider */}
        <div className="flex w-full max-w-sm flex-col gap-2" dir="ltr">
          <div className="flex items-center justify-between text-[11px] font-bold text-zinc-500 dark:text-zinc-400">
            <span>{mode === "live" ? "1.0x" : "0%"}</span>
            <span className="text-[10px] uppercase tracking-wider text-orange-600 dark:text-orange-400 font-extrabold">
              {mode === "live" ? translate(lang, "liveBoostMultiplier") : translate(lang, "customGainLevel")}
            </span>
            <span>{mode === "live" ? "4.0x" : "100%"}</span>
          </div>
          <ModernSlider
            value={currentLevel}
            min={0}
            max={100}
            step={1}
            onChange={handleSlider}
            color="orange"
            size="sm"
            leftLabel={(v) => (mode === "live" ? `${levelToGain(v).toFixed(1)}x` : `${v}%`)}
            rightLabel={(v) =>
              mode === "live"
                ? `+${(20 * Math.log10(levelToGain(v))).toFixed(1)} dB`
                : v > 80
                  ? translate(lang, "limiterActiveHint")
                  : ""
            }
          />
        </div>

        {/* Live presets when in live mode */}
        {mode === "live" && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {[1.2, 1.5, 2.0, 2.5, 3.0, 4.0].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleChangeGain(p)}
                className={`rounded-xl px-3 py-1.5 text-xs font-black transition-all active:scale-95 ${
                  Math.abs(gain - p) < 0.05
                    ? "bg-orange-500 text-white shadow-md"
                    : "bg-black/[0.05] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300"
                }`}
              >
                {p.toFixed(1)}x
              </button>
            ))}
          </div>
        )}
      </div>

      <ConsentExplainerSheet
        open={consentSheetOpen}
        onClose={() => setConsentSheetOpen(false)}
        onConfirm={() => {
          handleConsentConfirm();
          if (mode !== "live") setMode("live");
        }}
      />
    </div>
  );
}

// ---------- Desktop ----------
function DesktopBoosterPanel(): React.JSX.Element {
  const lang = useAppStore((s) => s.lang);
  const [capability, setCapability] = useState<BoosterCapability | null>(null);
  const [sessions, setSessions] = useState<AudioSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const cap = await api.getBoosterCapability();
      setCapability(cap);
      if (cap === "fullTierA") {
        const list = await api.listAudioSessions();
        setSessions(list);
      }
      setListError(false);
    } catch {
      // keep previous sessions; surface the failure instead of an empty list
      setListError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const handleBoost = useCallback(
    async (id: string, lvl: number) => {
      // optimistic
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, volume: lvl } : s)));
      try {
        await api.setSessionBoost(id, lvl);
      } catch {
        void refresh();
      }
    },
    [refresh],
  );

  if (isMacOS()) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-black/[0.08] bg-white/70 p-8 text-center shadow-sm dark:border-white/[0.08] dark:bg-zinc-900/70">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-200 text-zinc-500 dark:bg-zinc-800">
          <Ban className="h-6 w-6" />
        </div>
        <h2 className="text-sm font-black">{translate(lang, "desktopUnsupportedTitle")}</h2>
        <p className="max-w-md text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          {translate(lang, "desktopUnsupportedDesc")}
        </p>
      </div>
    );
  }

  const hint = isWindows()
    ? translate(lang, "desktopHintWin")
    : isLinux()
      ? translate(lang, "desktopHintLinux")
      : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-black">{translate(lang, "unifiedBoosterTitle")}</h2>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-black/5 bg-white px-3 py-1.5 text-xs font-bold shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:bg-zinc-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {translate(lang, "desktopRefresh")}
        </button>
      </div>

      {listError ? (
        <div className="flex items-center gap-2.5 rounded-2xl bg-red-500/10 p-3.5 text-xs font-bold text-red-600 dark:text-red-400">
          <span>⚠️</span>
          <span>{translate(lang, "desktopSessionsError")}</span>
        </div>
      ) : capability != null && capability !== "fullTierA" ? (
        <div className="rounded-2xl bg-amber-500/10 p-4 text-xs font-medium text-amber-700 dark:text-amber-300">
          {translate(lang, "desktopCapabilityNone")}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-2xl bg-black/[0.03] p-6 text-center text-xs text-zinc-500 dark:bg-white/[0.04]">
          {translate(lang, "desktopNoSessions")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-white/70 p-3 shadow-sm dark:border-white/[0.06] dark:bg-zinc-900/70"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500/15 text-orange-600">
                <Volume2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold">{s.name}</div>
                <div className="truncate text-[11px] text-zinc-500">{s.id}</div>
              </div>
              <div className="w-40" dir="ltr">
                <ModernSlider
                  value={s.volume}
                  min={0}
                  max={isLinux() ? 150 : 100}
                  step={1}
                  onChange={(v) => void handleBoost(s.id, v)}
                  color="orange"
                  size="sm"
                  leftLabel={`${s.volume}%`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BoosterPanel(): React.JSX.Element {
  if (isAndroid()) return <UnifiedAndroidBoosterPanel />;
  return <DesktopBoosterPanel />;
}
