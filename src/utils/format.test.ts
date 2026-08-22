import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, parseDurationInput } from "./format";
import { translate, isRtl } from "../i18n";

describe("formatDuration", () => {
  it("formats under an hour as M:SS", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(754)).toBe("12:34");
  });

  it("formats hours with padded minutes/seconds", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(8446)).toBe("2:20:46");
  });

  it("handles garbage input", () => {
    expect(formatDuration(-5)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 ** 3)).toBe("10 GB");
  });
});

describe("parseDurationInput (split duration)", () => {
  it("accepts plain minutes", () => {
    expect(parseDurationInput("45")).toBe(2700);
    expect(parseDurationInput("90.5")).toBe(5430);
  });

  it("accepts HH:MM:SS and MM:SS", () => {
    expect(parseDurationInput("01:00:00")).toBe(3600);
    expect(parseDurationInput("1:00:00")).toBe(3600);
    expect(parseDurationInput("20:30")).toBe(1230);
  });

  it("rejects invalid values", () => {
    expect(parseDurationInput("")).toBeNull();
    expect(parseDurationInput("abc")).toBeNull();
    expect(parseDurationInput("0")).toBeNull();
    expect(parseDurationInput("-5")).toBeNull();
    expect(parseDurationInput("1:2:3:4")).toBeNull();
    expect(parseDurationInput("1::30")).toBeNull();
  });
});

describe("i18n", () => {
  it("falls back to English when key missing in target", () => {
    expect(translate("fa", "startConversion")).toBe("شروع تبدیل");
    expect(translate("en", "statusFailed")).toBe("Failed");
  });

  it("interpolates params", () => {
    const text = translate("en", "filesCompleted", { done: 2, total: 5 });
    expect(text).toContain("2");
    expect(text).toContain("5");
  });

  it("marks Persian as RTL", () => {
    expect(isRtl("fa")).toBe(true);
    expect(isRtl("en")).toBe(false);
  });
});
