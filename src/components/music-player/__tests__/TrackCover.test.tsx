// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TrackCover } from "../TrackCover";

beforeEach(() => {
  cleanup();
});

describe("TrackCover", () => {
  it("renders default gradient placeholder with music icon when no cover is available", () => {
    const { container } = render(
      <TrackCover track={{ title: "Test Song", artist: "Artist", coverUrl: null }} />
    );

    // img element should not be rendered
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
