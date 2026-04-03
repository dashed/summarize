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
  ],
};

describe("buildMultimodalSlidesPrompt with sourceUrl (video_url)", () => {
  it("includes a video_url part when sourceUrl is provided", async () => {
    const parts = await buildMultimodalSlidesPrompt({
      promptText: "Summarize this video.",
      slides: baseSlides,
      transcriptTimedText: null,
      preset: "medium",
      sourceUrl: "https://www.youtube.com/watch?v=test123",
    });

    expect(parts).not.toBeNull();

    const videoUrlParts = parts!.filter((p) => p.kind === "video_url");
    expect(videoUrlParts).toHaveLength(1);
    expect(videoUrlParts[0]!.kind === "video_url" && videoUrlParts[0]!.url).toBe(
      "https://www.youtube.com/watch?v=test123",
    );
  });

  it("places video_url right after the text prompt", async () => {
    const parts = await buildMultimodalSlidesPrompt({
      promptText: "Summarize this.",
      slides: baseSlides,
      transcriptTimedText: null,
      preset: "medium",
      sourceUrl: "https://www.youtube.com/watch?v=test123",
    });

    expect(parts).not.toBeNull();
    expect(parts![0]).toEqual({ kind: "text", text: "Summarize this." });
    expect(parts![1]!.kind).toBe("video_url");
    // Remaining parts should be slide text+image interleaving
    expect(parts![2]!.kind).toBe("text"); // slide label
    expect(parts![3]!.kind).toBe("image"); // slide image
  });

  it("does not include video_url when sourceUrl is undefined", async () => {
    const parts = await buildMultimodalSlidesPrompt({
      promptText: "Summarize.",
      slides: baseSlides,
      transcriptTimedText: null,
      preset: "medium",
    });

    expect(parts).not.toBeNull();
    const videoUrlParts = parts!.filter((p) => p.kind === "video_url");
    expect(videoUrlParts).toHaveLength(0);
  });

  it("does not include video_url when sourceUrl is empty string", async () => {
    const parts = await buildMultimodalSlidesPrompt({
      promptText: "Summarize.",
      slides: baseSlides,
      transcriptTimedText: null,
      preset: "medium",
      sourceUrl: "",
    });

    expect(parts).not.toBeNull();
    const videoUrlParts = parts!.filter((p) => p.kind === "video_url");
    expect(videoUrlParts).toHaveLength(0);
  });

  it("still includes slide images alongside video_url", async () => {
    const parts = await buildMultimodalSlidesPrompt({
      promptText: "Summarize.",
      slides: baseSlides,
      transcriptTimedText: null,
      preset: "medium",
      sourceUrl: "https://www.youtube.com/watch?v=test123",
    });

    expect(parts).not.toBeNull();
    const imageParts = parts!.filter((p) => p.kind === "image");
    expect(imageParts).toHaveLength(2); // one per slide
  });

  it("returns null when no slides (regardless of sourceUrl)", async () => {
    const result = await buildMultimodalSlidesPrompt({
      promptText: "Summarize.",
      slides: null,
      transcriptTimedText: null,
      preset: "medium",
      sourceUrl: "https://www.youtube.com/watch?v=test123",
    });
    expect(result).toBeNull();
  });
});
