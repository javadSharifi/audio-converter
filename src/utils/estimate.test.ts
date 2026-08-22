import { describe, expect, it } from "vitest";
import { estimateKbps, estimateOutputBytes, growthHint } from "./estimate";
import type { InputFile } from "../types";

function file(durSecs: number, sizeBytes: number): InputFile {
  return {
    path: "/x/v.mp4",
    name: "v.mp4",
    sizeBytes,
    durationSecs: durSecs,
    formatName: "webm",
    hasAudio: true,
    error: null,
  };
}

const opts = { quality: "medium", customBitrateKbps: null } as const;

describe("estimateKbps", () => {
  it("matches Rust presets", () => {
    expect(estimateKbps("mp3", opts)).toBe(192);
    expect(estimateKbps("mp3", { quality: "very_high", customBitrateKbps: null })).toBe(320);
    expect(estimateKbps("opus", { quality: "low", customBitrateKbps: null })).toBe(64);
    expect(estimateKbps("aac", { quality: "custom", customBitrateKbps: 160 })).toBe(160);
    expect(estimateKbps("wav", opts)).toBe(1411);
    expect(estimateKbps("flac", opts)).toBe(900);
  });
});

describe("estimateOutputBytes — the 40MB webm → mp3 case", () => {
  it("shows why webm grows into mp3", () => {
    // 40 MB webm, ~1h audio at low opus bitrate
    const f = [file(3600, 40 * 1024 * 1024)];
    const bytes = estimateOutputBytes(f, "mp3", opts)!;
    // 192kbps × 1h = 86.4 MB
    expect(bytes).toBeCloseTo(86_400_000, -4);
    expect(growthHint(f, bytes)).toMatch(/^\+\d+%$/);
  });

  it("returns null without valid files", () => {
    expect(estimateOutputBytes([], "mp3", opts)).toBeNull();
    expect(
      estimateOutputBytes([file(0, 100)], "mp3", opts),
    ).toBeNull();
  });

  it("sums multiple files", () => {
    const bytes = estimateOutputBytes([file(60, 0), file(60, 0)], "wav", opts)!;
    expect(bytes).toBeCloseTo(1411 * 125 * 120, -2);
  });
});

describe("growthHint", () => {
  it("negative when shrinking", () => {
    expect(growthHint([file(600, 500 * 1024 * 1024)], 50_000_000)).toMatch(/^-\d+%$/);
  });
  it("±0% when equal", () => {
    expect(growthHint([file(10, 160_000)], 160_000)).toBe("±0%");
  });
});
