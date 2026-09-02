// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { initMediaSession, syncMediaSession } from "../mediaSession";
import type { AudioTrackInfo } from "../../types";

const mockTrack: AudioTrackInfo = {
  id: "track_123",
  uri: "file:///music/song.mp3",
  path: "/music/song.mp3",
  name: "song.mp3",
  title: "Fly Away",
  artist: "TheFatRat",
  album: "Warrior Songs",
  durationSecs: 210,
  sizeBytes: 8000000,
  createdTimestampMs: 1000,
  modifiedTimestampMs: 1000,
  format: "mp3",
  mimeType: "audio/mpeg",
  coverUrl: "https://example.com/cover.jpg",
};

describe("MediaSession & Lock Screen synchronization", () => {
  let actionHandlers: Record<string, Function> = {};

  beforeEach(() => {
    actionHandlers = {};

    // Mock navigator.mediaSession
    Object.defineProperty(navigator, "mediaSession", {
      value: {
        metadata: null,
        playbackState: "none",
        setActionHandler: vi.fn((action: string, handler: Function) => {
          actionHandlers[action] = handler;
        }),
        setPositionState: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  it("registers standard MediaSession action handlers and triggers callbacks", () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onSeek = vi.fn();

    initMediaSession({
      onPlay,
      onPause,
      onPrevious,
      onNext,
      onSeek,
    });

    expect(navigator.mediaSession.setActionHandler).toHaveBeenCalled();

    // Trigger play action
    if (actionHandlers.play) actionHandlers.play();
    expect(onPlay).toHaveBeenCalled();

    // Trigger pause action
    if (actionHandlers.pause) actionHandlers.pause();
    expect(onPause).toHaveBeenCalled();

    // Trigger nexttrack action
    if (actionHandlers.nexttrack) actionHandlers.nexttrack();
    expect(onNext).toHaveBeenCalled();

    // Trigger previoustrack action
    if (actionHandlers.previoustrack) actionHandlers.previoustrack();
    expect(onPrevious).toHaveBeenCalled();

    // Trigger seekto action
    if (actionHandlers.seekto) actionHandlers.seekto({ seekTime: 65 });
    expect(onSeek).toHaveBeenCalledWith(65);

    // Trigger seekforward action (e.g. +15s from current position 50s)
    let currentTime = 50;
    initMediaSession({
      onPlay,
      onPause,
      onPrevious,
      onNext,
      onSeek,
      getCurrentTime: () => currentTime,
    });
    if (actionHandlers.seekforward) actionHandlers.seekforward({ seekOffset: 15 });
    expect(onSeek).toHaveBeenCalledWith(65);

    // Trigger seekbackward action (e.g. -20s from current position 50s)
    if (actionHandlers.seekbackward) actionHandlers.seekbackward({ seekOffset: 20 });
    expect(onSeek).toHaveBeenCalledWith(30);
  });

  it("synchronizes metadata, artwork, playbackState and positionState for lock screen", () => {
    syncMediaSession({
      track: mockTrack,
      isPlaying: true,
      currentTime: 45,
      duration: 210,
      playbackRate: 1.0,
    });

    expect(navigator.mediaSession.playbackState).toBe("playing");
    expect(navigator.mediaSession.metadata?.title).toBe("Fly Away");
    expect(navigator.mediaSession.metadata?.artist).toBe("TheFatRat");
    expect(navigator.mediaSession.metadata?.album).toBe("Warrior Songs");
    expect(navigator.mediaSession.setPositionState).toHaveBeenCalledWith({
      duration: 210,
      playbackRate: 1.0,
      position: 45,
    });
  });

  it("clears metadata and sets state to none when no track is active", () => {
    syncMediaSession({
      track: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRate: 1.0,
    });

    expect(navigator.mediaSession.metadata).toBeNull();
    expect(navigator.mediaSession.playbackState).toBe("none");
  });
});
