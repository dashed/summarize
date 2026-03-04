import { describe, expect, it } from "vitest";
import {
  canonicalizeUrlForHistory,
  parseSummaryHistoryMeta,
} from "../apps/chrome-extension/src/lib/history.js";

describe("canonicalizeUrlForHistory", () => {
  it("keeps only v= param for YouTube watch URLs", () => {
    expect(
      canonicalizeUrlForHistory(
        "https://www.youtube.com/watch?v=abc123&t=120&si=xyz&feature=shared",
      ),
    ).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("strips query and hash for YouTube shorts", () => {
    expect(
      canonicalizeUrlForHistory("https://www.youtube.com/shorts/abc123?feature=share#top"),
    ).toBe("https://www.youtube.com/shorts/abc123");
  });

  it("handles youtu.be short URLs", () => {
    expect(canonicalizeUrlForHistory("https://youtu.be/abc123?si=xyz")).toBe(
      "https://youtu.be/abc123",
    );
  });

  it("strips query and hash for non-YouTube URLs", () => {
    expect(
      canonicalizeUrlForHistory("https://example.com/article/foo?ref=twitter#section-2"),
    ).toBe("https://example.com/article/foo");
  });

  it("keeps origin + pathname for non-YouTube", () => {
    expect(canonicalizeUrlForHistory("https://blog.example.com/posts/123")).toBe(
      "https://blog.example.com/posts/123",
    );
  });

  it("returns raw string for invalid URLs", () => {
    expect(canonicalizeUrlForHistory("not-a-url")).toBe("not-a-url");
    expect(canonicalizeUrlForHistory("")).toBe("");
  });
});

describe("parseSummaryHistoryMeta", () => {
  it("extracts title and model from metadata", () => {
    expect(
      parseSummaryHistoryMeta({ title: "My Article", model: "google/gemini-3-flash", url: "https://example.com" }),
    ).toEqual({ title: "My Article", model: "google/gemini-3-flash" });
  });

  it("falls back to url when title is missing", () => {
    expect(parseSummaryHistoryMeta({ url: "https://example.com" })).toEqual({
      title: "https://example.com",
      model: null,
    });
  });

  it("falls back to 'Summary' when both title and url are missing", () => {
    expect(parseSummaryHistoryMeta({})).toEqual({ title: "Summary", model: null });
  });

  it("returns null model for non-string model values", () => {
    expect(parseSummaryHistoryMeta({ title: "Test", model: 42 })).toEqual({
      title: "Test",
      model: null,
    });
    expect(parseSummaryHistoryMeta({ title: "Test", model: null })).toEqual({
      title: "Test",
      model: null,
    });
  });

  it("handles null metadata", () => {
    expect(parseSummaryHistoryMeta(null)).toEqual({ title: "Summary", model: null });
  });
});
