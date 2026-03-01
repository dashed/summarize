import { describe, it, expect } from "vitest";
import {
  isGeminiThinkingModel,
  resolveEffectiveReasoning,
} from "../src/llm/generate-text.js";
import { isYouTubeUrl } from "../src/daemon/agent.js";

describe("isGeminiThinkingModel", () => {
  it("matches gemini-3-flash-preview", () => {
    expect(isGeminiThinkingModel("gemini-3-flash-preview")).toBe(true);
  });

  it("matches gemini-3-pro-preview", () => {
    expect(isGeminiThinkingModel("gemini-3-pro-preview")).toBe(true);
  });

  it("matches gemini-2.5-flash variants", () => {
    expect(isGeminiThinkingModel("gemini-2.5-flash-lite-preview-09-2025")).toBe(true);
    expect(isGeminiThinkingModel("gemini-2.5-flash-preview")).toBe(true);
  });

  it("does not match non-thinking models", () => {
    expect(isGeminiThinkingModel("gpt-5-mini")).toBe(false);
    expect(isGeminiThinkingModel("claude-sonnet-4-5")).toBe(false);
    expect(isGeminiThinkingModel("grok-4-fast-non-reasoning")).toBe(false);
    expect(isGeminiThinkingModel("gemini-2.0-flash")).toBe(false);
  });
});

describe("resolveEffectiveReasoning", () => {
  it("returns explicit reasoning level when provided", () => {
    expect(
      resolveEffectiveReasoning({
        parsed: { model: "gpt-5-mini" },
        reasoning: "low",
      }),
    ).toBe("low");
  });

  it("explicit reasoning overrides Gemini auto-detect", () => {
    expect(
      resolveEffectiveReasoning({
        parsed: { model: "gemini-3-flash-preview" },
        reasoning: "minimal",
      }),
    ).toBe("minimal");
  });

  it("auto-enables 'high' for Gemini Flash 3", () => {
    expect(
      resolveEffectiveReasoning({
        parsed: { model: "gemini-3-flash-preview" },
      }),
    ).toBe("high");
  });

  it("auto-enables 'high' for Gemini 2.5 Flash", () => {
    expect(
      resolveEffectiveReasoning({
        parsed: { model: "gemini-2.5-flash-lite-preview-09-2025" },
      }),
    ).toBe("high");
  });

  it("returns undefined for non-thinking models", () => {
    expect(
      resolveEffectiveReasoning({
        parsed: { model: "gpt-5-mini" },
      }),
    ).toBeUndefined();
  });

  it("returns undefined for Claude models", () => {
    expect(
      resolveEffectiveReasoning({
        parsed: { model: "claude-sonnet-4-5" },
      }),
    ).toBeUndefined();
  });
});

describe("reasoning + video path detection", () => {
  it("YouTube URL triggers video path for agent chat", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=abc123")).toBe(true);
  });

  it("non-YouTube URL skips video path", () => {
    expect(isYouTubeUrl("https://example.com/article")).toBe(false);
  });
});
