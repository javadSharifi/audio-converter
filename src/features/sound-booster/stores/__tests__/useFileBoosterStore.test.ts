import { describe, it, expect, beforeEach } from "vitest";
import { useFileBoosterStore } from "../useFileBoosterStore";

describe("useFileBoosterStore", () => {
  beforeEach(() => {
    useFileBoosterStore.getState().reset();
  });

  it("initializes with default smart preset and 100% manual gain", () => {
    const state = useFileBoosterStore.getState();
    expect(state.preset).toBe("smart");
    expect(state.manualGainPercent).toBe(100);
    expect(state.file).toBeNull();
    expect(state.activeAudition).toBe("boosted");
  });

  it("sets and clears file", () => {
    useFileBoosterStore.getState().setFile({
      path: "/path/to/song.mp3",
      name: "song.mp3",
      sizeBytes: 1024000,
      durationSecs: 180,
    });

    expect(useFileBoosterStore.getState().file?.name).toBe("song.mp3");

    useFileBoosterStore.getState().clearFile();
    expect(useFileBoosterStore.getState().file).toBeNull();
  });

  it("updates preset and manual gain", () => {
    useFileBoosterStore.getState().setPreset("bass");
    expect(useFileBoosterStore.getState().preset).toBe("bass");

    useFileBoosterStore.getState().setManualGainPercent(175);
    expect(useFileBoosterStore.getState().manualGainPercent).toBe(175);
  });

  it("updates export progress and outputs", () => {
    useFileBoosterStore.getState().setIsExporting(true);
    useFileBoosterStore.getState().setExportProgress(50, "12x");

    expect(useFileBoosterStore.getState().isExporting).toBe(true);
    expect(useFileBoosterStore.getState().exportProgress).toBe(50);
    expect(useFileBoosterStore.getState().exportSpeed).toBe("12x");

    useFileBoosterStore.getState().setExportOutputs(["/out/boosted.mp3"]);
    expect(useFileBoosterStore.getState().exportOutputs).toEqual(["/out/boosted.mp3"]);
  });
});
