import { create } from "zustand";
import type { LiveBoosterState } from "../shared/boosterTypes";

export interface LiveBoosterStore extends LiveBoosterState {
  setIsRunning: (isRunning: boolean) => void;
  setGain: (gain: number) => void;
  setIsSupported: (isSupported: boolean) => void;
  setConsentSheetOpen: (open: boolean) => void;
  setHasSeenExplainer: (seen: boolean) => void;
  setError: (error: string | null) => void;
}

const STORAGE_KEY_SEEN = "ac:live-boost-explainer-seen";
const STORAGE_KEY_GAIN = "ac:live-boost-gain";

const getSavedSeen = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY_SEEN) === "1";
  } catch {
    return false;
  }
};

const getSavedGain = (): number => {
  try {
    const val = localStorage.getItem(STORAGE_KEY_GAIN);
    if (val) {
      const parsed = parseFloat(val);
      if (!isNaN(parsed) && parsed >= 1.0 && parsed <= 4.0) return parsed;
    }
  } catch {
    /* ignore */
  }
  return 1.5; // +3.5 dB default boost
};

export const useLiveBoosterStore = create<LiveBoosterStore>((set) => ({
  isRunning: false,
  gain: getSavedGain(),
  isSupported: true, // evaluated at runtime
  consentSheetOpen: false,
  hasSeenExplainer: getSavedSeen(),
  error: null,

  setIsRunning: (isRunning) => set({ isRunning }),
  setGain: (gain) => {
    try {
      localStorage.setItem(STORAGE_KEY_GAIN, String(gain));
    } catch {
      /* ignore */
    }
    set({ gain });
  },
  setIsSupported: (isSupported) => set({ isSupported }),
  setConsentSheetOpen: (consentSheetOpen) => set({ consentSheetOpen }),
  setHasSeenExplainer: (hasSeenExplainer) => {
    try {
      if (hasSeenExplainer) {
        localStorage.setItem(STORAGE_KEY_SEEN, "1");
      }
    } catch {
      /* ignore */
    }
    set({ hasSeenExplainer });
  },
  setError: (error) => set({ error }),
}));
