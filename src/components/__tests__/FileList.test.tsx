// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FileList } from "../FileList";
import { useAppStore } from "../../stores/useAppStore";
import type { InputFile } from "../../types";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

function meta(path: string, over: Partial<InputFile> = {}): InputFile {
  return {
    path,
    name: path.split("/").pop() ?? path,
    sizeBytes: 1024,
    durationSecs: 6,
    formatName: "mov,mp4",
    hasAudio: true,
    error: null,
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  useAppStore.setState({ files: [], jobs: new Map(), toasts: [], lang: "en" });
});

describe("FileList", () => {
  it("renders rows for files in store", () => {
    useAppStore.setState({
      files: [meta("/a/one.mp4"), meta("/b/two.mkv")],
    });
    render(<FileList />);
    expect(screen.getByTestId("file-list")).toBeTruthy();
    expect(screen.getAllByText("one.mp4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("two.mkv").length).toBeGreaterThan(0);
    expect(screen.getAllByText("File (2)").length).toBeGreaterThan(0);
  });

  it("renders nothing when store empty", () => {
    render(<FileList />);
    expect(screen.queryByTestId("file-list")).toBeNull();
  });

  it("remove button drops the row", () => {
    useAppStore.setState({ files: [meta("/a/one.mp4")] });
    render(<FileList />);
    fireEvent.click(screen.getAllByLabelText("Remove")[0]);
    expect(useAppStore.getState().files.length).toBe(0);
  });
});
