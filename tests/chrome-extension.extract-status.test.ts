import { describe, expect, it } from "vitest";
import { resolveChatExtractStatusLabel } from "../apps/chrome-extension/src/lib/extract-status.js";

describe("resolveChatExtractStatusLabel", () => {
  it("returns video + thumbnails label when slides are wanted", () => {
    expect(resolveChatExtractStatusLabel(true, true)).toBe("Extracting video + thumbnails…");
  });

  it("returns video transcript label for video URL without slides", () => {
    expect(resolveChatExtractStatusLabel(true, false)).toBe("Extracting video transcript…");
  });

  it("returns page content label for non-video URL", () => {
    expect(resolveChatExtractStatusLabel(false, false)).toBe("Extracting page content…");
  });

  it("returns video + thumbnails even if preferUrl is false but wantsSlides is true", () => {
    // wantsSlides implies preferUrl in practice, but the function handles this edge case
    expect(resolveChatExtractStatusLabel(false, true)).toBe("Extracting video + thumbnails…");
  });
});
