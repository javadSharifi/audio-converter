// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useLiveBoosterStore } from "../useLiveBoosterStore";

describe("useLiveBoosterStore", () => {
  it("initializes with sensible gain and stopped state", () => {
    const state = useLiveBoosterStore.getState();
    expect(state.isRunning).toBe(false);
    expect(state.gain).toBeGreaterThanOrEqual(1.0);
    expect(state.gain).toBeLessThanOrEqual(4.0);
  });

  it("updates running state and gain", () => {
    useLiveBoosterStore.getState().setIsRunning(true);
    expect(useLiveBoosterStore.getState().isRunning).toBe(true);

    useLiveBoosterStore.getState().setGain(2.5);
    expect(useLiveBoosterStore.getState().gain).toBe(2.5);

    useLiveBoosterStore.getState().setIsRunning(false);
    expect(useLiveBoosterStore.getState().isRunning).toBe(false);
  });

  it("controls consent sheet modal", () => {
    useLiveBoosterStore.getState().setConsentSheetOpen(true);
    expect(useLiveBoosterStore.getState().consentSheetOpen).toBe(true);

    useLiveBoosterStore.getState().setConsentSheetOpen(false);
    expect(useLiveBoosterStore.getState().consentSheetOpen).toBe(false);
  });
});
