// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  unifiedPlayTrack,
  unifiedPause,
  unifiedResume,
  unifiedSeekTo,
  unifiedSetRepeatMode,
  unifiedSetShuffleMode,
  unifiedSetSpeed,
  unifiedStop,
  resolveAudioSource,
} from "../audioEngine";
import * as api from "../../../utils/tauri";
import * as platform from "../../../utils/platform";
import type { AudioTrackInfo } from "../../../types";

vi.mock("../../../utils/tauri", () => ({
  androidPlayerPlay: vi.fn(async () => "OK"),
  androidPlayerPause: vi.fn(async () => "OK"),
  androidPlayerResume: vi.fn(async () => "OK"),
  androidPlayerSeekTo: vi.fn(async () => "OK"),
  androidPlayerNext: vi.fn(async () => "OK"),
  androidPlayerPrevious: vi.fn(async () => "OK"),
  androidPlayerSetRepeatMode: vi.fn(async () => "OK"),
  androidPlayerSetShuffleMode: vi.fn(async () => "OK"),
  androidPlayerSetSpeed: vi.fn(async () => "OK"),
  androidPlayerSetVolume: vi.fn(async () => "OK"),
  androidPlayerStop: vi.fn(async () => "OK"),
  androidPlayerGetState: vi.fn(async () => ({
    isPlaying: true,
    currentTimeMs: 15000,
    durationMs: 180000,
  })),
  resolveMediaPaths: vi.fn(async (paths: string[]) =>
    paths.map((p) => ({ input: p, resolved: "/cache/staged.mp3", error: null }))
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

const mockTrack: AudioTrackInfo = {
  id: "test_1",
  uri: "content://media/external/audio/media/1234",
  path: "/storage/emulated/0/Music/test.mp3",
  name: "test.mp3",
  title: "Test Song",
  artist: "Test Artist",
  album: "Test Album",
  durationSecs: 180,
  sizeBytes: 5000000,
  createdTimestampMs: 1000,
  modifiedTimestampMs: 1000,
  format: "mp3",
  mimeType: "audio/mpeg",
  coverUrl: null,
};

describe("Unified Audio Engine (Cross-Platform & Media3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Android Native Media3 Execution", () => {
    beforeEach(() => {
      vi.spyOn(platform, "isAndroid").mockReturnValue(true);
    });

    it("dispatches androidPlayerPlay when on Android", async () => {
      await unifiedPlayTrack(mockTrack, [mockTrack], 0);

      expect(api.androidPlayerPlay).toHaveBeenCalledTimes(1);
      expect(api.androidPlayerPlay).toHaveBeenCalledWith(
        JSON.stringify(mockTrack),
        JSON.stringify([mockTrack]),
        0,
      );
    });

    it("dispatches androidPlayerPause on pause", async () => {
      await unifiedPause();
      expect(api.androidPlayerPause).toHaveBeenCalledTimes(1);
    });

    it("dispatches androidPlayerResume on resume", async () => {
      await unifiedResume();
      expect(api.androidPlayerResume).toHaveBeenCalledTimes(1);
    });

    it("dispatches androidPlayerSeekTo in milliseconds", async () => {
      await unifiedSeekTo(45.5);
      expect(api.androidPlayerSeekTo).toHaveBeenCalledWith(45500);
    });

    it("dispatches repeat mode, shuffle mode, speed, and stop", async () => {
      await unifiedSetRepeatMode("all");
      expect(api.androidPlayerSetRepeatMode).toHaveBeenCalledWith("all");

      await unifiedSetShuffleMode(true);
      expect(api.androidPlayerSetShuffleMode).toHaveBeenCalledWith(true);

      await unifiedSetSpeed(1.25);
      expect(api.androidPlayerSetSpeed).toHaveBeenCalledWith(1.25);

      await unifiedStop();
      expect(api.androidPlayerStop).toHaveBeenCalledTimes(1);
    });
  });

  describe("Audio Source Resolution", () => {
    it("resolves content URIs via Android stage bridge", async () => {
      const resolved = await resolveAudioSource(mockTrack);
      expect(resolved).toContain("staged.mp3");
    });

    it("preserves web URLs without staging", async () => {
      const httpTrack: AudioTrackInfo = { ...mockTrack, uri: "https://example.com/stream.mp3" };
      const resolved = await resolveAudioSource(httpTrack);
      expect(resolved).toBe("https://example.com/stream.mp3");
    });
  });
});
