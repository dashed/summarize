import { describe, expect, it } from "vitest";
import {
  isCurrentEntry,
  resolveCurrentKey,
  shouldMarkFirstAsCurrent,
  shouldRefreshHistoryOnNavigation,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/history-utils.js";

describe("resolveCurrentKey", () => {
  it("returns loadedHistoryKey in summaries mode", () => {
    expect(resolveCurrentKey("summaries", "abc123")).toBe("abc123");
  });

  it("returns null in summaries mode when no key loaded", () => {
    expect(resolveCurrentKey("summaries", null)).toBeNull();
  });

  it("returns null in chats mode when no chat key loaded", () => {
    expect(resolveCurrentKey("chats", "abc123")).toBeNull();
  });

  it("returns null in chats mode with no keys at all", () => {
    expect(resolveCurrentKey("chats", null)).toBeNull();
  });

  it("returns loadedChatKey in chats mode", () => {
    expect(resolveCurrentKey("chats", null, "chat-key-1")).toBe("chat-key-1");
  });

  it("ignores loadedHistoryKey in chats mode when loadedChatKey is set", () => {
    expect(resolveCurrentKey("chats", "summary-key", "chat-key-1")).toBe("chat-key-1");
  });

  it("ignores loadedChatKey in summaries mode", () => {
    expect(resolveCurrentKey("summaries", "summary-key", "chat-key-1")).toBe("summary-key");
  });
});

describe("shouldMarkFirstAsCurrent", () => {
  describe("summaries mode", () => {
    it("marks first when summary displayed and no explicit history load", () => {
      expect(shouldMarkFirstAsCurrent("summaries", true, null, false)).toBe(true);
    });

    it("does not mark first when no summary displayed", () => {
      expect(shouldMarkFirstAsCurrent("summaries", false, null, false)).toBe(false);
    });

    it("does not mark first when an explicit history entry is loaded", () => {
      expect(shouldMarkFirstAsCurrent("summaries", true, "loaded-key", false)).toBe(false);
    });

    it("ignores hasChatActive in summaries mode", () => {
      expect(shouldMarkFirstAsCurrent("summaries", false, null, true)).toBe(false);
    });
  });

  describe("chats mode", () => {
    it("marks first when chat is active and no chat key loaded", () => {
      expect(shouldMarkFirstAsCurrent("chats", false, null, true)).toBe(true);
    });

    it("does not mark first when no chat active", () => {
      expect(shouldMarkFirstAsCurrent("chats", false, null, false)).toBe(false);
    });

    it("ignores hasSummaryDisplayed in chats mode", () => {
      expect(shouldMarkFirstAsCurrent("chats", true, null, false)).toBe(false);
    });

    it("ignores loadedHistoryKey in chats mode", () => {
      expect(shouldMarkFirstAsCurrent("chats", false, "some-key", true)).toBe(true);
    });

    it("does not mark first when a chat history entry is loaded", () => {
      expect(shouldMarkFirstAsCurrent("chats", false, null, true, "chat-key")).toBe(false);
    });

    it("does not mark first when chat key loaded and no active chat", () => {
      expect(shouldMarkFirstAsCurrent("chats", false, null, false, "chat-key")).toBe(false);
    });
  });
});

describe("isCurrentEntry", () => {
  it("matches by currentKey", () => {
    expect(isCurrentEntry("key-1", 2, "key-1", false)).toBe(true);
  });

  it("does not match when key differs and not first", () => {
    expect(isCurrentEntry("key-2", 1, "key-1", false)).toBe(false);
  });

  it("marks first entry when markFirstAsCurrent is true", () => {
    expect(isCurrentEntry("any-key", 0, null, true)).toBe(true);
  });

  it("does not mark non-first entries even with markFirstAsCurrent", () => {
    expect(isCurrentEntry("any-key", 1, null, true)).toBe(false);
  });

  it("prefers currentKey match over position", () => {
    expect(isCurrentEntry("key-1", 3, "key-1", true)).toBe(true);
  });

  it("returns false when no currentKey and markFirstAsCurrent is false", () => {
    expect(isCurrentEntry("key-1", 0, null, false)).toBe(false);
  });
});

describe("shouldRefreshHistoryOnNavigation", () => {
  it("refreshes when tab changed and history is open", () => {
    expect(shouldRefreshHistoryOnNavigation(true, false, true)).toBe(true);
  });

  it("refreshes when URL changed and history is open", () => {
    expect(shouldRefreshHistoryOnNavigation(false, true, true)).toBe(true);
  });

  it("refreshes when both tab and URL changed and history is open", () => {
    expect(shouldRefreshHistoryOnNavigation(true, true, true)).toBe(true);
  });

  it("does not refresh when history is closed even if tab changed", () => {
    expect(shouldRefreshHistoryOnNavigation(true, false, false)).toBe(false);
  });

  it("does not refresh when history is closed even if URL changed", () => {
    expect(shouldRefreshHistoryOnNavigation(false, true, false)).toBe(false);
  });

  it("does not refresh when nothing changed even if history is open", () => {
    expect(shouldRefreshHistoryOnNavigation(false, false, true)).toBe(false);
  });

  it("does not refresh when nothing changed and history is closed", () => {
    expect(shouldRefreshHistoryOnNavigation(false, false, false)).toBe(false);
  });
});
