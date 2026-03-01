import { describe, expect, it } from "vitest";
import type { ExtractedLinkContent } from "../src/content/index.js";
import { buildUrlPrompt } from "../src/run/flows/url/summary.js";

const baseExtracted: ExtractedLinkContent = {
  url: "https://example.com/video",
  title: "Video",
  description: null,
  siteName: "YouTube",
  content: "Transcript:\nhello",
  truncated: false,
  totalCharacters: 20,
  wordCount: 2,
  transcriptCharacters: 10,
  transcriptLines: 1,
  transcriptWordCount: 2,
  transcriptSource: "captionTracks",
  transcriptionProvider: null,
  transcriptMetadata: null,
  transcriptSegments: null,
  transcriptTimedText: null,
  mediaDurationSeconds: 120,
  video: null,
  isVideoOnly: false,
  diagnostics: {
    strategy: "html",
    firecrawl: { attempted: false, used: false, cacheMode: "bypass", cacheStatus: "unknown" },
    markdown: { requested: false, used: false, provider: null },
    transcript: {
      cacheMode: "bypass",
      cacheStatus: "unknown",
      textProvided: true,
      provider: "captionTracks",
      attemptedProviders: ["captionTracks"],
    },
  },
};

describe("buildUrlPrompt with transcript timestamps", () => {
  it("forces inline timestamps for YouTube when timed transcript is present", () => {
    const prompt = buildUrlPrompt({
      extracted: {
        ...baseExtracted,
        transcriptSegments: [{ startMs: 1000, endMs: 2000, text: "hello" }],
        transcriptTimedText: "[0:01] hello",
      },
      outputLanguage: { kind: "auto" },
      lengthArg: { kind: "preset", preset: "short" },
      promptOverride: null,
      lengthInstruction: null,
      languageInstruction: null,
    });

    expect(prompt).toContain("Key moments");
    expect(prompt).toContain("Weave [mm:ss]");
    expect(prompt).toContain("timestamps throughout the summary");
  });

  it("includes YouTube timestamp instruction even without timed transcript", () => {
    const prompt = buildUrlPrompt({
      extracted: { ...baseExtracted, transcriptTimedText: null, transcriptSegments: null },
      outputLanguage: { kind: "auto" },
      lengthArg: { kind: "preset", preset: "short" },
      promptOverride: null,
      lengthInstruction: null,
      languageInstruction: null,
    });

    // YouTube videos always get timestamp instructions (even without timed text)
    expect(prompt).toContain("Key moments");
    expect(prompt).toContain("Weave [mm:ss]");
  });

  it("omits timestamps for non-YouTube content without timed transcript", () => {
    const prompt = buildUrlPrompt({
      extracted: {
        ...baseExtracted,
        siteName: "Vimeo",
        transcriptTimedText: null,
        transcriptSegments: null,
      },
      outputLanguage: { kind: "auto" },
      lengthArg: { kind: "preset", preset: "short" },
      promptOverride: null,
      lengthInstruction: null,
      languageInstruction: null,
    });

    expect(prompt).not.toContain("Key moments");
    expect(prompt).not.toContain("Weave [mm:ss]");
  });
});
