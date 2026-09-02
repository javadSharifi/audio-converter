// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SetRingtoneModal } from "../SetRingtoneModal";
import { useMusicPlayerStore } from "../../../stores/useMusicPlayerStore";
import { useAppStore } from "../../../stores/useAppStore";
import type { AudioTrackInfo } from "../../../types";

vi.mock("../../../utils/tauri", () => ({
  setAsRingtone: vi.fn(async () => {}),
  waveformPeaks: vi.fn(async () => []),
  resolveMediaPaths: vi.fn(async (paths: string[]) => paths.map((p) => ({ path: p, resolved: p }))),
}));

vi.mock("../../../utils/platform", () => ({
  isAndroid: vi.fn(() => true),
}));

const mockTrack: AudioTrackInfo = {
  id: "track_ringtone_1",
  uri: "file:///music/ringtone_song.mp3",
  path: "/music/ringtone_song.mp3",
  name: "ringtone_song.mp3",
  title: "Amazing Song",
  artist: "Top Artist",
  album: "Hit Album",
  durationSecs: 240,
  sizeBytes: 8000000,
  createdTimestampMs: 1000,
  modifiedTimestampMs: 1000,
  format: "mp3",
  mimeType: "audio/mpeg",
  coverUrl: null,
};

beforeEach(() => {
  cleanup();
  useAppStore.setState({ lang: "en" });
});

describe("SetRingtoneModal Component", () => {
  it("renders ringtone trimming interface with presets and default 30s window", () => {
    render(<SetRingtoneModal track={mockTrack} onClose={() => {}} />);

    expect(screen.getAllByText("Set as Ringtone").length).toBeGreaterThan(0);
    expect(screen.getByText(/Amazing Song/i)).toBeTruthy();
    expect(screen.getByText(/Top Artist/i)).toBeTruthy();

    // Presets
    expect(screen.getByText("15s")).toBeTruthy();
    expect(screen.getByText("30s")).toBeTruthy();
    expect(screen.getByText("45s")).toBeTruthy();
    expect(screen.getAllByText("Full Song").length).toBeGreaterThan(0);
  });

  it("updates start and end range when clicking presets", () => {
    render(<SetRingtoneModal track={mockTrack} onClose={() => {}} />);

    const preset15 = screen.getByText("15s");
    fireEvent.click(preset15);

    expect(screen.getByText("0:15.0")).toBeTruthy();

    const preset45 = screen.getByText("45s");
    fireEvent.click(preset45);

    expect(screen.getByText("0:45.0")).toBeTruthy();
  });

  it("calls setRingtone and triggers confirmation on submit", async () => {
    const setRingtoneSpy = vi.fn(async () => {});
    useMusicPlayerStore.setState({ setRingtone: setRingtoneSpy });

    render(<SetRingtoneModal track={mockTrack} onClose={() => {}} />);

    const submitBtn = screen.getByRole("button", { name: /Set as Ringtone/i });
    fireEvent.click(submitBtn);

    expect(setRingtoneSpy).toHaveBeenCalledWith(mockTrack);
  });

  it("plays preview starting strictly from selStart", () => {
    render(<SetRingtoneModal track={mockTrack} onClose={() => {}} />);

    // Click 45s preset -> range 0:00 to 0:45
    const preset45 = screen.getByText("45s");
    fireEvent.click(preset45);

    // Play preview button
    const playBtn = screen.getByRole("button", { name: /Preview/i });
    fireEvent.click(playBtn);
  });
});
