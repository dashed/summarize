import { describe, expect, it } from "vitest";
import type { Prompt, PromptPart } from "../src/llm/prompt.js";
import { hasVideoUrlParts, stripVideoUrlParts } from "../src/llm/prompt.js";

/**
 * Unit tests for the video gating logic used in summary-engine.ts.
 *
 * The actual gating is an inline IIFE, but the decision is:
 *   1. If no video_url parts → pass through unchanged.
 *   2. If SUMMARIZE_SLIDES_VIDEO is "false" or "0" → strip video_url parts.
 *   3. Otherwise → keep video_url parts intact.
 *
 * We test the component functions (hasVideoUrlParts, stripVideoUrlParts)
 * and replicate the gating logic here.
 */

function applyVideoGating(prompt: Prompt, envForRun: Record<string, string | undefined>): Prompt {
  const hasVideo = hasVideoUrlParts(prompt);
  if (!hasVideo) return prompt;
  const envVideo = envForRun.SUMMARIZE_SLIDES_VIDEO?.toLowerCase();
  const videoDisabled = envVideo === "false" || envVideo === "0";
  if (videoDisabled) {
    const stripped = prompt.interleavedParts
      ? stripVideoUrlParts(prompt.interleavedParts)
      : undefined;
    return { ...prompt, interleavedParts: stripped };
  }
  return prompt;
}

const makePromptWithVideo = (urls: string[]): Prompt => {
  const parts: PromptPart[] = [
    { kind: "text", text: "Summarize this." },
    ...urls.map((url) => ({ kind: "video_url" as const, url })),
  ];
  return {
    system: "System prompt",
    userText: "Summarize this.",
    interleavedParts: parts,
  };
};

const makePromptWithoutVideo = (): Prompt => ({
  system: "System prompt",
  userText: "No video here.",
  interleavedParts: [
    { kind: "text", text: "No video here." },
    { kind: "image", bytes: new Uint8Array([1, 2]), mimeType: "image/png" },
  ],
});

describe("video gating (summary-engine logic)", () => {
  it("passes prompt unchanged when no video_url parts exist", () => {
    const prompt = makePromptWithoutVideo();
    const result = applyVideoGating(prompt, { SUMMARIZE_SLIDES_VIDEO: "true" });
    // Should be the same object reference — not cloned.
    expect(result).toBe(prompt);
  });

  it("passes prompt unchanged when no video_url parts and video is disabled", () => {
    const prompt = makePromptWithoutVideo();
    const result = applyVideoGating(prompt, { SUMMARIZE_SLIDES_VIDEO: "false" });
    expect(result).toBe(prompt);
  });

  it("strips video_url parts when SUMMARIZE_SLIDES_VIDEO=false", () => {
    const prompt = makePromptWithVideo(["https://youtube.com/watch?v=abc"]);
    const result = applyVideoGating(prompt, { SUMMARIZE_SLIDES_VIDEO: "false" });
    expect(result.interleavedParts).toBeDefined();
    const videoRemaining = result.interleavedParts!.filter((p) => p.kind === "video_url");
    expect(videoRemaining).toHaveLength(0);
    // Text part should remain.
    expect(result.interleavedParts!.filter((p) => p.kind === "text")).toHaveLength(1);
  });

  it("strips video_url parts when SUMMARIZE_SLIDES_VIDEO=0", () => {
    const prompt = makePromptWithVideo(["https://youtube.com/watch?v=abc"]);
    const result = applyVideoGating(prompt, { SUMMARIZE_SLIDES_VIDEO: "0" });
    const videoRemaining = result.interleavedParts!.filter((p) => p.kind === "video_url");
    expect(videoRemaining).toHaveLength(0);
  });

  it("strips video_url parts when SUMMARIZE_SLIDES_VIDEO=False (case-insensitive)", () => {
    const prompt = makePromptWithVideo(["https://youtube.com/watch?v=abc"]);
    const result = applyVideoGating(prompt, { SUMMARIZE_SLIDES_VIDEO: "False" });
    const videoRemaining = result.interleavedParts!.filter((p) => p.kind === "video_url");
    expect(videoRemaining).toHaveLength(0);
  });

  it("keeps video_url parts when SUMMARIZE_SLIDES_VIDEO=true", () => {
    const prompt = makePromptWithVideo(["https://youtube.com/watch?v=abc"]);
    const result = applyVideoGating(prompt, { SUMMARIZE_SLIDES_VIDEO: "true" });
    const videoRemaining = result.interleavedParts!.filter((p) => p.kind === "video_url");
    expect(videoRemaining).toHaveLength(1);
    expect(result).toBe(prompt); // Same object — not modified.
  });

  it("keeps video_url parts when SUMMARIZE_SLIDES_VIDEO=1", () => {
    const prompt = makePromptWithVideo(["https://youtube.com/watch?v=abc"]);
    const result = applyVideoGating(prompt, { SUMMARIZE_SLIDES_VIDEO: "1" });
    expect(result).toBe(prompt);
  });

  it("keeps video_url parts when SUMMARIZE_SLIDES_VIDEO is unset", () => {
    const prompt = makePromptWithVideo(["https://youtube.com/watch?v=abc"]);
    const result = applyVideoGating(prompt, {});
    expect(result).toBe(prompt);
  });

  it("keeps video_url parts when SUMMARIZE_SLIDES_VIDEO is undefined", () => {
    const prompt = makePromptWithVideo(["https://youtube.com/watch?v=abc"]);
    const result = applyVideoGating(prompt, { SUMMARIZE_SLIDES_VIDEO: undefined });
    expect(result).toBe(prompt);
  });

  it("strips multiple video_url parts when disabled", () => {
    const prompt = makePromptWithVideo([
      "https://youtube.com/watch?v=aaa",
      "https://youtube.com/watch?v=bbb",
      "https://youtube.com/watch?v=ccc",
    ]);
    const result = applyVideoGating(prompt, { SUMMARIZE_SLIDES_VIDEO: "false" });
    const videoRemaining = result.interleavedParts!.filter((p) => p.kind === "video_url");
    expect(videoRemaining).toHaveLength(0);
    // Only the text part should remain.
    expect(result.interleavedParts!).toHaveLength(1);
    expect(result.interleavedParts![0]!.kind).toBe("text");
  });
});
