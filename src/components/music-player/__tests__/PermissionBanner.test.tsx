// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMusicPlayerStore } from "../../../stores/useMusicPlayerStore";
import { useAppStore } from "../../../stores/useAppStore";
import { SongsView } from "../SongsView";
import * as tauriApi from "../../../utils/tauri";
import * as platformApi from "../../../utils/platform";
import type { AudioTrackInfo } from "../../../types";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock("../../../utils/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof tauriApi>();
  return {
    ...actual,
    getMusicPermissionStatus: vi.fn(async () => "granted"),
    scanAudioFiles: vi.fn(async () => []),
    requestMediaPermissions: vi.fn(),
    openAppSettings: vi.fn(),
    hasNotificationPermission: vi.fn(async () => true),
    getTrackArtworkUrl: vi.fn(async () => null),
  };
});

const mockedGetMusicPermissionStatus = vi.mocked(tauriApi.getMusicPermissionStatus);
const mockedHasNotificationPermission = vi.mocked(tauriApi.hasNotificationPermission);

vi.mock("../../../utils/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof platformApi>();
  return { ...actual, isAndroid: vi.fn(() => false) };
});
const mockedIsAndroid = vi.mocked(platformApi.isAndroid);

const mockTrack: AudioTrackInfo = {
  id: "track_banner_1",
  uri: "file:///music/song.mp3",
  path: "/music/song.mp3",
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

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  try {
    sessionStorage.clear();
  } catch {}
  mockedGetMusicPermissionStatus.mockResolvedValue("granted");
  mockedHasNotificationPermission.mockResolvedValue(true);
  mockedIsAndroid.mockReturnValue(false);
  useAppStore.setState({ lang: "en" });
});

describe("Permission warning banner", () => {
  it("stays hidden while the first scan is still running, even when status says denied", () => {
    mockedGetMusicPermissionStatus.mockResolvedValue("denied");
    useMusicPlayerStore.setState({
      tracks: [],
      loading: true,
      hasScanned: false,
      permissionStatus: "denied",
      likedPaths: new Set(),
    });
    render(<SongsView />);

    // Transient "denied" during the running scan must not flash the banner.
    expect(screen.queryByText("Audio Library Access")).toBeNull();
  });

  it("shows the banner once the scan finished empty with denied permission", () => {
    mockedGetMusicPermissionStatus.mockResolvedValue("denied");
    useMusicPlayerStore.setState({
      tracks: [],
      loading: false,
      hasScanned: true,
      permissionStatus: "denied",
      likedPaths: new Set(),
    });
    render(<SongsView />);

    expect(screen.getByText("Audio Library Access")).toBeTruthy();
  });

  it("stays hidden when permission is granted", () => {
    useMusicPlayerStore.setState({
      tracks: [],
      loading: false,
      hasScanned: true,
      permissionStatus: "granted",
      likedPaths: new Set(),
    });
    render(<SongsView />);

    expect(screen.queryByText("Audio Library Access")).toBeNull();
  });

  it("stays hidden when tracks exist despite denied status (cached library)", () => {
    useMusicPlayerStore.setState({
      tracks: [mockTrack],
      currentPlaylist: [],
      loading: false,
      hasScanned: true,
      permissionStatus: "denied",
      likedPaths: new Set(),
    });
    render(<SongsView />);

    expect(screen.queryByText("Audio Library Access")).toBeNull();
  });

  it("notification banner dismiss persists across remounts for the session", async () => {
    mockedIsAndroid.mockReturnValue(true);
    mockedHasNotificationPermission.mockResolvedValue(false);
    useMusicPlayerStore.setState({
      tracks: [mockTrack],
      currentPlaylist: [],
      loading: false,
      hasScanned: true,
      permissionStatus: "granted",
      likedPaths: new Set(),
    });
    const first = render(<SongsView />);

    expect(await screen.findByText("Background controls are off")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Background controls are off")).toBeNull();

    // Tab switches remount this view — a dismissed banner must not return.
    first.unmount();
    render(<SongsView />);
    expect(screen.queryByText("Background controls are off")).toBeNull();
  });
});
