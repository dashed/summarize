import { describe, expect, it } from "vitest";
import { applyGeminiDescriptions } from "../src/slides/extract.js";
import type { SlideImage } from "../src/slides/types.js";

function makeSlide(index: number, timestamp: number): SlideImage {
  return { index, timestamp, imagePath: `/slides/slide_${index}.png` };
}

describe("applyGeminiDescriptions", () => {
  it("maps descriptions to slides by closest timestamp", () => {
    const slides = [makeSlide(1, 10), makeSlide(2, 45), makeSlide(3, 120)];
    const timestamps = [
      { seconds: 10, description: "Introduction slide" },
      { seconds: 48, description: "Architecture diagram" },
      { seconds: 118, description: "Demo begins" },
    ];

    const result = applyGeminiDescriptions(slides, timestamps);

    expect(result).toHaveLength(3);
    expect(result[0]!.ocrText).toBe("Introduction slide");
    expect(result[1]!.ocrText).toBe("Architecture diagram");
    expect(result[2]!.ocrText).toBe("Demo begins");
  });

  it("sets ocrConfidence to 1.0 for all matched slides", () => {
    const slides = [makeSlide(1, 10), makeSlide(2, 60)];
    const timestamps = [
      { seconds: 10, description: "Slide 1" },
      { seconds: 60, description: "Slide 2" },
    ];

    const result = applyGeminiDescriptions(slides, timestamps);

    expect(result[0]!.ocrConfidence).toBe(1.0);
    expect(result[1]!.ocrConfidence).toBe(1.0);
  });

  it("preserves original slide fields", () => {
    const slides = [makeSlide(3, 90)];
    const timestamps = [{ seconds: 90, description: "Code walkthrough" }];

    const result = applyGeminiDescriptions(slides, timestamps);

    expect(result[0]!.index).toBe(3);
    expect(result[0]!.timestamp).toBe(90);
    expect(result[0]!.imagePath).toBe("/slides/slide_3.png");
  });

  it("picks the closest timestamp when multiple are present", () => {
    const slides = [makeSlide(1, 32)];
    const timestamps = [
      { seconds: 10, description: "Far away" },
      { seconds: 30, description: "Closest" },
      { seconds: 60, description: "Also far" },
    ];

    const result = applyGeminiDescriptions(slides, timestamps);

    expect(result[0]!.ocrText).toBe("Closest");
  });

  it("handles empty timestamps array", () => {
    const slides = [makeSlide(1, 10), makeSlide(2, 60)];

    const result = applyGeminiDescriptions(slides, []);

    expect(result).toHaveLength(2);
    expect(result[0]!.ocrText).toBe("");
    expect(result[0]!.ocrConfidence).toBe(0);
    expect(result[1]!.ocrText).toBe("");
    expect(result[1]!.ocrConfidence).toBe(0);
  });

  it("handles empty slides array", () => {
    const timestamps = [{ seconds: 10, description: "Should not matter" }];

    const result = applyGeminiDescriptions([], timestamps);

    expect(result).toHaveLength(0);
  });

  it("handles single timestamp for multiple slides", () => {
    const slides = [makeSlide(1, 10), makeSlide(2, 60), makeSlide(3, 120)];
    const timestamps = [{ seconds: 50, description: "Only description" }];

    const result = applyGeminiDescriptions(slides, timestamps);

    expect(result).toHaveLength(3);
    // All slides map to the single available timestamp
    expect(result[0]!.ocrText).toBe("Only description");
    expect(result[1]!.ocrText).toBe("Only description");
    expect(result[2]!.ocrText).toBe("Only description");
  });

  it("does not mutate original slides", () => {
    const slides = [makeSlide(1, 10)];
    const timestamps = [{ seconds: 10, description: "New text" }];

    applyGeminiDescriptions(slides, timestamps);

    expect(slides[0]!.ocrText).toBeUndefined();
    expect(slides[0]!.ocrConfidence).toBeUndefined();
  });
});
