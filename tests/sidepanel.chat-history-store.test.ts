import { describe, expect, it } from "vitest";
import { buildChatHistoryStorageKey } from "../apps/chrome-extension/src/entrypoints/sidepanel/chat-history-store.js";

describe("chat history storage keys", () => {
  it("treats meaningful query params as distinct page identities", () => {
    const first = buildChatHistoryStorageKey(7, "https://example.com/article?id=1");
    const second = buildChatHistoryStorageKey(7, "https://example.com/article?id=10");

    expect(first).not.toBe(second);
  });

  it("ignores stripped tracking params for the same page", () => {
    const canonical = buildChatHistoryStorageKey(7, "https://example.com/article?id=1");
    const tracked = buildChatHistoryStorageKey(
      7,
      "https://example.com/article?id=1&utm_source=newsletter&utm_campaign=test",
    );

    expect(tracked).toBe(canonical);
  });

  it("collapses YouTube watch URLs to the video id", () => {
    const canonical = buildChatHistoryStorageKey(7, "https://www.youtube.com/watch?v=abc123xyz89");
    const withPlaybackState = buildChatHistoryStorageKey(
      7,
      "https://www.youtube.com/watch?v=abc123xyz89&t=42s&si=tracking",
    );

    expect(withPlaybackState).toBe(canonical);
  });
});
