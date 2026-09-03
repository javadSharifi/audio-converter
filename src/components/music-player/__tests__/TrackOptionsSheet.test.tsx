// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMusicPlayerStore } from "../../../stores/useMusicPlayerStore";
import { useAppStore } from "../../../stores/useAppStore";
import { TrackRow } from "../TrackRow";
import type { AudioTrackInfo } from "../../../types";

const mockTrack: AudioTrackInfo = {
  id: "track_test_1",
  uri: "file:///music/summer.mp3",
  path: "/music/summer.mp3",
  name: "summer.mp3",
  title: "Summer Breeze",
  artist: "Chill Artist",
  album: "Chill Vibes",
  durationSecs: 215,
  sizeBytes: 8500000,
  createdTimestampMs: 1700000000000,
  modifiedTimestampMs: 1700000000000,
  format: "mp3",
  mimeType: "audio/mpeg",
  coverUrl: null,
};

beforeEach(() => {
  cleanup();
  useAppStore.setState({ lang: "en" });
  useMusicPlayerStore.setState({
    tracks: [mockTrack],
    currentPlaylist: [mockTrack],
    currentTrack: null,
    isPlaying: false,
    likedPaths: new Set(),
  });
});

describe("TrackRow 3-Dots Options Sheet & Details Modal", () => {
  it("renders 3-dots button and opens options sheet on click", () => {
    render(<TrackRow track={mockTrack} />);

    const moreBtn = screen.getByRole("button", { name: /More options/i });
    expect(moreBtn).toBeTruthy();

    fireEvent.click(moreBtn);

    // Options are displayed
    expect(screen.getByText(/Like track/i)).toBeTruthy();
    expect(screen.getByText(/Share Song/i)).toBeTruthy();
    expect(screen.getByText(/Track Details/i)).toBeTruthy();
    expect(screen.getByText(/Set as Ringtone/i)).toBeTruthy();
    expect(screen.getByText(/Delete Song/i)).toBeTruthy();

    // Toggle Like from 3-dots sheet
    fireEvent.click(screen.getByText(/Like track/i));
    expect(useMusicPlayerStore.getState().likedPaths.has("file:///music/summer.mp3")).toBe(true);
  });

  it("opens Track Details modal and shows technical metadata", () => {
    render(<TrackRow track={mockTrack} />);

    const moreBtn = screen.getByRole("button", { name: /More options/i });
    fireEvent.click(moreBtn);

    const detailsOption = screen.getByText(/Track Details/i);
    fireEvent.click(detailsOption);

    // Metadata visible
    expect(screen.getByText(/Chill Vibes/i)).toBeTruthy();
    expect(screen.getByText(/audio\/mpeg/i)).toBeTruthy();
    expect(screen.getByText(/\/music\/summer\.mp3/i)).toBeTruthy();
  });

  it("shows confirmation dialog before deleting", () => {
    render(<TrackRow track={mockTrack} />);

    const moreBtn = screen.getByRole("button", { name: /More options/i });
    fireEvent.click(moreBtn);

    const deleteOption = screen.getByText(/Delete Song/i);
    fireEvent.click(deleteOption);

    expect(screen.getByText(/Delete this song\?/i)).toBeTruthy();
    expect(screen.getByText(/This file will be permanently removed/i)).toBeTruthy();

    // Clicking Cancel cancels
    const cancelBtn = screen.getByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    expect(screen.queryByText(/Delete this song\?/i)).toBeNull();
  });
});
