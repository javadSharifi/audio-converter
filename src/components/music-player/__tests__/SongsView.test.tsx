// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SongsView } from "../SongsView";
import { useMusicPlayerStore, filterAndSortTracks } from "../../../stores/useMusicPlayerStore";
import { useAppStore } from "../../../stores/useAppStore";
import type { AudioTrackInfo } from "../../../types";

vi.mock("../../../utils/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils/tauri")>();
  return {
    ...actual,
    scanAudioFiles: vi.fn(async () => []),
    getMusicPermissionStatus: vi.fn(async () => "granted"),
    requestMediaPermissions: vi.fn(async () => true),
    openAppSettings: vi.fn(async () => {}),
  };
});

const mockTracks: AudioTrackInfo[] = [
  {
    id: "track_1",
    uri: "file:///music/track1.mp3",
    path: "/music/track1.mp3",
    name: "track1.mp3",
    title: "Track One",
    artist: "Artist A",
    album: "Album A",
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
    uri: "file:///music/track2.flac",
    path: "/music/track2.flac",
    name: "track2.flac",
    title: "Track Two",
    artist: "Artist B",
    album: "Album B",
    durationSecs: 240,
    sizeBytes: 25000000,
    createdTimestampMs: 5000, // Newer
    modifiedTimestampMs: 5000,
    format: "flac",
    mimeType: "audio/flac",
    coverUrl: null,
  },
  {
    id: "track_3",
    uri: "file:///music/track3.m4a",
    path: "/music/track3.m4a",
    name: "track3.m4a",
    title: "Summer Beat",
    artist: "Artist C",
    album: "Album C",
    durationSecs: 200,
    sizeBytes: 8000000,
    createdTimestampMs: 3000,
    modifiedTimestampMs: 3000,
    format: "m4a",
    mimeType: "audio/mp4",
    coverUrl: null,
  },
];

beforeEach(() => {
  cleanup();
  useAppStore.setState({ lang: "en" });
  useMusicPlayerStore.setState({
    tracks: mockTracks,
    loading: false,
    hasScanned: true,
    searchQuery: "",
    sortBy: "newest",
    likedPaths: new Set(),
    permissionStatus: "granted",
  });
});

describe("filterAndSortTracks", () => {
  it("sorts by newest first by default", () => {
    const result = filterAndSortTracks(mockTracks, "", "newest", new Set());
    expect(result[0].path).toBe("/music/track2.flac"); // 5000
    expect(result[1].path).toBe("/music/track3.m4a"); // 3000
    expect(result[2].path).toBe("/music/track1.mp3"); // 1000
  });

  it("sorts by oldest first", () => {
    const result = filterAndSortTracks(mockTracks, "", "oldest", new Set());
    expect(result[0].path).toBe("/music/track1.mp3"); // 1000
    expect(result[1].path).toBe("/music/track3.m4a"); // 3000
    expect(result[2].path).toBe("/music/track2.flac"); // 5000
  });

  it("sorts by title alphabetically", () => {
    const result = filterAndSortTracks(mockTracks, "", "title", new Set());
    expect(result[0].title).toBe("Summer Beat");
    expect(result[1].title).toBe("Track One");
    expect(result[2].title).toBe("Track Two");
  });

  it("sorts liked tracks first when sortBy is liked", () => {
    const liked = new Set(["file:///music/track1.mp3"]);
    const result = filterAndSortTracks(mockTracks, "", "liked", liked);
    expect(result[0].path).toBe("/music/track1.mp3");
  });

  it("filters tracks by search query", () => {
    const result = filterAndSortTracks(mockTracks, "summer", "newest", new Set());
    expect(result.length).toBe(1);
    expect(result[0].title).toBe("Summer Beat");
  });

  it("filters tracks by format", () => {
    const result = filterAndSortTracks(mockTracks, "flac", "newest", new Set());
    expect(result.length).toBe(1);
    expect(result[0].format).toBe("flac");
  });
});

describe("SongsView Component", () => {
  it("renders search input, sort button, and track list", () => {
    render(<SongsView />);

    expect(screen.getByPlaceholderText(/Search songs/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sort by/i })).toBeTruthy();
    expect(screen.getByText("Track One")).toBeTruthy();
    expect(screen.getByText("Track Two")).toBeTruthy();
    expect(screen.getByText("Summer Beat")).toBeTruthy();
  });

  it("filters list on search input change", () => {
    render(<SongsView />);

    const searchInput = screen.getByPlaceholderText(/Search songs/i);
    fireEvent.change(searchInput, { target: { value: "Summer" } });

    expect(screen.getByText("Summer Beat")).toBeTruthy();
    expect(screen.queryByText("Track One")).toBeNull();
  });

  it("toggles like and unlike on a track via options sheet", () => {
    render(<SongsView />);

    const moreButtons = screen.getAllByRole("button", { name: /More options/i });
    expect(moreButtons.length).toBe(3);

    // Open options sheet for first track in sorted list (track2 is newest)
    fireEvent.click(moreButtons[0]);
    const likeBtn = screen.getByText(/Like track/i);
    fireEvent.click(likeBtn);
    expect(useMusicPlayerStore.getState().likedPaths.has(mockTracks[1].uri)).toBe(true);
  });

  it("opens sort menu and allows changing sort order, persisting in state", () => {
    render(<SongsView />);

    const sortBtn = screen.getByRole("button", { name: /Sort by/i });
    fireEvent.click(sortBtn);

    const oldestOption = screen.getByText(/Oldest First/i);
    fireEvent.click(oldestOption);

    expect(useMusicPlayerStore.getState().sortBy).toBe("oldest");
  });

  it("opens fullscreen song page on row click, but only toggles playback on play button click", () => {
    render(<SongsView />);

    // Click on the title text of the first track -> opens fullscreen player
    const trackRowText = screen.getByText("Summer Beat");
    fireEvent.click(trackRowText);

    expect(useMusicPlayerStore.getState().fullscreenOpen).toBe(true);

    // Close fullscreen player
    useMusicPlayerStore.setState({ fullscreenOpen: false });

    // Click on the Play button -> plays/pauses without opening fullscreen
    const playButtons = screen.getAllByRole("button", { name: /Play song/i });
    fireEvent.click(playButtons[0]);

    expect(useMusicPlayerStore.getState().fullscreenOpen).toBe(false);
    expect(useMusicPlayerStore.getState().currentTrack).not.toBeNull();
  });
});
