// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearArtworkCachesForTests,
  artworkCacheKey,
  getSyncArtworkSrc,
  isUnresolvedCoverUrl,
  resolveArtworkSrc,
} from "../artwork";
import * as tauriApi from "../tauri";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof tauriApi>();
  return {
    ...actual,
    getTrackArtworkUrl: vi.fn(async () => null),
  };
});

const mockedGetTrackArtworkUrl = vi.mocked(tauriApi.getTrackArtworkUrl);

beforeEach(() => {
  mockedGetTrackArtworkUrl.mockReset();
  mockedGetTrackArtworkUrl.mockResolvedValue(null);
  __clearArtworkCachesForTests();
});

describe("artwork utils", () => {
  it("builds a stable cache key preferring uri over path over id", () => {
    expect(artworkCacheKey({ uri: "u", path: "p", id: "i" })).toBe("u");
    expect(artworkCacheKey({ path: "p", id: "i" })).toBe("p");
    expect(artworkCacheKey({ id: "i" })).toBe("i");
    expect(artworkCacheKey({})).toBe("");
  });

  it("treats legacy albumart content URIs as unresolved", () => {
    expect(isUnresolvedCoverUrl(null)).toBe(true);
    expect(isUnresolvedCoverUrl(undefined)).toBe(true);
    expect(isUnresolvedCoverUrl("content://media/external/audio/albumart/7")).toBe(true);
    expect(isUnresolvedCoverUrl("https://example.com/a.jpg")).toBe(false);
    expect(isUnresolvedCoverUrl("/music/cover.jpg")).toBe(false);
  });

  it("returns http covers as-is and local paths via asset protocol", () => {
    expect(getSyncArtworkSrc({ coverUrl: "https://example.com/a.jpg" })).toBe(
      "https://example.com/a.jpg"
    );
    expect(getSyncArtworkSrc({ coverUrl: "/music/cover.jpg" })).toBe(
      "asset://localhost//music/cover.jpg"
    );
    expect(
      getSyncArtworkSrc({ coverUrl: "content://media/external/audio/albumart/7" })
    ).toBeNull();
    expect(getSyncArtworkSrc({ coverUrl: null })).toBeNull();
  });

  it("resolveArtworkSrc prefers a directly loadable coverUrl without IPC", async () => {
    const src = await resolveArtworkSrc({
      uri: "content://media/external/audio/media/1",
      coverUrl: "https://example.com/a.jpg",
    });
    expect(src).toBe("https://example.com/a.jpg");
    expect(mockedGetTrackArtworkUrl).not.toHaveBeenCalled();
  });

  it("resolveArtworkSrc extracts embedded art with the audio uri", async () => {
    mockedGetTrackArtworkUrl.mockResolvedValueOnce("asset://localhost/cache/x.jpg");
    const src = await resolveArtworkSrc({
      uri: "content://media/external/audio/media/9",
      coverUrl: "content://media/external/audio/albumart/3",
    });
    expect(mockedGetTrackArtworkUrl).toHaveBeenCalledWith(
      "content://media/external/audio/media/9"
    );
    expect(src).toBe("asset://localhost/cache/x.jpg");
  });

  it("resolveArtworkSrc caches extraction results in memory", async () => {
    mockedGetTrackArtworkUrl.mockResolvedValue("asset://localhost/cache/y.jpg");
    const track = { uri: "content://media/external/audio/media/10", coverUrl: null };
    await resolveArtworkSrc(track);
    await resolveArtworkSrc(track);
    expect(mockedGetTrackArtworkUrl).toHaveBeenCalledTimes(1);
  });

  it("resolveArtworkSrc returns null when nothing is found", async () => {
    const src = await resolveArtworkSrc({
      uri: "content://media/external/audio/media/11",
      coverUrl: null,
    });
    expect(src).toBeNull();
  });

  it("does not serve a stale cover after the track coverUrl changes", async () => {
    mockedGetTrackArtworkUrl.mockResolvedValue("asset://localhost/cache/old.jpg");
    const first = await resolveArtworkSrc({
      uri: "content://media/external/audio/media/12",
      coverUrl: null,
    });
    expect(first).toBe("asset://localhost/cache/old.jpg");

    // Same uri, new direct cover: the fresh coverUrl must win, not the cache.
    const second = await resolveArtworkSrc({
      uri: "content://media/external/audio/media/12",
      coverUrl: "https://example.com/new.jpg",
    });
    expect(second).toBe("https://example.com/new.jpg");
    expect(mockedGetTrackArtworkUrl).toHaveBeenCalledTimes(1);
  });

  it("evictArtworkCache drops entries so deleted tracks leave no stale art", async () => {
    const { evictArtworkCache } = await import("../artwork");
    mockedGetTrackArtworkUrl.mockResolvedValue("asset://localhost/cache/gone.jpg");
    await resolveArtworkSrc({
      uri: "content://media/external/audio/media/13",
      coverUrl: null,
    });
    expect(mockedGetTrackArtworkUrl).toHaveBeenCalledTimes(1);

    evictArtworkCache(["content://media/external/audio/media/13"]);

    mockedGetTrackArtworkUrl.mockResolvedValue("asset://localhost/cache/fresh.jpg");
    const src = await resolveArtworkSrc({
      uri: "content://media/external/audio/media/13",
      coverUrl: null,
    });
    expect(src).toBe("asset://localhost/cache/fresh.jpg");
    expect(mockedGetTrackArtworkUrl).toHaveBeenCalledTimes(2);
  });
});
