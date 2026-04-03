import { describe, expect, it } from "vitest";
import { buildIdleSubtitle, formatModelBadge } from "../apps/chrome-extension/src/lib/header.js";

describe("chrome/header", () => {
  it("keeps only the input summary", () => {
    expect(buildIdleSubtitle({ inputSummary: "1.2k words · 12k chars", modelLabel: "free" })).toBe(
      "1.2k words · 12k chars",
    );
  });

  it("ignores model fallback", () => {
    expect(buildIdleSubtitle({ inputSummary: "12k chars", model: "openrouter/x" })).toBe(
      "12k chars",
    );
  });

  it("trims and skips empty summary", () => {
    expect(buildIdleSubtitle({ inputSummary: "  ", modelLabel: "  free  " })).toBe("");
    expect(buildIdleSubtitle({ inputSummary: null, modelLabel: null, model: null })).toBe("");
  });
});

describe("formatModelBadge", () => {
  it("strips provider prefix", () => {
    expect(formatModelBadge("google/gemini-3-flash-preview")).toBe("gemini-3-flash-preview");
    expect(formatModelBadge("anthropic/claude-3.5-sonnet")).toBe("claude-3.5-sonnet");
    expect(formatModelBadge("openai/gpt-4o")).toBe("gpt-4o");
  });

  it("capitalizes built-in presets", () => {
    expect(formatModelBadge("auto")).toBe("Auto");
    expect(formatModelBadge("free")).toBe("Free");
  });

  it("returns model as-is when no prefix", () => {
    expect(formatModelBadge("gpt-4o")).toBe("gpt-4o");
  });

  it("returns empty for null/undefined/empty", () => {
    expect(formatModelBadge(null)).toBe("");
    expect(formatModelBadge(undefined)).toBe("");
    expect(formatModelBadge("")).toBe("");
    expect(formatModelBadge("  ")).toBe("");
  });
});
