import { describe, expect, it } from "vitest";
import { isYouTubeUrl } from "@steipete/summarize-core/content/url";

/**
 * Unit tests for the video enablement logic used in summarizeExtractedUrl.
 *
 * The actual logic in summary.ts is:
 *   const envVideo = io.envForRun.SUMMARIZE_SLIDES_VIDEO?.toLowerCase();
 *   const videoEnabled = (envVideo === "true" || envVideo === "1") && isYouTubeUrl(url);
 *
 * We replicate and test this decision function here.
 */

function isVideoEnabled(
  envForRun: Record<string, string | undefined>,
  url: string,
): boolean {
  const envVideo = envForRun.SUMMARIZE_SLIDES_VIDEO?.toLowerCase();
  return (envVideo === "true" || envVideo === "1") && isYouTubeUrl(url);
}

describe("video enablement (summarizeExtractedUrl logic)", () => {
  describe("isYouTubeUrl detection", () => {
    it("detects standard youtube.com URLs", () => {
      expect(isYouTubeUrl("https://www.youtube.com/watch?v=abc123")).toBe(true);
    });

    it("detects youtu.be short URLs", () => {
      expect(isYouTubeUrl("https://youtu.be/abc123")).toBe(true);
    });

    it("detects youtube.com without www", () => {
      expect(isYouTubeUrl("https://youtube.com/watch?v=abc123")).toBe(true);
    });

    it("rejects non-YouTube URLs", () => {
      expect(isYouTubeUrl("https://www.example.com/video")).toBe(false);
    });

    it("rejects vimeo URLs", () => {
      expect(isYouTubeUrl("https://vimeo.com/123456")).toBe(false);
    });
  });

  describe("videoEnabled flag", () => {
    it("returns true when env=true and URL is YouTube", () => {
      expect(
        isVideoEnabled({ SUMMARIZE_SLIDES_VIDEO: "true" }, "https://www.youtube.com/watch?v=abc"),
      ).toBe(true);
    });

    it("returns true when env=1 and URL is YouTube", () => {
      expect(
        isVideoEnabled({ SUMMARIZE_SLIDES_VIDEO: "1" }, "https://www.youtube.com/watch?v=abc"),
      ).toBe(true);
    });

    it("returns true when env=True (case-insensitive) and URL is YouTube", () => {
      expect(
        isVideoEnabled({ SUMMARIZE_SLIDES_VIDEO: "True" }, "https://www.youtube.com/watch?v=abc"),
      ).toBe(true);
    });

    it("returns false when env=true but URL is NOT YouTube", () => {
      expect(
        isVideoEnabled({ SUMMARIZE_SLIDES_VIDEO: "true" }, "https://www.example.com/page"),
      ).toBe(false);
    });

    it("returns false when env=false even for YouTube URL", () => {
      expect(
        isVideoEnabled({ SUMMARIZE_SLIDES_VIDEO: "false" }, "https://www.youtube.com/watch?v=abc"),
      ).toBe(false);
    });

    it("returns false when env=0 even for YouTube URL", () => {
      expect(
        isVideoEnabled({ SUMMARIZE_SLIDES_VIDEO: "0" }, "https://www.youtube.com/watch?v=abc"),
      ).toBe(false);
    });

    it("returns false when SUMMARIZE_SLIDES_VIDEO is unset", () => {
      expect(isVideoEnabled({}, "https://www.youtube.com/watch?v=abc")).toBe(false);
    });

    it("returns false when SUMMARIZE_SLIDES_VIDEO is undefined", () => {
      expect(
        isVideoEnabled(
          { SUMMARIZE_SLIDES_VIDEO: undefined },
          "https://www.youtube.com/watch?v=abc",
        ),
      ).toBe(false);
    });

    it("returns false when SUMMARIZE_SLIDES_VIDEO is empty string", () => {
      expect(
        isVideoEnabled({ SUMMARIZE_SLIDES_VIDEO: "" }, "https://www.youtube.com/watch?v=abc"),
      ).toBe(false);
    });

    it("returns false for non-YouTube URL even with env=1", () => {
      expect(
        isVideoEnabled({ SUMMARIZE_SLIDES_VIDEO: "1" }, "https://vimeo.com/123456"),
      ).toBe(false);
    });

    it("works with youtu.be short URL when env is enabled", () => {
      expect(
        isVideoEnabled({ SUMMARIZE_SLIDES_VIDEO: "true" }, "https://youtu.be/abc123"),
      ).toBe(true);
    });
  });
});
