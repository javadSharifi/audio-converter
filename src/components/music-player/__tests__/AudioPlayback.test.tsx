// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useMusicPlayerStore } from "../../../stores/useMusicPlayerStore";
import { useAppStore } from "../../../stores/useAppStore";
import { TrackRow } from "../TrackRow";
import type { AudioTrackInfo } from "../../../types";

const mockTrack1: AudioTrackInfo = {
  id: "track_1",
  uri: "file:///music/song1.mp3",
  path: "/music/song1.mp3",
  name: "song1.mp3",
  title: "First Melody",
  artist: "Artist One",
  album: "Album One",
  durationSecs: 180,
  sizeBytes: 4000000,
  createdTimestampMs: 1000,
  modifiedTimestampMs: 1000,
  format: "mp3",
  mimeType: "audio/mpeg",
  coverUrl: null,
};

const mockTrack2: AudioTrackInfo = {
  id: "track_2",
  uri: "file:///music/song2.flac",
  path: "/music/song2.flac",
  name: "song2.flac",
  title: "Second Symphony",
  artist: "Artist Two",
  album: "Album Two",
  durationSecs: 240,
  sizeBytes: 20000000,
  createdTimestampMs: 2000,
  modifiedTimestampMs: 2000,
  format: "flac",
  mimeType: "audio/flac",
  coverUrl: null,
};

beforeEach(() => {
  cleanup();
  useAppStore.setState({ lang: "en" });
  useMusicPlayerStore.setState({
    tracks: [mockTrack1, mockTrack2],
    currentPlaylist: [mockTrack1, mockTrack2],
    currentTrack: null,
    isPlaying: false,
    likedPaths: new Set(),
  });
});

describe("Audio Playback and Single Track Constraint", () => {
  it("plays only one track at a time and updates currentTrack and isPlaying", async () => {
    const store = useMusicPlayerStore.getState();
    await store.playTrack(mockTrack1, [mockTrack1, mockTrack2]);

    expect(useMusicPlayerStore.getState().currentTrack?.id).toBe("track_1");
    expect(useMusicPlayerStore.getState().isPlaying).toBe(true);

    // Play second track -> replaces the first one
    await store.playTrack(mockTrack2, [mockTrack1, mockTrack2]);
    expect(useMusicPlayerStore.getState().currentTrack?.id).toBe("track_2");
    expect(useMusicPlayerStore.getState().isPlaying).toBe(true);
  });

  it("advances automatically to the next track when playNextTrack is called", async () => {
    const store = useMusicPlayerStore.getState();
    await store.playTrack(mockTrack1, [mockTrack1, mockTrack2]);
    expect(useMusicPlayerStore.getState().currentTrack?.id).toBe("track_1");

    await store.playNextTrack();
    expect(useMusicPlayerStore.getState().currentTrack?.id).toBe("track_2");

    // Reaching end loops back to first track
    await store.playNextTrack();
    expect(useMusicPlayerStore.getState().currentTrack?.id).toBe("track_1");
  });

  it("renders Play button and toggles to Pause with active visual indicator when playing", () => {
    const { rerender } = render(<TrackRow track={mockTrack1} />);

    const playBtn = screen.getByRole("button", { name: /Play song/i });
    expect(playBtn).toBeTruthy();

    // Set state as currently playing track 1
    useMusicPlayerStore.setState({
      currentTrack: mockTrack1,
      isPlaying: true,
    });

    rerender(<TrackRow track={mockTrack1} />);

    // Play button now shows Pause song
    const pauseBtn = screen.getByRole("button", { name: /Pause song/i });
    expect(pauseBtn).toBeTruthy();

    // Active playing indicator equalizer is visible
    expect(screen.getAllByTitle(/Now Playing/i).length).toBeGreaterThan(0);
  });
});
