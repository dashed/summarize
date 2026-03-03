import { describe, it, expect } from "vitest";
import { buildLinkSummaryPrompt } from "../packages/core/src/prompts/link-summary.js";

const baseYouTubeParams = {
  url: "https://www.youtube.com/watch?v=abc123",
  title: "Test Video",
  siteName: "YouTube",
  description: null,
  content: "This is test transcript content with timestamps [0:00] Hello [1:00] World",
  truncated: false,
  hasTranscript: true,
  hasTranscriptTimestamps: true,
  isYouTube: true,
  summaryLength: "medium" as const,
  shares: [],
};

const baseArticleParams = {
  url: "https://example.com/article",
  title: "Test Article",
  siteName: "Example",
  description: null,
  content: "This is a test article with enough content to be meaningful.",
  truncated: false,
  hasTranscript: false,
  isYouTube: false,
  summaryLength: "medium" as const,
  shares: [],
};

// ---------------------------------------------------------------------------
// Task #5 — Unit tests for videoDetailLevel prompt changes
// ---------------------------------------------------------------------------

describe("videoDetailLevel — unit tests", () => {
  describe('"detailed" mode (default) for YouTube', () => {
    it("contains content-extraction audience language", () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "detailed",
      });
      expect(prompt).toContain("fully consume the video");
    });

    it("contains inline timestamp instructions (Weave [mm:ss])", () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "detailed",
      });
      expect(prompt).toContain("Weave [mm:ss]");
    });

    it('contains "Cover the ENTIRE video"', () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "detailed",
      });
      expect(prompt).toContain("Cover the ENTIRE video");
    });

    it("contains visual content description instruction", () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "detailed",
      });
      expect(prompt).toContain("describe all visual content");
    });

    it('contains "can be longer than the raw transcript"', () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "detailed",
      });
      expect(prompt).toContain("can be longer than the raw transcript");
    });
  });

  describe('"summary" mode for YouTube', () => {
    it("contains summary-style audience language", () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "summary",
      });
      expect(prompt).toContain("summarize online videos");
      expect(prompt).toContain("what the video covers before deciding to watch it");
    });

    it('does NOT contain "fully consume" or "content extraction" audience language', () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "summary",
      });
      expect(prompt).not.toContain("fully consume");
      expect(prompt).not.toContain("detailed, readable text with timestamp navigation");
    });

    it('contains "Key moments" with 3-6 bullets', () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "summary",
      });
      expect(prompt).toContain("Key moments");
      expect(prompt).toMatch(/3-6 bullets/);
    });

    it('does NOT contain inline timestamp instruction "Weave [mm:ss]"', () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "summary",
      });
      expect(prompt).not.toContain("Weave [mm:ss]");
    });

    it('does NOT contain "Cover the ENTIRE video"', () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "summary",
      });
      expect(prompt).not.toContain("Cover the ENTIRE video");
    });

    it('does NOT contain "describe all visual content"', () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "summary",
      });
      expect(prompt).not.toContain("describe all visual content");
    });

    it("contains article-style hard limit for content length", () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "summary",
      });
      expect(prompt).toContain("Hard limit: never exceed this length");
      expect(prompt).not.toContain("can be longer than the raw transcript");
    });
  });

  describe('"summary" mode with "short" length — no contradictions', () => {
    it("contains tight summary guidance and not thorough coverage instructions", () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        summaryLength: "short",
        videoDetailLevel: "summary",
      });
      // Should NOT have detailed-mode coverage instructions
      expect(prompt).not.toContain("Cover the ENTIRE video");
      expect(prompt).not.toContain("thorough coverage");
      expect(prompt).not.toContain("can be longer than the raw transcript");
    });
  });

  describe("default (no videoDetailLevel) — same as detailed", () => {
    it("produces the same prompt as explicit detailed", () => {
      const defaultPrompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
      });
      const detailedPrompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "detailed",
      });
      expect(defaultPrompt).toBe(detailedPrompt);
    });

    it("contains detailed-mode markers when videoDetailLevel is omitted", () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
      });
      expect(prompt).toContain("fully consume the video");
      expect(prompt).toContain("Cover the ENTIRE video");
      expect(prompt).toContain("Weave [mm:ss]");
    });
  });

  describe("non-YouTube content — videoDetailLevel has no effect", () => {
    it("produces same audience line regardless of videoDetailLevel", () => {
      const summaryPrompt = buildLinkSummaryPrompt({
        ...baseArticleParams,
        videoDetailLevel: "summary",
      });
      const detailedPrompt = buildLinkSummaryPrompt({
        ...baseArticleParams,
        videoDetailLevel: "detailed",
      });
      const defaultPrompt = buildLinkSummaryPrompt({
        ...baseArticleParams,
      });

      // All three should contain the article audience line
      const articleAudience = "summarize online articles for curious readers";
      expect(summaryPrompt).toContain(articleAudience);
      expect(detailedPrompt).toContain(articleAudience);
      expect(defaultPrompt).toContain(articleAudience);
    });
  });

  describe('"summary" mode still includes "Key moments"', () => {
    it("has a Key moments section even in summary mode", () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "summary",
      });
      expect(prompt).toContain("Key moments");
    });

    it("timestamps are simplified but not removed", () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        videoDetailLevel: "summary",
      });
      // Should contain [mm:ss] reference in Key moments section
      expect(prompt).toContain("[mm:ss]");
    });
  });
});

// ---------------------------------------------------------------------------
// Task #6 — Integration / e2e tests for full prompt assembly
// ---------------------------------------------------------------------------

describe("videoDetailLevel — integration tests (full prompt assembly)", () => {
  it('full prompt with videoDetailLevel: "summary" contains summary-style instructions', () => {
    const prompt = buildLinkSummaryPrompt({
      ...baseYouTubeParams,
      videoDetailLevel: "summary",
    });

    // Structural tags present
    expect(prompt).toContain("<instructions>");
    expect(prompt).toContain("</instructions>");
    expect(prompt).toContain("<content>");
    expect(prompt).toContain("</content>");

    // Summary-style instructions
    expect(prompt).toContain("summarize online videos");
    expect(prompt).toContain("Key moments");
    expect(prompt).toContain("Hard limit: never exceed this length");
    expect(prompt).toContain("what the video covers before deciding to watch it");

    // No detailed-mode instructions
    expect(prompt).not.toContain("Cover the ENTIRE video");
    expect(prompt).not.toContain("Weave [mm:ss]");
    expect(prompt).not.toContain("describe all visual content");
    expect(prompt).not.toContain("fully consume the video");
  });

  it('full prompt with videoDetailLevel: "detailed" contains detailed-style instructions', () => {
    const prompt = buildLinkSummaryPrompt({
      ...baseYouTubeParams,
      videoDetailLevel: "detailed",
    });

    // Structural tags present
    expect(prompt).toContain("<instructions>");
    expect(prompt).toContain("</instructions>");
    expect(prompt).toContain("<content>");
    expect(prompt).toContain("</content>");

    // Detailed-mode instructions
    expect(prompt).toContain("fully consume the video");
    expect(prompt).toContain("Cover the ENTIRE video");
    expect(prompt).toContain("Weave [mm:ss]");
    expect(prompt).toContain("describe all visual content");
    expect(prompt).toContain("can be longer than the raw transcript");

    // Context preserved
    expect(prompt).toContain("Source URL: https://www.youtube.com/watch?v=abc123");
    expect(prompt).toContain("Page name: Test Video");
  });

  describe("all length presets x both modes — no instruction collisions", () => {
    const lengths = ["short", "medium", "long", "xl", "xxl"] as const;

    for (const len of lengths) {
      it(`"summary" + "${len}" does not contain detailed-mode coverage instructions`, () => {
        const prompt = buildLinkSummaryPrompt({
          ...baseYouTubeParams,
          summaryLength: len,
          videoDetailLevel: "summary",
        });

        expect(prompt).not.toContain("Cover the ENTIRE video");
        expect(prompt).not.toContain("Weave [mm:ss]");
        expect(prompt).not.toContain("describe all visual content");
        expect(prompt).not.toContain("can be longer than the raw transcript");
        expect(prompt).toContain("Key moments");
      });

      it(`"detailed" + "${len}" contains full coverage instructions`, () => {
        const prompt = buildLinkSummaryPrompt({
          ...baseYouTubeParams,
          summaryLength: len,
          videoDetailLevel: "detailed",
        });

        expect(prompt).toContain("Cover the ENTIRE video");
        expect(prompt).toContain("Weave [mm:ss]");
        expect(prompt).toContain("fully consume the video");
      });
    }
  });

  describe('chapters + "summary" mode', () => {
    const chapters = [
      { startTime: 0, endTime: 120, title: "Introduction" },
      { startTime: 120, endTime: 360, title: "Main Topic" },
      { startTime: 360, endTime: 600, title: "Conclusion" },
    ];

    it("includes chapters in content but no ENTIRE video instruction", () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        chapters,
        videoDetailLevel: "summary",
      });

      // Chapters are included in the content
      expect(prompt).toContain("Video chapters:");
      expect(prompt).toContain("[0:00] Introduction");
      expect(prompt).toContain("[2:00] Main Topic");
      expect(prompt).toContain("[6:00] Conclusion");

      // Chapter usage instruction still present
      expect(prompt).toContain("chapter titles as guidance for organizing the summary");

      // But no detailed-mode coverage instruction
      expect(prompt).not.toContain("Cover the ENTIRE video");
      expect(prompt).not.toContain("Weave [mm:ss]");
    });

    it("chapters + detailed mode retains full coverage instructions", () => {
      const prompt = buildLinkSummaryPrompt({
        ...baseYouTubeParams,
        chapters,
        videoDetailLevel: "detailed",
      });

      expect(prompt).toContain("Video chapters:");
      expect(prompt).toContain("Cover the ENTIRE video");
      expect(prompt).toContain("Weave [mm:ss]");
      expect(prompt).toContain("fully consume the video");
    });
  });
});
