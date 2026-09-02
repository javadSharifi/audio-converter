// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMusicPlayerStore } from "../../../stores/useMusicPlayerStore";
import { useAppStore } from "../../../stores/useAppStore";
import { SongsView } from "../SongsView";
import type { AudioTrackInfo } from "../../../types";

vi.mock("../../../utils/tauri", () => ({
  scanAudioFiles: vi.fn(async () => []),
  getMusicPermissionStatus: vi.fn(async () => "granted"),
  requestMediaPermissions: vi.fn(async () => true),
  openAppSettings: vi.fn(async () => {}),
  deleteAudioTrack: vi.fn(async () => true),
}));

const mockTracks: AudioTrackInfo[] = [
  {
    id: "track_1",
    uri: "file:///music/song1.mp3",
    path: "/music/song1.mp3",
    name: "song1.mp3",
    title: "First Song",
    artist: "Artist 1",
    album: "Album 1",
    durationSecs: 180,
    sizeBytes: 5000000,
    createdTimestampMs: 1000,
    modifiedTimestampMs: 1000,
    format: "mp3",
    mimeType: "audio/mpeg",
    coverUrl: null,
  },
  {
    id: "track_2",
    uri: "file:///music/song2.mp3",
    path: "/music/song2.mp3",
    name: "song2.mp3",
    title: "Second Song",
    artist: "Artist 2",
    album: "Album 2",
    durationSecs: 200,
    sizeBytes: 6000000,
    createdTimestampMs: 2000,
    modifiedTimestampMs: 2000,
    format: "mp3",
    mimeType: "audio/mpeg",
    coverUrl: null,
  },
];

beforeEach(() => {
  cleanup();
  useAppStore.setState({
    lang: "en",
    activeTool: "player",
    files: [],
  });
  useMusicPlayerStore.setState({
    tracks: mockTracks,
    currentPlaylist: mockTracks,
    hasScanned: true,
    loading: false,
    likedPaths: new Set(),
    selectedTrackKeys: new Set(),
    isSelectionMode: false,
    customAlbums: [],
  });
});

describe("Multi-Select Mode in Music Player", () => {
  it("enters multi-select mode and toggles selection on click", () => {
    useMusicPlayerStore.setState({
      isSelectionMode: true,
      selectedTrackKeys: new Set(["file:///music/song1.mp3"]),
    });

    render(<SongsView />);

    expect(screen.getByText("1 selected")).toBeTruthy();

    // Clicking second track adds it to selection
    const song2 = screen.getByText("Second Song");
    fireEvent.click(song2);

    expect(useMusicPlayerStore.getState().selectedTrackKeys.size).toBe(2);
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("converts selected tracks by adding to converter queue and switching tool", () => {
    useMusicPlayerStore.setState({
      isSelectionMode: true,
      selectedTrackKeys: new Set(["file:///music/song1.mp3", "file:///music/song2.mp3"]),
    });

    render(<SongsView />);

    const convertBtn = screen.getByTitle(/Convert/i);
    fireEvent.click(convertBtn);

    expect(useAppStore.getState().activeTool).toBe("converter");
    expect(useMusicPlayerStore.getState().isSelectionMode).toBe(false);
  });

  it("deletes multiple selected tracks on confirm", async () => {
    useMusicPlayerStore.setState({
      isSelectionMode: true,
      selectedTrackKeys: new Set(["file:///music/song1.mp3"]),
    });

    render(<SongsView />);

    const deleteBtn = screen.getByTitle(/Delete/i);
    fireEvent.click(deleteBtn);

    // Confirmation modal appears
    expect(screen.getByText(/Delete 1 songs\?/i)).toBeTruthy();

    const deleteButtons = screen.getAllByRole("button", { name: /Delete/i });
    const modalConfirmBtn = deleteButtons[deleteButtons.length - 1];
    fireEvent.click(modalConfirmBtn);
    await Promise.resolve();

    // Track 1 should be removed
    expect(useMusicPlayerStore.getState().tracks.length).toBe(1);
    expect(useMusicPlayerStore.getState().tracks[0].title).toBe("Second Song");
  });

  it("adds multiple selected tracks to an album", () => {
    useMusicPlayerStore.setState({
      isSelectionMode: true,
      selectedTrackKeys: new Set(["file:///music/song1.mp3", "file:///music/song2.mp3"]),
      customAlbums: [
        {
          id: "album_party",
          name: "Party Hits",
          trackKeys: [],
          createdAtMs: 1000,
          updatedAtMs: 1000,
        },
      ],
    });

    render(<SongsView />);

    const albumBtn = screen.getByTitle(/Add to Album/i);
    fireEvent.click(albumBtn);

    // Modal appears
    expect(screen.getByText("Party Hits")).toBeTruthy();

    // Click party hits album
    fireEvent.click(screen.getByText("Party Hits"));

    const partyAlbum = useMusicPlayerStore.getState().customAlbums.find((a) => a.id === "album_party");
    expect(partyAlbum?.trackKeys.length).toBe(2);
  });
});
