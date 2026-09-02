// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  useMusicPlayerStore,
  computeAllAlbums,
} from "../../../stores/useMusicPlayerStore";
import { AlbumsView } from "../AlbumsView";
import { AddToAlbumModal } from "../AddToAlbumModal";
import type { AudioTrackInfo, CustomAlbum } from "../../../types";

const track1: AudioTrackInfo = {
  id: "track_1",
  uri: "file:///music/song1.mp3",
  path: "/music/song1.mp3",
  name: "song1.mp3",
  title: "First Song",
  artist: "Mohsen Yeganeh",
  album: "Album 1",
  durationSecs: 180,
  sizeBytes: 5000000,
  createdTimestampMs: 1000,
  modifiedTimestampMs: 1000,
  format: "mp3",
  mimeType: "audio/mpeg",
  coverUrl: "https://example.com/cover1.jpg",
};

const track2: AudioTrackInfo = {
  id: "track_2",
  uri: "file:///music/song2.mp3",
  path: "/music/song2.mp3",
  name: "song2.mp3",
  title: "Second Song",
  artist: "Mohsen Yeganeh",
  album: "Album 1",
  durationSecs: 200,
  sizeBytes: 6000000,
  createdTimestampMs: 5000, // Newer track!
  modifiedTimestampMs: 5000,
  format: "mp3",
  mimeType: "audio/mpeg",
  coverUrl: "https://example.com/cover2.jpg",
};

const track3: AudioTrackInfo = {
  id: "track_3",
  uri: "file:///music/song3.mp3",
  path: "/music/song3.mp3",
  name: "song3.mp3",
  title: "Shadmehr Song",
  artist: "Shadmehr Aghili",
  album: "Taghdir",
  durationSecs: 240,
  sizeBytes: 7000000,
  createdTimestampMs: 2000,
  modifiedTimestampMs: 2000,
  format: "mp3",
  mimeType: "audio/mpeg",
  coverUrl: null,
};

const customWeddingAlbum: CustomAlbum = {
  id: "custom_wedding_1",
  name: "Wedding Songs",
  trackKeys: ["track_1", "track_2"],
  createdAtMs: 10000,
  updatedAtMs: 10000,
};

beforeEach(() => {
  cleanup();
  useMusicPlayerStore.setState({
    tracks: [track1, track2, track3],
    customAlbums: [customWeddingAlbum],
    currentPlaylist: [],
    currentTrack: null,
    isPlaying: false,
    likedPaths: new Set(),
  });
});

describe("Albums Logic & computeAllAlbums", () => {
  it("prioritizes custom albums and selects latest song as cover", () => {
    const { custom, auto } = computeAllAlbums(
      [track1, track2, track3],
      [customWeddingAlbum],
    );

    // Custom album exists
    expect(custom).toHaveLength(1);
    expect(custom[0].name).toBe("Wedding Songs");
    expect(custom[0].isCustom).toBe(true);
    expect(custom[0].tracks).toHaveLength(2);

    // Latest track (track2 with timestamp 5000) is selected as album cover
    expect(custom[0].coverTrack?.id).toBe("track_2");
    expect(custom[0].totalDurationSecs).toBe(380);

    // Auto albums grouped by artist
    expect(auto).toHaveLength(2);
    const mohsenGroup = auto.find((a) => a.name === "Mohsen Yeganeh");
    expect(mohsenGroup).toBeDefined();
    expect(mohsenGroup?.tracks).toHaveLength(2);
    expect(mohsenGroup?.coverTrack?.id).toBe("track_2");
  });
});

describe("AlbumsView Component", () => {
  it("renders custom albums in first row and artist albums below", () => {
    render(<AlbumsView />);

    // Custom albums section header
    expect(screen.getAllByText(/My Custom Albums/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Wedding Songs/i)).toBeTruthy();
    expect(screen.getAllByText(/New Album/i).length).toBeGreaterThan(0);

    // Artists section
    expect(screen.getByText(/Artists & Library Albums/i)).toBeTruthy();
    expect(screen.getByText(/Mohsen Yeganeh/i)).toBeTruthy();
    expect(screen.getByText(/Shadmehr Aghili/i)).toBeTruthy();
  });

  it("creates a new custom album and adds it to the first row", () => {
    render(<AlbumsView />);

    // Click create button
    const createBtns = screen.getAllByText(/New Album/i);
    fireEvent.click(createBtns[0]);

    // Fill form
    const input = screen.getByPlaceholderText(/Album name/i);
    fireEvent.change(input, { target: { value: "Workout Playlist" } });

    const submitBtn = screen.getByRole("button", { name: /^Create$/i });
    fireEvent.click(submitBtn);

    // New album appears in list
    expect(screen.getByText("Workout Playlist")).toBeTruthy();
    expect(useMusicPlayerStore.getState().customAlbums.some((a) => a.name === "Workout Playlist")).toBe(true);
  });

  it("navigates into AlbumDetailView when clicking an album card", () => {
    render(<AlbumsView />);

    const albumTitle = screen.getByText("Wedding Songs");
    fireEvent.click(albumTitle);

    // Back button and Play All button appear
    expect(screen.getByText(/Back to Albums/i)).toBeTruthy();
    expect(screen.getByText(/Play All/i)).toBeTruthy();
    expect(screen.getByText("First Song")).toBeTruthy();
    expect(screen.getByText("Second Song")).toBeTruthy();

    // Clicking Back returns to AlbumsView
    const backBtn = screen.getByText(/Back to Albums/i);
    fireEvent.click(backBtn);

    expect(screen.getAllByText(/My Custom Albums/i).length).toBeGreaterThan(0);
  });

  it("toggles album playback on card play button click", async () => {
    render(<AlbumsView />);

    // First click plays the album
    const playBtns = screen.getAllByTitle(/Play/i);
    fireEvent.click(playBtns[0]);

    expect(useMusicPlayerStore.getState().currentTrack?.id).toBe("track_1");

    // Manually set isPlaying: true
    useMusicPlayerStore.setState({ isPlaying: true });

    // Second click pauses playback
    const pauseBtns = screen.getAllByTitle(/Pause/i);
    fireEvent.click(pauseBtns[0]);

    expect(useMusicPlayerStore.getState().isPlaying).toBe(false);
  });
});

describe("AddToAlbumModal Component", () => {
  it("toggles track membership in custom album", () => {
    render(<AddToAlbumModal track={track3} onClose={() => {}} />);

    expect(screen.getByText(/Wedding Songs/i)).toBeTruthy();

    // Track 3 is not currently in Wedding Songs
    expect(useMusicPlayerStore.getState().isTrackInAlbum("custom_wedding_1", track3)).toBe(false);

    // Click to add
    fireEvent.click(screen.getByText(/Wedding Songs/i));
    expect(useMusicPlayerStore.getState().isTrackInAlbum("custom_wedding_1", track3)).toBe(true);

    // Click to remove
    fireEvent.click(screen.getByText(/Wedding Songs/i));
    expect(useMusicPlayerStore.getState().isTrackInAlbum("custom_wedding_1", track3)).toBe(false);
  });
});
