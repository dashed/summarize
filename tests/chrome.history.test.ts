import { describe, expect, it } from "vitest";
import {
  canonicalizeUrlForHistory,
  isSpecificEnoughForHistoryLookup,
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

  it("preserves semantically meaningful query params for non-YouTube URLs", () => {
    expect(canonicalizeUrlForHistory("https://example.com/article/foo?ref=twitter#section-2")).toBe(
      "https://example.com/article/foo?ref=twitter",
    );
  });

  it("keeps origin + pathname for non-YouTube", () => {
    expect(canonicalizeUrlForHistory("https://blog.example.com/posts/123")).toBe(
      "https://blog.example.com/posts/123",
    );
  });

  it("strips tracking params while keeping meaningful query params", () => {
    expect(
      canonicalizeUrlForHistory(
        "https://example.com/article?utm_source=newsletter&id=1&fbclid=abc#section-2",
      ),
    ).toBe("https://example.com/article?id=1");
  });

  it("treats sibling query URLs as different canonical history keys", () => {
    expect(canonicalizeUrlForHistory("https://example.com/article?id=1")).not.toBe(
      canonicalizeUrlForHistory("https://example.com/article?id=2"),
    );
  });

  it("returns raw string for invalid URLs", () => {
    expect(canonicalizeUrlForHistory("not-a-url")).toBe("not-a-url");
    expect(canonicalizeUrlForHistory("")).toBe("");
  });

  it("handles PDF URLs (no query/hash to strip)", () => {
    expect(
      canonicalizeUrlForHistory(
        "https://www-cs-faculty.stanford.edu/~knuth/papers/claude-cycles.pdf",
      ),
    ).toBe("https://www-cs-faculty.stanford.edu/~knuth/papers/claude-cycles.pdf");
  });

  it("strips query from PDF URLs", () => {
    expect(canonicalizeUrlForHistory("https://arxiv.org/pdf/2301.12345.pdf?download=true")).toBe(
      "https://arxiv.org/pdf/2301.12345.pdf",
    );
  });

  it("handles YouTube with only v= param (no extras to strip)", () => {
    expect(canonicalizeUrlForHistory("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });
});

describe("parseSummaryHistoryMeta", () => {
  it("extracts title and model from metadata", () => {
    expect(
      parseSummaryHistoryMeta({
        title: "My Article",
        model: "google/gemini-3-flash",
        url: "https://example.com",
      }),
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

describe("isSpecificEnoughForHistoryLookup", () => {
  it("rejects YouTube homepage", () => {
    expect(isSpecificEnoughForHistoryLookup("https://www.youtube.com/")).toBe(false);
    expect(isSpecificEnoughForHistoryLookup("https://www.youtube.com")).toBe(false);
  });

  it("rejects YouTube /watch without v= param", () => {
    expect(isSpecificEnoughForHistoryLookup("https://www.youtube.com/watch")).toBe(false);
  });

  it("accepts YouTube watch with v= param", () => {
    expect(isSpecificEnoughForHistoryLookup("https://www.youtube.com/watch?v=abc123")).toBe(true);
  });

  it("accepts YouTube shorts with video ID", () => {
    expect(isSpecificEnoughForHistoryLookup("https://www.youtube.com/shorts/abc123")).toBe(true);
  });

  it("rejects YouTube /shorts/ without ID", () => {
    expect(isSpecificEnoughForHistoryLookup("https://www.youtube.com/shorts/")).toBe(false);
  });

  it("accepts youtu.be with path", () => {
    expect(isSpecificEnoughForHistoryLookup("https://youtu.be/abc123")).toBe(true);
  });

  it("rejects bare youtu.be", () => {
    expect(isSpecificEnoughForHistoryLookup("https://youtu.be/")).toBe(false);
  });

  it("accepts non-YouTube URLs with meaningful path", () => {
    expect(isSpecificEnoughForHistoryLookup("https://example.com/article/foo")).toBe(true);
    expect(isSpecificEnoughForHistoryLookup("https://arxiv.org/pdf/2301.12345.pdf")).toBe(true);
  });

  it("accepts non-YouTube URLs with meaningful query params", () => {
    expect(isSpecificEnoughForHistoryLookup("https://example.com/?id=1")).toBe(true);
  });

  it("rejects bare domain URLs", () => {
    expect(isSpecificEnoughForHistoryLookup("https://example.com/")).toBe(false);
  });

  it("accepts non-URL strings as fallback", () => {
    expect(isSpecificEnoughForHistoryLookup("some-key")).toBe(true);
    expect(isSpecificEnoughForHistoryLookup("")).toBe(false);
  });
});
