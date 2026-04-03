/**
 * Tests for URL matching behavior used in the Chrome extension's cache functions.
 *
 * The extension's getCachedExtract, getPanelCache, and restoreSummaryFromHistory
 * all use urlsMatch() instead of exact string comparison to prevent cache
 * misses/deletions on fragment-only navigation (e.g. #section1 → #section2).
 */
import { describe, expect, it } from "vitest";
import { normalizeUrl, urlsMatch } from "../apps/chrome-extension/src/lib/url-match.js";

describe("normalizeUrl", () => {
  it("strips fragment from URL", () => {
    expect(normalizeUrl("https://example.com/page#section1")).toBe(
      "https://example.com/page",
    );
  });

  it("preserves URL without fragment", () => {
    expect(normalizeUrl("https://example.com/page")).toBe(
      "https://example.com/page",
    );
  });

  it("preserves query parameters while stripping fragment", () => {
    expect(normalizeUrl("https://example.com/page?q=1#top")).toBe(
      "https://example.com/page?q=1",
    );
  });

  it("returns invalid URLs unchanged", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });

  it("strips empty fragment", () => {
    expect(normalizeUrl("https://example.com/page#")).toBe(
      "https://example.com/page",
    );
  });
});

describe("urlsMatch", () => {
  it("matches identical URLs", () => {
    expect(urlsMatch("https://example.com/page", "https://example.com/page")).toBe(true);
  });

  it("matches URLs differing only by fragment", () => {
    expect(
      urlsMatch("https://example.com/page#section1", "https://example.com/page#section2"),
    ).toBe(true);
  });

  it("matches URL with fragment against URL without fragment", () => {
    expect(
      urlsMatch("https://example.com/page#section1", "https://example.com/page"),
    ).toBe(true);
  });

  it("does not match different paths", () => {
    expect(
      urlsMatch("https://example.com/page-a", "https://example.com/page-b"),
    ).toBe(false);
  });

  it("does not match different query parameters", () => {
    expect(
      urlsMatch("https://example.com/page?q=1", "https://example.com/page?q=2"),
    ).toBe(false);
  });

  it("does not match different domains", () => {
    expect(
      urlsMatch("https://a.example.com/page", "https://b.example.com/page"),
    ).toBe(false);
  });

  it("handles trailing slash boundary", () => {
    expect(
      urlsMatch("https://example.com/page", "https://example.com/page/"),
    ).toBe(true);
  });

  it("handles query boundary", () => {
    expect(
      urlsMatch("https://example.com/page", "https://example.com/page?ref=1"),
    ).toBe(true);
  });

  it("does not treat path prefix as match (article vs article-part-2)", () => {
    expect(
      urlsMatch("https://example.com/article", "https://example.com/article-part-2"),
    ).toBe(false);
  });
});

describe("cache key pattern with urlsMatch", () => {
  /**
   * The extension uses cache keys like `${tabId}:${url}`.
   * Fragment changes produce different raw keys, but urlsMatch treats
   * the underlying URLs as equivalent.
   */
  it("different fragments produce different raw cache keys", () => {
    const tabId = 42;
    const key1 = `${tabId}:https://example.com/page#section1`;
    const key2 = `${tabId}:https://example.com/page#section2`;
    expect(key1).not.toBe(key2);
  });

  it("urlsMatch treats fragment-only differences as same URL", () => {
    const url1 = "https://example.com/page#section1";
    const url2 = "https://example.com/page#section2";
    expect(urlsMatch(url1, url2)).toBe(true);
  });

  it("urlsMatch correctly rejects genuinely different URLs", () => {
    const url1 = "https://example.com/page-a";
    const url2 = "https://example.com/page-b";
    expect(urlsMatch(url1, url2)).toBe(false);
  });

  it("simulates getCachedExtract: fragment change should NOT invalidate cache", () => {
    // Before fix: getCachedExtract used `currentUrl !== cachedUrl` which
    // would delete cache when navigating from #s1 to #s2 on the same page.
    // After fix: it uses urlsMatch() so fragment changes are ignored.
    const cachedUrl = "https://example.com/long-article#introduction";
    const currentUrl = "https://example.com/long-article#chapter-2";

    // Old behavior: exact match fails → cache deleted (BAD)
    expect(cachedUrl !== currentUrl).toBe(true);

    // New behavior: urlsMatch returns true → cache preserved (GOOD)
    expect(urlsMatch(cachedUrl, currentUrl)).toBe(true);
  });

  it("simulates getPanelCache: fragment change should NOT cause cache miss", () => {
    // Before fix: getPanelCache used exact !== → returned stale/empty on fragment nav.
    // After fix: uses urlsMatch() → recognizes same page.
    const panelUrl = "https://docs.example.com/api-reference#authentication";
    const navigatedUrl = "https://docs.example.com/api-reference#rate-limits";

    expect(panelUrl !== navigatedUrl).toBe(true);
    expect(urlsMatch(panelUrl, navigatedUrl)).toBe(true);
  });

  it("simulates restoreSummaryFromHistory: fragment change should NOT trigger re-summarize", () => {
    // Before fix: staleness guard used exact !== → re-triggered summary on fragment nav.
    // After fix: uses urlsMatch() → recognizes same page.
    const historyUrl = "https://en.wikipedia.org/wiki/TypeScript#History";
    const currentUrl = "https://en.wikipedia.org/wiki/TypeScript#Features";

    expect(historyUrl !== currentUrl).toBe(true);
    expect(urlsMatch(historyUrl, currentUrl)).toBe(true);
  });

  it("genuinely different pages should still invalidate cache", () => {
    // Ensure the fix doesn't over-match: different pages must still be distinct
    const url1 = "https://example.com/post/123";
    const url2 = "https://example.com/post/456";

    expect(urlsMatch(url1, url2)).toBe(false);
  });
});
