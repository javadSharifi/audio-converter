// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PresetSelector } from "../PresetSelector";

describe("PresetSelector", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders streamlined booster presets", () => {
    render(<PresetSelector activePreset="smart" onSelectPreset={() => {}} />);

    expect(screen.getByText("Smart Boost")).toBeDefined();
    expect(screen.getByText("Music")).toBeDefined();
    expect(screen.getByText("Extreme")).toBeDefined();
    expect(screen.getByText("Manual")).toBeDefined();
  });

  it("calls onSelectPreset when a preset is clicked", () => {
    const handleSelect = vi.fn();
    render(<PresetSelector activePreset="smart" onSelectPreset={handleSelect} />);

    const extremeButton = screen.getByText("Extreme");
    fireEvent.click(extremeButton);

    expect(handleSelect).toHaveBeenCalledWith("extreme");
  });
});
