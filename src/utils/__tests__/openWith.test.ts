import { describe, it, expect, vi, beforeEach } from "vitest";
import { isAudioPath, createFallbackTrack, handleIncomingFiles } from "../openWith";
import { useAppStore } from "../../stores/useAppStore";
import { useMusicPlayerStore } from "../../stores/useMusicPlayerStore";
import * as api from "../tauri";

vi.mock("../tauri", () => ({
  resolveAudioTrack: vi.fn(),
  getPendingOpenFiles: vi.fn().mockResolvedValue([]),
}));

describe("openWith utility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeTool: "converter",
      files: [],
    });
    useMusicPlayerStore.setState({
      currentTrack: null,
      isPlaying: false,
      fullscreenOpen: false,
      currentPlaylist: [],
    });
  });

  describe("isAudioPath", () => {
    it("identifies common audio extensions", () => {
      expect(isAudioPath("/home/user/Music/song.mp3")).toBe(true);
      expect(isAudioPath("C:\\Users\\Song.FLAC")).toBe(true);
      expect(isAudioPath("audio.wav")).toBe(true);
      expect(isAudioPath("track.m4a")).toBe(true);
      expect(isAudioPath("podcast.ogg")).toBe(true);
      expect(isAudioPath("voice.opus")).toBe(true);
    });

    it("identifies Android content URIs as audio", () => {
      expect(isAudioPath("content://media/external/audio/media/123")).toBe(true);
    });

    it("rejects video and other non-audio files", () => {
      expect(isAudioPath("/videos/movie.mp4")).toBe(false);
      expect(isAudioPath("clip.mkv")).toBe(false);
      expect(isAudioPath("video.webm")).toBe(false);
      expect(isAudioPath("document.pdf")).toBe(false);
    });
  });

  describe("createFallbackTrack", () => {
    it("creates track info for desktop file", () => {
      const track = createFallbackTrack("/Users/test/Music/MySong.mp3");
      expect(track.name).toBe("MySong.mp3");
      expect(track.uri).toBe("file:///Users/test/Music/MySong.mp3");
      expect(track.path).toBe("/Users/test/Music/MySong.mp3");
      expect(track.format).toBe("mp3");
    });

    it("creates track info for content URI", () => {
      const track = createFallbackTrack("content://media/external/audio/media/456");
      expect(track.uri).toBe("content://media/external/audio/media/456");
      expect(track.path).toBeNull();
      expect(track.id).toContain("content_");
    });
  });

  describe("handleIncomingFiles", () => {
    it("switches to player and begins playback for audio file", async () => {
      vi.mocked(api.resolveAudioTrack).mockResolvedValueOnce({
        id: "mock_1",
        uri: "file:///test/song.mp3",
        path: "/test/song.mp3",
        name: "song.mp3",
        title: "Test Song",
        artist: "Test Artist",
        album: "Test Album",
        durationSecs: 180,
        sizeBytes: 5000000,
        modifiedTimestampMs: 1000,
        createdTimestampMs: 1000,
        format: "mp3",
        mimeType: "audio/mpeg",
        coverUrl: null,
      });

      const playSpy = vi.spyOn(useMusicPlayerStore.getState(), "playTrack").mockResolvedValueOnce();

      await handleIncomingFiles(["/test/song.mp3"]);

      expect(useAppStore.getState().activeTool).toBe("player");
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(useMusicPlayerStore.getState().fullscreenOpen).toBe(true);
    });

    it("switches to converter for video file and adds to queue", async () => {
      const addPathsSpy = vi.spyOn(useAppStore.getState(), "addPaths").mockResolvedValueOnce();

      useAppStore.setState({ activeTool: "player" });
      await handleIncomingFiles(["/test/movie.mp4"]);

      expect(useAppStore.getState().activeTool).toBe("converter");
      expect(addPathsSpy).toHaveBeenCalledWith(["/test/movie.mp4"]);
    });

    it("ignores empty or invalid input", async () => {
      const playSpy = vi.spyOn(useMusicPlayerStore.getState(), "playTrack");
      await handleIncomingFiles(["", "   "]);
      expect(playSpy).not.toHaveBeenCalled();
    });
  });
});
