// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TrackCover } from "../TrackCover";
import { __clearArtworkCachesForTests } from "../../../utils/artwork";
import * as tauriApi from "../../../utils/tauri";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock("../../../utils/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof tauriApi>();
  return {
    ...actual,
    getTrackArtworkUrl: vi.fn(async () => null),
  };
});

const mockedGetTrackArtworkUrl = vi.mocked(tauriApi.getTrackArtworkUrl);

beforeEach(() => {
  cleanup();
  mockedGetTrackArtworkUrl.mockReset();
  mockedGetTrackArtworkUrl.mockResolvedValue(null);
  __clearArtworkCachesForTests();
});

describe("TrackCover", () => {
  it("renders default gradient placeholder with music icon when no cover is available", async () => {
    const { container } = render(
      <TrackCover track={{ title: "Test Song", artist: "Artist", coverUrl: null }} />
    );

    // Extraction finds nothing -> placeholder stays, no img element
    await waitFor(() => {
      expect(mockedGetTrackArtworkUrl).not.toHaveBeenCalled();
    });
    expect(screen.queryByRole("img")).toBeNull();
    // gradient background container is rendered
    expect(container.querySelector(".bg-gradient-to-br")).toBeTruthy();
  });

  it("renders img element when coverUrl is provided", () => {
    render(
      <TrackCover
        track={{
          title: "Test Song",
          artist: "Artist",
          coverUrl: "https://example.com/cover.jpg",
        }}
      />
    );

    const img = screen.getByRole("img");
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("https://example.com/cover.jpg");
  });

  it("resolves a local file coverUrl through the asset protocol", () => {
    render(
      <TrackCover
        track={{
          title: "Local Song",
          artist: "Artist",
          coverUrl: "/music/covers/cover.jpg",
        }}
      />
    );

    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("asset://localhost//music/covers/cover.jpg");
  });

  it("extracts embedded art when coverUrl is a legacy albumart content URI", async () => {
    mockedGetTrackArtworkUrl.mockResolvedValueOnce("asset://localhost/cache/art.jpg");
    render(
      <TrackCover
        track={{
          id: "android_42",
          uri: "content://media/external/audio/media/42",
          title: "Phone Song",
          artist: "Artist",
          coverUrl: "content://media/external/audio/albumart/7",
        }}
      />
    );

    // content:// artwork URIs never load in a WebView <img> — must go
    // through native extraction with the *audio* uri, not the artwork uri.
    const img = await screen.findByRole("img");
    expect(mockedGetTrackArtworkUrl).toHaveBeenCalledWith(
      "content://media/external/audio/media/42"
    );
    expect(img.getAttribute("src")).toBe("asset://localhost/cache/art.jpg");
  });

  it("extracts embedded art when the track has no coverUrl at all", async () => {
    mockedGetTrackArtworkUrl.mockResolvedValueOnce("asset://localhost/cache/art2.jpg");
    render(
      <TrackCover
        track={{
          id: "android_43",
          uri: "content://media/external/audio/media/43",
          title: "No Cover Song",
          artist: "Artist",
          coverUrl: null,
        }}
      />
    );

    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")).toBe("asset://localhost/cache/art2.jpg");
  });

  it("falls back to default placeholder on image error", () => {
    const { container } = render(
      <TrackCover
        track={{
          title: "Broken Cover",
          artist: "Artist",
          coverUrl: "https://example.com/notfound.jpg",
        }}
      />
    );

    const img = screen.getByRole("img");
    fireEvent.error(img);

    // After error, fallback placeholder is shown
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector(".bg-gradient-to-br")).toBeTruthy();
  });
});
