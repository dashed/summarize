import { describe, expect, it } from "vitest";
import { buildExtractCacheKey, buildSummaryCacheKey, extractTaggedBlock } from "../src/cache.js";

describe("cache keys and tags", () => {
  it("extracts tagged blocks", () => {
    const prompt = "<instructions>Do the thing.</instructions>\n<content>Body</content>";
    expect(extractTaggedBlock(prompt, "instructions")).toBe("Do the thing.");
    expect(extractTaggedBlock(prompt, "content")).toBe("Body");
    expect(extractTaggedBlock("no tags here", "instructions")).toBeNull();
  });

  it("changes summary keys when inputs change", () => {
    const base = buildSummaryCacheKey({
      contentHash: "content",
      promptHash: "prompt",
      model: "openai/gpt-5.2",
      lengthKey: "chars:140",
      languageKey: "en",
    });
    const same = buildSummaryCacheKey({
      contentHash: "content",
      promptHash: "prompt",
      model: "openai/gpt-5.2",
      lengthKey: "chars:140",
      languageKey: "en",
    });
    const diffModel = buildSummaryCacheKey({
      contentHash: "content",
      promptHash: "prompt",
      model: "openai/gpt-4.1",
      lengthKey: "chars:140",
      languageKey: "en",
    });
    const diffLength = buildSummaryCacheKey({
      contentHash: "content",
      promptHash: "prompt",
      model: "openai/gpt-5.2",
      lengthKey: "chars:200",
      languageKey: "en",
    });
    const diffLang = buildSummaryCacheKey({
      contentHash: "content",
      promptHash: "prompt",
      model: "openai/gpt-5.2",
      lengthKey: "chars:140",
      languageKey: "de",
    });

    expect(same).toBe(base);
    expect(diffModel).not.toBe(base);
    expect(diffLength).not.toBe(base);
    expect(diffLang).not.toBe(base);
  });

  it("differentiates cache keys by URL to prevent cross-page collisions", () => {
    // When two different pages produce identical extracted text (e.g. Reddit SPA),
    // the URL must prevent cache key collisions.
    const baseArgs = {
      contentHash: "same-content-hash",
      promptHash: "same-prompt",
      model: "openai/gpt-5.2",
      lengthKey: "chars:140",
      languageKey: "en",
    };

    const keyA = buildSummaryCacheKey({
      ...baseArgs,
      url: "https://www.reddit.com/r/pcgaming/comments/abc123/post_a/",
    });
    const keyB = buildSummaryCacheKey({
      ...baseArgs,
      url: "https://www.reddit.com/r/pcgaming/comments/xyz789/post_b/",
    });
    const keyNoUrl = buildSummaryCacheKey(baseArgs);
    const keyNull = buildSummaryCacheKey({ ...baseArgs, url: null });

    // Different URLs must produce different keys
    expect(keyA).not.toBe(keyB);
    // No URL and null URL should produce the same key (backwards compat)
    expect(keyNoUrl).toBe(keyNull);
    // URL key must differ from no-URL key
    expect(keyA).not.toBe(keyNoUrl);
  });

  it("changes extract keys when transcript timestamp options change", () => {
    const base = buildExtractCacheKey({
      url: "https://example.com/video",
      options: { youtubeTranscript: "auto", transcriptTimestamps: false },
    });
    const withTimestamps = buildExtractCacheKey({
      url: "https://example.com/video",
      options: { youtubeTranscript: "auto", transcriptTimestamps: true },
    });

    expect(withTimestamps).not.toBe(base);
  });
});
