import { describe, expect, it, vi } from "vitest";
import type { SlideExtractionResult } from "../src/slides/types.js";
import { buildMultimodalSlidesPrompt } from "../src/run/flows/url/summary.js";

// Mock fs.readFile to avoid actual file system access.
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn().mockImplementation((filePath: string) => {
        if (typeof filePath === "string" && filePath.endsWith(".png")) {
          // Return a small fake PNG buffer.
          return Promise.resolve(Buffer.from("fake-png-data"));
        }
        return Promise.reject(new Error("ENOENT"));
      }),
    },
  };
});

const baseSlides: SlideExtractionResult = {
  sourceUrl: "https://www.youtube.com/watch?v=test123",
  sourceKind: "youtube",
  sourceId: "yt_test123",
  slidesDir: "/tmp/slides",
  sceneThreshold: 0.3,
  autoTuneThreshold: true,
  autoTune: { enabled: false, chosenThreshold: 0.3, confidence: 0, strategy: "none" },
  maxSlides: 6,
  minSlideDuration: 2,
  ocrRequested: false,
  ocrAvailable: false,
  warnings: [],
  slides: [
    { index: 1, timestamp: 10, imagePath: "/tmp/slides/slide_1.png" },
    { index: 2, timestamp: 60, imagePath: "/tmp/slides/slide_2.png" },
    { index: 3, timestamp: 180, imagePath: "/tmp/slides/slide_3.png" },
  ],
};

describe("buildMultimodalSlidesPrompt", () => {
  it("returns interleaved text+image parts for slides with images", async () => {
    const parts = await buildMultimodalSlidesPrompt({
      promptText: "Summarize this video.",
      slides: baseSlides,
      transcriptTimedText: "[0:05] hello\n[0:50] world\n[2:30] goodbye",
      preset: "medium",
    });

    expect(parts).not.toBeNull();
    expect(parts!.length).toBeGreaterThan(0);

    // First part is the prompt text.
    expect(parts![0]).toEqual({ kind: "text", text: "Summarize this video." });

    // Each slide should produce a text part followed by an image part.
    const textParts = parts!.filter((p) => p.kind === "text");
    const imageParts = parts!.filter((p) => p.kind === "image");

    // 1 prompt text + 3 slide labels = 4 text parts, 3 image parts.
    expect(textParts.length).toBe(4);
    expect(imageParts.length).toBe(3);

    // Slide text parts should contain slide markers.
    expect(textParts[1]!.kind === "text" && textParts[1]!.text).toContain("[slide:1]");
    expect(textParts[2]!.kind === "text" && textParts[2]!.text).toContain("[slide:2]");
    expect(textParts[3]!.kind === "text" && textParts[3]!.text).toContain("[slide:3]");

    // Image parts should have PNG mime type.
    for (const img of imageParts) {
      expect(img.kind).toBe("image");
      if (img.kind === "image") {
        expect(img.mimeType).toBe("image/png");
        expect(img.bytes.length).toBeGreaterThan(0);
      }
    }
  });

  it("includes chapter labels at chapter boundaries", async () => {
    const slidesWithChapters: SlideExtractionResult = {
      ...baseSlides,
      chapters: [
        { startTime: 0, endTime: 120, title: "Introduction" },
        { startTime: 120, endTime: 300, title: "Main Content" },
      ],
    };

    const parts = await buildMultimodalSlidesPrompt({
      promptText: "Prompt text.",
      slides: slidesWithChapters,
      transcriptTimedText: null,
      preset: "medium",
    });

    expect(parts).not.toBeNull();
    const textContents = parts!
      .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
      .map((p) => p.text);

    // First slide should have Introduction chapter.
    const slide1Text = textContents.find((t) => t.includes("[slide:1]"));
    expect(slide1Text).toContain("[Chapter: Introduction]");

    // Second slide (at 60s) is still in Introduction.
    const slide2Text = textContents.find((t) => t.includes("[slide:2]"));
    expect(slide2Text).not.toContain("[Chapter:");

    // Third slide (at 180s) crosses into Main Content.
    const slide3Text = textContents.find((t) => t.includes("[slide:3]"));
    expect(slide3Text).toContain("[Chapter: Main Content]");
  });

  it("returns null when slides is null", async () => {
    const parts = await buildMultimodalSlidesPrompt({
      promptText: "Prompt text.",
      slides: null,
      transcriptTimedText: null,
      preset: "medium",
    });
    expect(parts).toBeNull();
  });

  it("returns null when slides array is empty", async () => {
    const parts = await buildMultimodalSlidesPrompt({
      promptText: "Prompt text.",
      slides: { ...baseSlides, slides: [] },
      transcriptTimedText: null,
      preset: "medium",
    });
    expect(parts).toBeNull();
  });

  it("returns null when no slides have image paths", async () => {
    const parts = await buildMultimodalSlidesPrompt({
      promptText: "Prompt text.",
      slides: {
        ...baseSlides,
        slides: [{ index: 1, timestamp: 10, imagePath: "" }],
      },
      transcriptTimedText: null,
      preset: "medium",
    });
    expect(parts).toBeNull();
  });

  it("works without chapters", async () => {
    const slidesNoChapters: SlideExtractionResult = {
      ...baseSlides,
      chapters: null,
    };

    const parts = await buildMultimodalSlidesPrompt({
      promptText: "Prompt text.",
      slides: slidesNoChapters,
      transcriptTimedText: null,
      preset: "medium",
    });

    expect(parts).not.toBeNull();
    const textContents = parts!
      .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
      .map((p) => p.text);

    // No chapter labels.
    for (const text of textContents) {
      expect(text).not.toContain("[Chapter:");
    }
  });
});
