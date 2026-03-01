import { describe, expect, it } from "vitest";
import { buildLinkSummaryPrompt } from "../packages/core/src/prompts/index.js";

describe("buildLinkSummaryPrompt (chapters)", () => {
  const baseArgs = {
    url: "https://www.youtube.com/watch?v=test123",
    title: "Test Video",
    siteName: "YouTube",
    description: null,
    content: "Transcript:\n[0:01] Hello world",
    truncated: false,
    hasTranscript: true,
    hasTranscriptTimestamps: true,
    outputLanguage: { kind: "auto" as const },
    summaryLength: "medium" as const,
    shares: [],
  };

  it("includes chapters block when chapters are provided", () => {
    const prompt = buildLinkSummaryPrompt({
      ...baseArgs,
      chapters: [
        { startTime: 0, endTime: 120, title: "Introduction" },
        { startTime: 120, endTime: 360, title: "Main Topic" },
        { startTime: 360, endTime: 600, title: "Conclusion" },
      ],
    });

    expect(prompt).toContain("Video chapters:");
    expect(prompt).toContain("- [0:00] Introduction");
    expect(prompt).toContain("- [2:00] Main Topic");
    expect(prompt).toContain("- [6:00] Conclusion");
  });

  it("formats timestamps with hours when >= 1 hour", () => {
    const prompt = buildLinkSummaryPrompt({
      ...baseArgs,
      chapters: [
        { startTime: 3661, endTime: 7200, title: "After one hour" },
      ],
    });

    expect(prompt).toContain("- [01:01:01] After one hour");
  });

  it("includes chapter instruction when chapters present and no slides", () => {
    const prompt = buildLinkSummaryPrompt({
      ...baseArgs,
      chapters: [
        { startTime: 0, endTime: 120, title: "Intro" },
      ],
    });

    expect(prompt).toContain("chapter titles as guidance for organizing the summary");
    expect(prompt).toContain("Do not reproduce the chapter list verbatim");
  });

  it("omits chapter instruction when slides are present", () => {
    const prompt = buildLinkSummaryPrompt({
      ...baseArgs,
      chapters: [
        { startTime: 0, endTime: 120, title: "Intro" },
      ],
      slides: { count: 3, text: "[slide:1] [0:00–0:30]\nHello" },
    });

    expect(prompt).not.toContain("chapter titles as guidance for organizing the summary");
  });

  it("omits chapters block when chapters is null", () => {
    const prompt = buildLinkSummaryPrompt({
      ...baseArgs,
      chapters: null,
    });

    expect(prompt).not.toContain("Video chapters:");
  });

  it("omits chapters block when chapters is empty", () => {
    const prompt = buildLinkSummaryPrompt({
      ...baseArgs,
      chapters: [],
    });

    expect(prompt).not.toContain("Video chapters:");
  });

  it("omits chapters block when chapters is undefined", () => {
    const prompt = buildLinkSummaryPrompt({
      ...baseArgs,
    });

    expect(prompt).not.toContain("Video chapters:");
  });
});
