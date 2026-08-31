import { useCallback, useEffect } from "react";
import { useLiveBoosterStore } from "../../stores/useLiveBoosterStore";
import * as api from "../../../../utils/tauri";
import { isAndroid } from "../../../../utils/platform";

export function useLiveBooster() {
  const store = useLiveBoosterStore();
  const {
    isRunning,
    gain,
    hasSeenExplainer,
    setIsRunning,
    setGain,
    setIsSupported,
    setConsentSheetOpen,
    setHasSeenExplainer,
    setError,
  } = store;

  // Check support and active status
  useEffect(() => {
    if (!isAndroid()) {
      setIsSupported(false);
      return;
    }

    void api.isLiveBoostSupported().then(setIsSupported).catch(() => setIsSupported(false));
    void api.getLiveBoostStatus().then((st) => {
      setIsRunning(st.isRunning);
    }).catch(() => {});

    // Listen to native events when service starts, stops, or gets cancelled
    const onState = (e: Event) => {
      const custom = e as CustomEvent<{ isRunning?: boolean }>;
      if (typeof custom.detail?.isRunning === "boolean") {
        setIsRunning(custom.detail.isRunning);
      }
    };
    window.addEventListener("ac:live-boost-state", onState);

    // Sync status whenever app window regains focus
    const onFocus = () => {
      void api.getLiveBoostStatus().then((st) => {
        setIsRunning(st.isRunning);
      }).catch(() => {});
    };
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("ac:live-boost-state", onState);
      window.removeEventListener("focus", onFocus);
    };
  }, [setIsSupported, setIsRunning]);

  // Start live boost
  const handleStart = useCallback(async () => {
    if (!hasSeenExplainer) {
      setConsentSheetOpen(true);
      return;
    }

    setError(null);
    try {
      await api.startLiveBoost(gain);
      // Verify state after brief delay for Android system consent dialog
      setTimeout(() => {
        void api.getLiveBoostStatus().then((st) => {
          setIsRunning(st.isRunning);
        }).catch(() => {});
      }, 400);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setIsRunning(false);
    }
  }, [gain, hasSeenExplainer, setConsentSheetOpen, setError, setIsRunning]);

  // Stop live boost
  const handleStop = useCallback(async () => {
    setError(null);
    try {
      await api.stopLiveBoost();
      setIsRunning(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, [setError, setIsRunning]);

  // Toggle power
  const handleToggle = useCallback(() => {
    if (isRunning) {
      void handleStop();
    } else {
      void handleStart();
    }
  }, [isRunning, handleStop, handleStart]);

  // Adjust gain dynamically
  const handleChangeGain = useCallback(
    async (newGain: number) => {
      setGain(newGain);
      if (isRunning) {
        try {
          await api.setLiveBoostGain(newGain);
        } catch {
          /* ignore */
        }
      }
    },
    [isRunning, setGain],
  );

  // Confirm explainer sheet
  const handleConsentConfirm = useCallback(() => {
    setHasSeenExplainer(true);
    setConsentSheetOpen(false);
    void handleStart();
  }, [setHasSeenExplainer, setConsentSheetOpen, handleStart]);

  return {
    ...store,
    handleToggle,
    handleStart,
    handleStop,
    handleChangeGain,
    handleConsentConfirm,
  };
}
