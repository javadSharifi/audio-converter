// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MusicPlayerNav } from "../MusicPlayerNav";
import { MusicPlayerView } from "../MusicPlayerView";
import { useAppStore } from "../../../stores/useAppStore";
import { useMusicPlayerStore } from "../../../stores/useMusicPlayerStore";

vi.mock("../../../utils/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils/tauri")>();
  return {
    ...actual,
    scanAudioFiles: vi.fn(async () => []),
  };
});

beforeEach(() => {
  cleanup();
  useAppStore.setState({
    lang: "en",
    activeTool: "player",
  });
  useMusicPlayerStore.setState({
    tracks: [],
    loading: false,
    hasScanned: true,
    likedPaths: new Set(),
    customAlbums: [],
  });
});

describe("MusicPlayerNav", () => {
  it("renders the 3 navigation tabs (Songs, Albums, Liked)", () => {
    const onSelect = vi.fn();
    render(<MusicPlayerNav activeTab="songs" onSelectTab={onSelect} />);

    expect(screen.getByRole("tab", { name: /Songs/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Albums/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Liked/i })).toBeTruthy();
  });

  it("calls onSelectTab when a tab is clicked", () => {
    const onSelect = vi.fn();
    render(<MusicPlayerNav activeTab="songs" onSelectTab={onSelect} />);

    fireEvent.click(screen.getByRole("tab", { name: /Albums/i }));
    expect(onSelect).toHaveBeenCalledWith("album");

    fireEvent.click(screen.getByRole("tab", { name: /Liked/i }));
    expect(onSelect).toHaveBeenCalledWith("like");

    fireEvent.click(screen.getByRole("tab", { name: /Songs/i }));
    expect(onSelect).toHaveBeenCalledWith("songs");
  });

  it("marks the active tab as selected with aria-selected", () => {
    const onSelect = vi.fn();
    render(<MusicPlayerNav activeTab="album" onSelectTab={onSelect} />);

    expect(screen.getByRole("tab", { name: /Albums/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /Songs/i }).getAttribute("aria-selected")).toBe("false");
  });
});

describe("MusicPlayerView", () => {
  it("switches tab content when clicking navigation items and defaults to Songs", () => {
    render(<MusicPlayerView />);

    // Default tab is Songs with search input
    expect(screen.getByPlaceholderText(/Search songs/i)).toBeTruthy();

    // Click Liked -> renders LikedView
    fireEvent.click(screen.getByRole("tab", { name: /Liked/i }));
    expect(screen.getByText(/No liked songs yet/i)).toBeTruthy();

    // Click Albums -> renders AlbumsView
    fireEvent.click(screen.getByRole("tab", { name: /Albums/i }));
    expect(screen.getAllByText(/My Custom Albums/i).length).toBeGreaterThan(0);
  });

  it("renders localized text in Persian (fa)", () => {
    useAppStore.setState({ lang: "fa" });
    render(<MusicPlayerView />);

    expect(screen.getByRole("tab", { name: /آهنگ‌ها/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /آلبوم‌ها/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /علاقه‌مندی‌ها/i })).toBeTruthy();
  });
});
