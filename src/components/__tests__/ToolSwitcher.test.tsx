// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { ToolSwitcher } from "../ToolSwitcher";
import { HeaderBar } from "../HeaderBar";
import { useAppStore } from "../../stores/useAppStore";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "1.2.14") }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

// In-memory localStorage mock for test environment
const storageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: storageMock,
  writable: true,
});

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  useAppStore.setState({
    activeTool: "converter",
    lang: "en",
  });
});

describe("ToolSwitcher", () => {
  it("renders Converter as active initially and switches to Player on click", () => {
    render(<ToolSwitcher />);

    const converterTabs = screen.getAllByRole("tab", { name: /Audio Converter/i });
    expect(converterTabs.length).toBeGreaterThan(0);
    expect(converterTabs[0].getAttribute("aria-selected")).toBe("true");

    const playerTabs = screen.getAllByRole("tab", { name: /Music Player/i });
    expect(playerTabs.length).toBeGreaterThan(0);
    expect(playerTabs[0].getAttribute("aria-selected")).toBe("false");

    // Click Music Player tab
    fireEvent.click(playerTabs[0]);

    expect(useAppStore.getState().activeTool).toBe("player");
    expect(window.localStorage.getItem("active-tool")).toBe("player");
  });

  it("persists active-tool to localStorage and supports switching back", () => {
    render(<ToolSwitcher />);

    const playerTabs = screen.getAllByRole("tab", { name: /Music Player/i });
    fireEvent.click(playerTabs[0]);
    expect(useAppStore.getState().activeTool).toBe("player");
    expect(window.localStorage.getItem("active-tool")).toBe("player");

    const converterTabs = screen.getAllByRole("tab", { name: /Audio Converter/i });
    fireEvent.click(converterTabs[0]);
    expect(useAppStore.getState().activeTool).toBe("converter");
    expect(window.localStorage.getItem("active-tool")).toBe("converter");
  });

  it("shows first-time converter onboarding guide and dismisses on button click", async () => {
    vi.useFakeTimers();
    render(<ToolSwitcher />);

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(screen.getByText(/Audio Converter is here!/i)).toBeDefined();

    const gotItBtn = screen.getByRole("button", { name: /Got it/i });
    act(() => {
      fireEvent.click(gotItBtn);
    });

    expect(window.localStorage.getItem("has-seen-converter-guide")).toBe("true");
    expect(screen.queryByText(/Audio Converter is here!/i)).toBeNull();
    vi.useRealTimers();
  });
});

describe("HeaderBar Dynamic Title", () => {
  it("shows Audio Converter title when activeTool is converter", () => {
    useAppStore.setState({ activeTool: "converter", lang: "en" });
    render(<HeaderBar />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Audio Converter");
  });

  it("dynamically shows Music Player title when activeTool is player", () => {
    useAppStore.setState({ activeTool: "player", lang: "en" });
    render(<HeaderBar />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Music Player");
  });

  it("translates title correctly for Persian (fa)", () => {
    useAppStore.setState({ activeTool: "player", lang: "fa" });
    render(<HeaderBar />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("موزیک‌پلیر");
  });
});
