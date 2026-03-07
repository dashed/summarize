/**
 * Tests for the daemon history API endpoint logic.
 *
 * Since the daemon server requires a full HTTP server lifecycle, these tests
 * exercise the same cache-layer operations the history endpoints perform:
 * - GET /v1/history/summaries  → store.listEntries("summary", ...)
 * - GET /v1/history/summaries/:key → store.getEntryWithMeta("summary", key)
 * - POST /v1/agent/history → store.getJson("chat", key) with hashed key
 * - POST /v1/agent/history/save → store.setJson("chat", key, messages, ttl, meta)
 * - GET /v1/history/chats → store.listEntries("chat", ...)
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCacheStore } from "../src/cache.js";
import { buildChatHistoryKey } from "../src/daemon/history.js";

function makeTempStore(maxBytes = 1024 * 1024) {
  const root = mkdtempSync(join(tmpdir(), "summarize-daemon-history-"));
  const path = join(root, "cache.sqlite");
  return createCacheStore({ path, maxBytes });
}

function buildChatKey({
  url,
  automationEnabled,
  cacheContent,
  pageContent,
}: {
  url: string;
  automationEnabled: boolean;
  cacheContent?: string | null;
  pageContent?: string | null;
}): string {
  return buildChatHistoryKey({ url, automationEnabled, cacheContent, pageContent });
}

describe("GET /v1/history/summaries (cache layer)", () => {
  it("returns summary entries with metadata", async () => {
    const store = await makeTempStore();

    store.setText("summary", "sum-1", "# Hello World", null, {
      url: "https://example.com/page1",
      model: "openai/gpt-4o",
      summaryChars: 200,
    });
    store.setText("summary", "sum-2", "# Another Page", null, {
      url: "https://example.com/page2",
      model: "google/gemini-3-flash",
      summaryChars: 350,
    });

    // Simulate: store.listEntries("summary", { limit, offset })
    const entries = store.listEntries("summary", { limit: 50, offset: 0 });

    expect(entries).toHaveLength(2);
    // Check structure matches what the API returns
    for (const entry of entries) {
      expect(entry).toHaveProperty("key");
      expect(entry).toHaveProperty("created_at");
      expect(entry).toHaveProperty("last_accessed_at");
      expect(entry).toHaveProperty("size_bytes");
      expect(entry).toHaveProperty("metadata");
    }

    const urls = entries.map((e) => e.metadata?.url);
    expect(urls).toContain("https://example.com/page1");
    expect(urls).toContain("https://example.com/page2");

    store.close();
  });

  it("respects limit parameter", async () => {
    const store = await makeTempStore();

    for (let i = 0; i < 5; i++) {
      store.setText("summary", `s${i}`, `content-${i}`, null, { url: `https://site.com/${i}` });
    }

    const limited = store.listEntries("summary", { limit: 2, offset: 0 });
    expect(limited).toHaveLength(2);

    store.close();
  });

  it("does not include chat entries in summary listing", async () => {
    const store = await makeTempStore();

    store.setText("summary", "sum-1", "summary content", null);
    store.setJson("chat", "chat-1", [{ role: "user", content: "hi" }], null);

    const summaries = store.listEntries("summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].key).toBe("sum-1");

    store.close();
  });
});

describe("GET /v1/history/summaries/:key (cache layer)", () => {
  it("returns full summary text with metadata", async () => {
    const store = await makeTempStore();

    const meta = {
      url: "https://example.com/article",
      model: "openai/gpt-4o",
      summaryChars: 500,
      title: "My Article",
    };
    store.setText("summary", "the-key", "# Full Summary\n\nLong content here...", null, meta);

    // Simulate: store.getEntryWithMeta("summary", key)
    const entry = store.getEntryWithMeta("summary", "the-key");

    expect(entry).not.toBeNull();
    expect(entry!.value).toBe("# Full Summary\n\nLong content here...");
    expect(entry!.created_at).toBeGreaterThan(0);
    expect(entry!.metadata).toEqual(meta);

    store.close();
  });

  it("returns null for nonexistent summary key (404 in API)", async () => {
    const store = await makeTempStore();

    const entry = store.getEntryWithMeta("summary", "missing-key");
    expect(entry).toBeNull();

    store.close();
  });
});

describe("POST /v1/agent/history (chat load, cache layer)", () => {
  it("loads chat messages by hashed key", async () => {
    const store = await makeTempStore();

    const url = "https://example.com/page";
    const automationEnabled = true;
    const key = buildChatKey({
      url,
      automationEnabled,
      cacheContent: "Page body v1",
    });
    const messages = [
      { role: "user", content: "What is this page about?" },
      { role: "assistant", content: "This page is about testing." },
    ];
    store.setJson("chat", key, messages, null);

    // Simulate the endpoint: store.getJson("chat", key)
    const loaded = store.getJson<unknown[]>("chat", key);
    expect(loaded).toEqual(messages);

    store.close();
  });

  it("returns null for missing chat (empty messages in API)", async () => {
    const store = await makeTempStore();

    const key = buildChatKey({
      url: "https://not-saved.com",
      automationEnabled: false,
      cacheContent: "missing",
    });
    const loaded = store.getJson<unknown[]>("chat", key);
    expect(loaded).toBeNull();

    store.close();
  });

  it("produces different keys for different automation states", async () => {
    const store = await makeTempStore();

    const url = "https://example.com/page";
    const keyEnabled = buildChatKey({
      url,
      automationEnabled: true,
      cacheContent: "same content",
    });
    const keyDisabled = buildChatKey({
      url,
      automationEnabled: false,
      cacheContent: "same content",
    });
    expect(keyEnabled).not.toBe(keyDisabled);

    store.setJson("chat", keyEnabled, [{ role: "user", content: "auto-on" }], null);
    store.setJson("chat", keyDisabled, [{ role: "user", content: "auto-off" }], null);

    const loaded1 = store.getJson<Array<{ role: string; content: string }>>("chat", keyEnabled);
    const loaded2 = store.getJson<Array<{ role: string; content: string }>>("chat", keyDisabled);
    expect(loaded1![0].content).toBe("auto-on");
    expect(loaded2![0].content).toBe("auto-off");

    store.close();
  });

  it("produces different keys for the same URL when page content differs", () => {
    const url = "https://example.com/page";
    const first = buildChatKey({
      url,
      automationEnabled: false,
      cacheContent: "first revision",
    });
    const second = buildChatKey({
      url,
      automationEnabled: false,
      cacheContent: "second revision",
    });

    expect(first).not.toBe(second);
  });
});

describe("POST /v1/agent/history/save (chat save, cache layer)", () => {
  it("persists chat messages with metadata", async () => {
    const store = await makeTempStore();

    const url = "https://example.com/article";
    const automationEnabled = false;
    const key = buildChatKey({
      url,
      automationEnabled,
      cacheContent: "Article body",
    });
    const messages = [
      { role: "user", content: "Summarize this" },
      { role: "assistant", content: "Here is a summary..." },
    ];
    const metadata = {
      url,
      historyUrl: url,
      title: "Test Article",
      model: "openai/gpt-4o",
      messageCount: messages.length,
    };

    // Simulate: store.setJson("chat", key, messages, ttlMs, metadata)
    store.setJson("chat", key, messages, 30 * 24 * 60 * 60 * 1000, metadata);

    // Verify the messages can be loaded back
    const loaded = store.getJson<unknown[]>("chat", key);
    expect(loaded).toEqual(messages);

    // Verify metadata is stored (via getEntryWithMeta)
    const entry = store.getEntryWithMeta("chat", key);
    expect(entry).not.toBeNull();
    expect(entry!.metadata).toEqual(metadata);

    store.close();
  });

  it("overwrites existing chat on re-save", async () => {
    const store = await makeTempStore();

    const url = "https://example.com/page";
    const key = buildChatKey({
      url,
      automationEnabled: false,
      cacheContent: "stable page body",
    });

    // First save
    store.setJson("chat", key, [{ role: "user", content: "first" }], null, {
      url,
      historyUrl: url,
      title: null,
      model: null,
      messageCount: 1,
    });

    // Second save (updated conversation)
    const updated = [
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "follow up" },
    ];
    store.setJson("chat", key, updated, null, {
      url,
      historyUrl: url,
      title: "Updated Page",
      model: "openai/gpt-4o",
      messageCount: 3,
    });

    const loaded = store.getJson<unknown[]>("chat", key);
    expect(loaded).toEqual(updated);

    const entry = store.getEntryWithMeta("chat", key);
    expect(entry!.metadata!.messageCount).toBe(3);
    expect(entry!.metadata!.title).toBe("Updated Page");

    store.close();
  });

  it("does not overwrite chat history when the URL is unchanged but the page fingerprint differs", async () => {
    const store = await makeTempStore();

    const url = "https://example.com/page";
    const firstKey = buildChatKey({
      url,
      automationEnabled: false,
      cacheContent: "first revision",
    });
    const secondKey = buildChatKey({
      url,
      automationEnabled: false,
      cacheContent: "second revision",
    });
    expect(firstKey).not.toBe(secondKey);

    store.setJson("chat", firstKey, [{ role: "assistant", content: "first response" }], null, {
      url,
      historyUrl: url,
      title: "Page",
      model: "openai/gpt-4o",
      messageCount: 1,
    });
    store.setJson("chat", secondKey, [{ role: "assistant", content: "second response" }], null, {
      url,
      historyUrl: url,
      title: "Page",
      model: "openai/gpt-4o",
      messageCount: 1,
    });

    expect(store.getJson<Array<{ content: string }>>("chat", firstKey)?.[0]?.content).toBe(
      "first response",
    );
    expect(store.getJson<Array<{ content: string }>>("chat", secondKey)?.[0]?.content).toBe(
      "second response",
    );

    store.close();
  });

  it("load and save use the same richer key inputs", async () => {
    const store = await makeTempStore();

    const key = buildChatKey({
      url: "https://example.com/page?id=1&utm_source=mail",
      automationEnabled: true,
      cacheContent: "Canonical body",
    });
    const messages = [{ role: "assistant", content: "reloaded" }];

    store.setJson("chat", key, messages, null, {
      url: "https://example.com/page?id=1&utm_source=mail",
      historyUrl: "https://example.com/page?id=1",
      title: "Page",
      model: "openai/gpt-4o",
      messageCount: 1,
    });

    const loaded = store.getJson<typeof messages>(
      "chat",
      buildChatKey({
        url: "https://example.com/page?id=1",
        automationEnabled: true,
        cacheContent: "Canonical body",
      }),
    );
    expect(loaded).toEqual(messages);

    store.close();
  });
});

describe("GET /v1/history/chats (cache layer)", () => {
  it("returns chat entries from cache", async () => {
    const store = await makeTempStore();

    const url1 = "https://site.com/a";
    const url2 = "https://site.com/b";
    const key1 = buildChatKey({ url: url1, automationEnabled: false, cacheContent: "A" });
    const key2 = buildChatKey({ url: url2, automationEnabled: true, cacheContent: "B" });

    store.setJson("chat", key1, [{ role: "user", content: "hello" }], null, {
      url: url1,
      title: "Page A",
      model: "gpt-4o",
      messageCount: 1,
    });
    store.setJson("chat", key2, [{ role: "user", content: "world" }], null, {
      url: url2,
      title: "Page B",
      model: null,
      messageCount: 1,
    });

    // Simulate: store.listEntries("chat", { limit, offset })
    const chats = store.listEntries("chat", { limit: 50, offset: 0 });

    expect(chats).toHaveLength(2);
    const titles = chats.map((c) => c.metadata?.title);
    expect(titles).toContain("Page A");
    expect(titles).toContain("Page B");

    store.close();
  });

  it("does not include summary entries in chat listing", async () => {
    const store = await makeTempStore();

    store.setText("summary", "sum-1", "summary text", null);
    store.setJson(
      "chat",
      buildChatKey("https://example.com", false),
      [{ role: "user", content: "hi" }],
      null,
      {
        url: "https://example.com",
        messageCount: 1,
      },
    );

    const chats = store.listEntries("chat");
    expect(chats).toHaveLength(1);

    store.close();
  });
});
