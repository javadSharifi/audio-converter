// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import App from "../App";
import { useAppStore } from "../stores/useAppStore";
import { useMusicPlayerStore } from "../stores/useMusicPlayerStore";
import { ANDROID_BACK_EVENT } from "../utils/androidBack";
import * as tauriApi from "../utils/tauri";
import * as platformApi from "../utils/platform";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn(() => ({
    onDragDropEvent: vi.fn(async () => () => {}),
  })),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "1.3.2"),
}));

vi.mock("../utils/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof tauriApi>();
  return {
    ...actual,
    hasMediaPermissions: vi.fn(async () => true),
    requestMediaPermissions: vi.fn(),
    openAppSettings: vi.fn(),
    exitApp: vi.fn(async () => {}),
    getPendingOpenFiles: vi.fn(async () => []),
    getMusicPermissionStatus: vi.fn(async () => "granted"),
    scanAudioFiles: vi.fn(async () => []),
    hasNotificationPermission: vi.fn(async () => true),
    getTrackArtworkUrl: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({
      language: "en",
      theme: "dark",
      defaultFormat: "mp3",
      defaultQuality: "standard",
      defaultOutputMode: "same_as_source",
      defaultOutputDir: null,
      autoOpenOutputFolder: false,
      concurrency: 2,
      removeSilenceDefault: false,
      silenceThresholdDb: -40,
      silenceMinDurationSecs: null,
      ffmpegPathOverride: null,
    })),
  };
});

const mockedExitApp = vi.mocked(tauriApi.exitApp);

vi.mock("../utils/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof platformApi>();
  return { ...actual, isAndroid: vi.fn(() => true) };
});

function pressBack() {
  window.dispatchEvent(new CustomEvent(ANDROID_BACK_EVENT));
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  try {
    sessionStorage.clear();
  } catch {}
  useAppStore.setState({
    lang: "en",
    activeTool: "player",
    files: [],
    toasts: [],
  });
  useMusicPlayerStore.setState({
    tracks: [],
    currentTrack: null,
    isPlaying: false,
    fullscreenOpen: false,
    isSelectionMode: false,
    selectedTrackKeys: new Set(),
    likedPaths: new Set(),
  });
});

describe("Android back button on top-level destinations", () => {
  it("stays on the music player on first back (never navigates to converter)", () => {
    render(<App />);

    pressBack();

    expect(useAppStore.getState().activeTool).toBe("player");
    expect(
      useAppStore.getState().toasts.some((t) => t.text === "pressBackAgainToExit")
    ).toBe(true);
  });

  it("exits the app on the second back within the timeout", () => {
    render(<App />);

    pressBack();
    pressBack();

    expect(mockedExitApp).toHaveBeenCalled();
    expect(useAppStore.getState().activeTool).toBe("player");
  });

  it("closes fullscreen first instead of exiting", () => {
    useMusicPlayerStore.setState({
      fullscreenOpen: true,
      currentTrack: {
        id: "t1",
        uri: "file:///music/a.mp3",
        path: "/music/a.mp3",
        name: "a.mp3",
        title: "A",
        artist: null,
        album: null,
        durationSecs: 120,
        sizeBytes: 1000,
        createdTimestampMs: 1,
        modifiedTimestampMs: 1,
        format: "mp3",
        mimeType: "audio/mpeg",
        coverUrl: null,
      },
    });
    render(<App />);

    pressBack();

    expect(useMusicPlayerStore.getState().fullscreenOpen).toBe(false);
    expect(mockedExitApp).not.toHaveBeenCalled();
    expect(useAppStore.getState().activeTool).toBe("player");
  });
});
