import { describe, expect, it } from "vitest";
import { normalizeUrl, urlsMatch } from "../apps/chrome-extension/src/lib/url-match.js";

describe("normalizeUrl", () => {
  it("strips fragment from URL", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe(
      "https://example.com/page",
    );
  });

  it("strips fragment but preserves query params", () => {
    expect(normalizeUrl("https://example.com/page?q=1#section")).toBe(
      "https://example.com/page?q=1",
    );
  });

  it("returns input unchanged for invalid URLs", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
    expect(normalizeUrl("")).toBe("");
  });

  it("returns equivalent URL when no fragment present", () => {
    expect(normalizeUrl("https://example.com/page")).toBe("https://example.com/page");
  });

  it("handles URL with empty fragment", () => {
    // new URL("https://example.com/page#").hash === "#", setting hash="" removes it
    expect(normalizeUrl("https://example.com/page#")).toBe("https://example.com/page");
  });
});

describe("urlsMatch", () => {
  it("returns true for identical URLs", () => {
    expect(urlsMatch("https://example.com/page", "https://example.com/page")).toBe(true);
  });

  it("returns true when only fragments differ", () => {
    expect(
      urlsMatch("https://example.com/page", "https://example.com/page#section"),
    ).toBe(true);
    expect(
      urlsMatch("https://example.com/page#a", "https://example.com/page#b"),
    ).toBe(true);
  });

  it("returns false for different paths", () => {
    expect(urlsMatch("https://example.com/a", "https://example.com/b")).toBe(false);
  });

  it("returns true for trailing slash difference (boundary match)", () => {
    expect(urlsMatch("https://example.com/page", "https://example.com/page/")).toBe(
      true,
    );
  });

  it("returns true for query param boundary (page vs page?q=1)", () => {
    expect(urlsMatch("https://example.com/page", "https://example.com/page?q=1")).toBe(
      true,
    );
  });

  it("returns true for ampersand boundary (page vs page&extra)", () => {
    // This tests the "&" boundary character
    expect(
      urlsMatch("https://example.com/page?a=1", "https://example.com/page?a=1&b=2"),
    ).toBe(true);
  });

  it("returns false for different domains", () => {
    expect(urlsMatch("https://example.com/page", "https://other.com/page")).toBe(false);
  });

  it("handles empty strings", () => {
    // Both empty — normalizeUrl returns "" for invalid, so they match
    expect(urlsMatch("", "")).toBe(true);
    // One empty, one valid
    expect(urlsMatch("", "https://example.com")).toBe(false);
  });

  it("returns false when one URL is a prefix but not at a boundary", () => {
    // "page" is prefix of "page2" but next char is "2", not / ? or &
    expect(
      urlsMatch("https://example.com/page", "https://example.com/page2"),
    ).toBe(false);
  });
});

describe("real-world scenarios", () => {
  it("Reddit SPA: same path with different fragments", () => {
    const base = "https://www.reddit.com/r/programming/comments/abc123/post_title/";
    expect(urlsMatch(base, `${base}#comment-xyz`)).toBe(true);
  });

  it("URL with and without trailing slash", () => {
    expect(
      urlsMatch(
        "https://docs.example.com/guide/getting-started",
        "https://docs.example.com/guide/getting-started/",
      ),
    ).toBe(true);
  });

  it("URL with utm params vs without should NOT match via exact equality, but does via boundary", () => {
    // urlsMatch doesn't strip query params — the shorter URL is a prefix
    // and the next char is "?", so boundary match returns true
    expect(
      urlsMatch(
        "https://example.com/article",
        "https://example.com/article?utm_source=twitter",
      ),
    ).toBe(true);
  });

  it("different query params do not match when neither is a prefix of the other", () => {
    expect(
      urlsMatch(
        "https://example.com/article?utm_source=twitter",
        "https://example.com/article?utm_source=facebook",
      ),
    ).toBe(false);
  });

  it("YouTube watch URLs with different video IDs do not match", () => {
    expect(
      urlsMatch(
        "https://www.youtube.com/watch?v=abc123",
        "https://www.youtube.com/watch?v=xyz789",
      ),
    ).toBe(false);
  });

  it("YouTube watch URL with and without timestamp fragment", () => {
    expect(
      urlsMatch(
        "https://www.youtube.com/watch?v=abc123",
        "https://www.youtube.com/watch?v=abc123#t=120",
      ),
    ).toBe(true);
  });
});
