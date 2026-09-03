// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMusicPlayerStore } from "../../../stores/useMusicPlayerStore";
import { useAppStore } from "../../../stores/useAppStore";
import { NowPlayingView } from "../NowPlayingView";
import { MiniPlayer } from "../MiniPlayer";
import { WaveformSeekbar } from "../WaveformSeekbar";
import type { AudioTrackInfo } from "../../../types";

const mockTrack1: AudioTrackInfo = {
  id: "track_droeloe_1",
  uri: "file:///music/droeloe.mp3",
  path: "/music/droeloe.mp3",
  name: "droeloe.mp3",
  title: "DROELOE",
  artist: "Strangers (feat. Iris Penning)",
  album: "Nightblue Music",
  durationSecs: 198,
  sizeBytes: 6000000,
  createdTimestampMs: 1000,
  modifiedTimestampMs: 1000,
  format: "mp3",
  mimeType: "audio/mpeg",
  coverUrl: null,
};

const mockTrack2: AudioTrackInfo = {
  id: "track_droeloe_2",
  uri: "file:///music/droeloe2.mp3",
  path: "/music/droeloe2.mp3",
  name: "droeloe2.mp3",
  title: "Sunburn",
  artist: "DROELOE",
  album: "Nightblue Music",
  durationSecs: 210,
  sizeBytes: 6500000,
  createdTimestampMs: 2000,
  modifiedTimestampMs: 2000,
  format: "mp3",
  mimeType: "audio/mpeg",
  coverUrl: null,
};

beforeEach(() => {
  cleanup();
  useAppStore.setState({
    lang: "en",
    activeTool: "player",
    files: [],
  });
  useMusicPlayerStore.setState({
    tracks: [mockTrack1, mockTrack2],
    currentPlaylist: [mockTrack1, mockTrack2],
    currentTrack: mockTrack1,
    isPlaying: true,
    currentTime: 106,
    duration: 198,
    fullscreenOpen: false,
    repeatMode: "off",
    shuffleMode: false,
    playbackRate: 1.0,
    volumeGainPercent: 100,
    likedPaths: new Set(),
  });
});

describe("WaveformSeekbar Component", () => {
  it("renders waveform bars and formatted timestamps", () => {
    const onSeek = vi.fn();
    render(
      <WaveformSeekbar
        currentTime={106}
        duration={198}
        onSeek={onSeek}
        trackSeed="test"
      />,
    );

    // 01:46 and 03:18
    expect(screen.getByText("01:46")).toBeTruthy();
    expect(screen.getByText("03:18")).toBeTruthy();
  });
});

describe("MiniPlayer Component", () => {
  it("renders mini player when track is active and opens fullscreen on click", () => {
    render(<MiniPlayer />);

    expect(screen.getByText("DROELOE")).toBeTruthy();
    expect(screen.getByText("Strangers (feat. Iris Penning)")).toBeTruthy();

    // Click anywhere on mini player
    const title = screen.getByText("DROELOE");
    fireEvent.click(title);

    expect(useMusicPlayerStore.getState().fullscreenOpen).toBe(true);
  });

  it("allows interactive seeking from the mini player progress bar", () => {
    render(<MiniPlayer />);

    const seekbar = screen.getByTitle("01:46 / 03:18");
    expect(seekbar).toBeTruthy();

    fireEvent.mouseDown(seekbar, { clientX: 100 });
    expect(useMusicPlayerStore.getState().currentTime).toBeDefined();
  });

  it("handles previous and next track buttons in mini player", () => {
    render(<MiniPlayer />);

    const prevBtn = screen.getByTitle(/Previous song/i);
    const nextBtn = screen.getByTitle(/Next song/i);

    expect(prevBtn).toBeTruthy();
    expect(nextBtn).toBeTruthy();

    fireEvent.click(prevBtn);
    fireEvent.click(nextBtn);
  });
});

describe("NowPlayingView Fullscreen Player", () => {
  it("renders complete player elements when fullscreenOpen is true", () => {
    useMusicPlayerStore.setState({ fullscreenOpen: true });
    render(<NowPlayingView />);

    // Header counter and album name
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByText("Nightblue Music")).toBeTruthy();

    // Track metadata
    expect(screen.getAllByText("DROELOE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Strangers (feat. Iris Penning)").length).toBeGreaterThan(0);

    // Converter button
    expect(screen.getByText(/Converter/i)).toBeTruthy();

    // Speed button & Booster button
    expect(screen.getByTitle(/Playback Speed/i)).toBeTruthy();
    expect(screen.getByTitle(/Sound Booster/i)).toBeTruthy();
  });

  it("switches to Converter tool when Converter button is clicked", () => {
    useMusicPlayerStore.setState({ fullscreenOpen: true });
    render(<NowPlayingView />);

    const converterBtn = screen.getByRole("button", { name: /Converter/i });
    fireEvent.click(converterBtn);

    expect(useAppStore.getState().activeTool).toBe("converter");
    expect(useMusicPlayerStore.getState().fullscreenOpen).toBe(false);
  });

  it("toggles and updates playback speed from 0.5x to 4.0x", () => {
    useMusicPlayerStore.setState({ fullscreenOpen: true });
    render(<NowPlayingView />);

    const speedBtn = screen.getByTitle(/Playback Speed/i);
    fireEvent.click(speedBtn);

    // Click 2.0x preset
    const preset2x = screen.getByRole("button", { name: "2x" });
    fireEvent.click(preset2x);

    expect(useMusicPlayerStore.getState().playbackRate).toBe(2.0);
  });

  it("toggles and updates sound booster gain from 100% to 400%", () => {
    useMusicPlayerStore.setState({ fullscreenOpen: true });
    render(<NowPlayingView />);

    const boosterBtn = screen.getByTitle(/Sound Booster/i);
    fireEvent.click(boosterBtn);

    // Click 200% preset
    const preset200 = screen.getByRole("button", { name: "200%" });
    fireEvent.click(preset200);

    expect(useMusicPlayerStore.getState().volumeGainPercent).toBe(200);
  });

  it("toggles repeat and shuffle modes", () => {
    useMusicPlayerStore.setState({ fullscreenOpen: true });
    render(<NowPlayingView />);

    // Repeat toggle
    const repeatBtn = screen.getByTitle(/Repeat Off/i);
    fireEvent.click(repeatBtn);
    expect(useMusicPlayerStore.getState().repeatMode).toBe("all");

    // Shuffle toggle
    const shuffleBtn = screen.getByTitle(/Shuffle Off/i);
    fireEvent.click(shuffleBtn);
    expect(useMusicPlayerStore.getState().shuffleMode).toBe(true);
  });

  it("opens Queue drawer and collapses player", () => {
    useMusicPlayerStore.setState({ fullscreenOpen: true });
    render(<NowPlayingView />);

    // Queue drawer
    const queueBtn = screen.getByTitle(/Up Next \/ Queue/i);
    fireEvent.click(queueBtn);

    expect(screen.getAllByText("Sunburn").length).toBeGreaterThan(0);

    // Collapse player
    const collapseBtn = screen.getByTitle(/Minimize Player/i);
    fireEvent.click(collapseBtn);

    expect(useMusicPlayerStore.getState().fullscreenOpen).toBe(false);
  });
});
