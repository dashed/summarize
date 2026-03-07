import { describe, expect, it } from "vitest";
import {
  detectContentTypeLabel,
  extractDomain,
  formatHistoryEntrySize,
  generatePreview,
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

describe("formatHistoryEntrySize", () => {
  describe("chats mode", () => {
    it("shows message count for a single message", () => {
      expect(formatHistoryEntrySize("chats", { messageCount: 1 }, 500)).toBe("1 message");
    });

    it("shows message count for multiple messages", () => {
      expect(formatHistoryEntrySize("chats", { messageCount: 5 }, 2000)).toBe("5 messages");
    });

    it("returns empty string when messageCount is 0", () => {
      expect(formatHistoryEntrySize("chats", { messageCount: 0 }, 100)).toBe("");
    });

    it("returns empty string when messageCount is missing", () => {
      expect(formatHistoryEntrySize("chats", {}, 100)).toBe("");
    });

    it("returns empty string when messageCount is not a number", () => {
      expect(formatHistoryEntrySize("chats", { messageCount: "three" }, 100)).toBe("");
    });
  });

  describe("summaries mode", () => {
    it("uses summaryChars from metadata when available", () => {
      expect(formatHistoryEntrySize("summaries", { summaryChars: 1500 }, 800)).toBe("1.5k chars");
    });

    it("falls back to sizeBytes when summaryChars is missing", () => {
      expect(formatHistoryEntrySize("summaries", {}, 2500)).toBe("2.5k chars");
    });

    it("shows raw char count for values under 1000", () => {
      expect(formatHistoryEntrySize("summaries", { summaryChars: 450 }, 450)).toBe("450 chars");
    });

    it("returns empty string when both summaryChars and sizeBytes are 0", () => {
      expect(formatHistoryEntrySize("summaries", { summaryChars: 0 }, 0)).toBe("");
    });
  });
});

describe("detectContentTypeLabel", () => {
  it("returns 'video' for www.youtube.com", () => {
    expect(detectContentTypeLabel("https://www.youtube.com/watch?v=abc123")).toBe("video");
  });

  it("returns 'video' for youtube.com without www", () => {
    expect(detectContentTypeLabel("https://youtube.com/watch?v=abc123")).toBe("video");
  });

  it("returns 'video' for youtu.be short links", () => {
    expect(detectContentTypeLabel("https://youtu.be/abc123")).toBe("video");
  });

  it("returns 'PDF' for .pdf URLs", () => {
    expect(detectContentTypeLabel("https://example.com/paper.pdf")).toBe("PDF");
  });

  it("returns 'page' for regular URLs", () => {
    expect(detectContentTypeLabel("https://example.com/article")).toBe("page");
  });

  it("returns 'page' for null", () => {
    expect(detectContentTypeLabel(null)).toBe("page");
  });

  it("returns 'page' for undefined", () => {
    expect(detectContentTypeLabel(undefined)).toBe("page");
  });

  it("returns 'page' for invalid URLs", () => {
    expect(detectContentTypeLabel("not a url")).toBe("page");
  });
});

describe("extractDomain", () => {
  it("extracts hostname from a URL", () => {
    expect(extractDomain("https://example.com/page")).toBe("example.com");
  });

  it("strips www prefix", () => {
    expect(extractDomain("https://www.youtube.com/watch?v=abc")).toBe("youtube.com");
  });

  it("preserves subdomains other than www", () => {
    expect(extractDomain("https://docs.google.com/doc/123")).toBe("docs.google.com");
  });

  it("returns empty string for null", () => {
    expect(extractDomain(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(extractDomain(undefined)).toBe("");
  });

  it("returns empty string for invalid URLs", () => {
    expect(extractDomain("not-a-url")).toBe("");
  });
});

describe("generatePreview", () => {
  it("strips markdown headings", () => {
    expect(generatePreview("## Summary\nSome text")).toBe("Summary Some text");
  });

  it("strips bold markers", () => {
    expect(generatePreview("This is **bold** text")).toBe("This is bold text");
  });

  it("strips italic markers", () => {
    expect(generatePreview("This is *italic* text")).toBe("This is italic text");
  });

  it("strips inline code backticks", () => {
    expect(generatePreview("Use `console.log` here")).toBe("Use console.log here");
  });

  it("strips markdown links, keeping text", () => {
    expect(generatePreview("See [the docs](https://example.com)")).toBe("See the docs");
  });

  it("strips list markers", () => {
    expect(generatePreview("- item one\n- item two")).toBe("item one item two");
  });

  it("strips numbered list markers", () => {
    expect(generatePreview("1. first\n2. second")).toBe("first second");
  });

  it("truncates long text with ellipsis", () => {
    const long = "A".repeat(200);
    const result = generatePreview(long, 120);
    expect(result).toHaveLength(121); // 120 chars + ellipsis
    expect(result.endsWith("\u2026")).toBe(true);
  });

  it("does not truncate short text", () => {
    expect(generatePreview("Short text")).toBe("Short text");
  });

  it("collapses multiple whitespace", () => {
    expect(generatePreview("a   b\n\nc")).toBe("a b c");
  });

  it("respects custom maxLength", () => {
    const result = generatePreview("Hello World", 5);
    expect(result).toBe("Hello\u2026");
  });
});
