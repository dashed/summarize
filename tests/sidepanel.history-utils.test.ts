import { describe, expect, it } from "vitest";
import {
  isCurrentEntry,
  resolveCurrentKey,
  shouldMarkFirstAsCurrent,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/history-utils.js";

describe("resolveCurrentKey", () => {
  it("returns loadedHistoryKey in summaries mode", () => {
    expect(resolveCurrentKey("summaries", "abc123")).toBe("abc123");
  });

  it("returns null in summaries mode when no key loaded", () => {
    expect(resolveCurrentKey("summaries", null)).toBeNull();
  });

  it("returns null in chats mode even with loadedHistoryKey", () => {
    expect(resolveCurrentKey("chats", "abc123")).toBeNull();
  });

  it("returns null in chats mode with no key", () => {
    expect(resolveCurrentKey("chats", null)).toBeNull();
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
    it("marks first when chat is active", () => {
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
