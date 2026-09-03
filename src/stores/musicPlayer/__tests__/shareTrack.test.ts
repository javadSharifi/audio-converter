// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMusicPlayerStore } from "../../useMusicPlayerStore";
import * as tauriApi from "../../../utils/tauri";
import * as platformApi from "../../../utils/platform";
import type { AudioTrackInfo } from "../../../types";

vi.mock("../../../utils/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof tauriApi>();
  return {
    ...actual,
    shareAudioTrack: vi.fn(async () => {}),
  };
});

vi.mock("../../../utils/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof platformApi>();
  return { ...actual, isAndroid: vi.fn(() => false) };
});

const mockedShareAudioTrack = vi.mocked(tauriApi.shareAudioTrack);
const mockedIsAndroid = vi.mocked(platformApi.isAndroid);

const mockTrack: AudioTrackInfo = {
  id: "android_7",
  uri: "content://media/external/audio/media/7",
  path: null,
  name: "song.mp3",
  title: "Song",
  artist: "Artist",
  album: null,
  durationSecs: 180,
  sizeBytes: 5000000,
  createdTimestampMs: 1000,
  modifiedTimestampMs: 1000,
  format: "mp3",
  mimeType: "audio/mpeg",
  coverUrl: null,
};

function stubNavigatorShare(impl?: (...args: never[]) => Promise<void>) {
  try {
    Object.defineProperty(window.navigator, "share", {
      value: impl ?? vi.fn(async () => {}),
      configurable: true,
      writable: true,
    });
  } catch {}
}

function unstubNavigatorShare() {
  try {
    delete (window.navigator as unknown as Record<string, unknown>)["share"];
  } catch {}
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsAndroid.mockReturnValue(false);
  unstubNavigatorShare();
});

afterEach(() => {
  unstubNavigatorShare();
});

describe("shareTrack routing", () => {
  it("on Android always uses the native FileProvider share, even when navigator.share exists", async () => {
    mockedIsAndroid.mockReturnValue(true);
    const webShare = vi.fn(async () => {});
    stubNavigatorShare(webShare);

    await useMusicPlayerStore.getState().shareTrack(mockTrack);

    expect(webShare).not.toHaveBeenCalled();
    expect(mockedShareAudioTrack).toHaveBeenCalledWith(
      "content://media/external/audio/media/7",
      "Song",
      "audio/mpeg"
    );
  });

  it("on desktop keeps the web share sheet when available", async () => {
    mockedIsAndroid.mockReturnValue(false);
    const webShare = vi.fn(async () => {});
    stubNavigatorShare(webShare);

    await useMusicPlayerStore.getState().shareTrack(mockTrack);

    expect(webShare).toHaveBeenCalledWith({
      title: "Song",
      text: "Song - Artist",
    });
    expect(mockedShareAudioTrack).not.toHaveBeenCalled();
  });

  it("on desktop falls back to native when the web share is dismissed", async () => {
    mockedIsAndroid.mockReturnValue(false);
    stubNavigatorShare(vi.fn(async () => {
      throw new DOMException("AbortError", "AbortError");
    }));

    await useMusicPlayerStore.getState().shareTrack(mockTrack);

    expect(mockedShareAudioTrack).toHaveBeenCalledTimes(1);
  });
});
