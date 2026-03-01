import { describe, expect, it } from "vitest";
import {
  clampProgress,
  estimateProgress,
  resolveStage,
} from "../../apps/chrome-extension/src/entrypoints/sidepanel/progress-stages.js";

describe("progress-stages", () => {
  describe("resolveStage", () => {
    it('maps "Fetching\u2026" to fetching stage with progress in 5-20 range', () => {
      const result = resolveStage("Fetching\u2026");
      expect(result.stage).toBe("fetching");
      expect(result.progress).toBeGreaterThanOrEqual(5);
      expect(result.progress).toBeLessThanOrEqual(20);
    });

    it('maps "transcribing\u2026 45%" to processing stage with interpolated progress in 35-55 range', () => {
      const result = resolveStage("transcribing\u2026 45%");
      expect(result.stage).toBe("processing");
      expect(result.progress).toBeGreaterThanOrEqual(35);
      expect(result.progress).toBeLessThanOrEqual(55);
    });

    it('maps "Summarizing\u2026" to summarizing stage with progress near midpoint of 55-90', () => {
      const result = resolveStage("Summarizing\u2026");
      expect(result.stage).toBe("summarizing");
      // midpoint of 55-90 is 72.5 -> rounds to 73
      expect(result.progress).toBeGreaterThanOrEqual(55);
      expect(result.progress).toBeLessThanOrEqual(90);
    });

    it('maps "slides: extracting 80%" to extracting stage with interpolated progress in 20-35 range', () => {
      const result = resolveStage("slides: extracting 80%");
      expect(result.stage).toBe("extracting");
      expect(result.progress).toBeGreaterThanOrEqual(20);
      expect(result.progress).toBeLessThanOrEqual(35);
    });

    it("defaults to connecting stage for empty string", () => {
      const result = resolveStage("");
      expect(result.stage).toBe("connecting");
      expect(result.progress).toBe(0);
    });
  });

  describe("clampProgress", () => {
    it("returns prev when prev > next (never goes backwards)", () => {
      expect(clampProgress(50, 30)).toBe(50);
    });

    it("returns next when next > prev", () => {
      expect(clampProgress(30, 50)).toBe(50);
    });
  });

  describe("estimateProgress", () => {
    it("interpolates to midpoint of summarizing range for 0.5 sub-progress", () => {
      const result = estimateProgress("summarizing", 0.5);
      // min=55, max=90, 0.5 => 55 + (90-55)*0.5 = 55+17.5 = 72.5 -> 73
      expect(result).toBe(73);
    });

    it("returns stage min for sub-progress 0", () => {
      expect(estimateProgress("fetching", 0)).toBe(5);
    });

    it("returns stage max for sub-progress 1", () => {
      expect(estimateProgress("fetching", 1)).toBe(20);
    });

    it("returns midpoint when no sub-progress is provided", () => {
      // fetching: min=5, max=20 -> midpoint 12.5 -> 13
      expect(estimateProgress("fetching")).toBe(13);
    });
  });
});
