import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createCacheStore } from "../src/cache.js";

function makeTempStore(maxBytes = 1024 * 1024) {
  const root = mkdtempSync(join(tmpdir(), "summarize-cache-list-"));
  const path = join(root, "cache.sqlite");
  return createCacheStore({ path, maxBytes });
}

/** Insert a cache entry with an explicit created_at timestamp for deterministic ordering. */
function insertWithTimestamp(
  dbPath: string,
  kind: string,
  key: string,
  value: string,
  createdAt: number,
  metadata?: Record<string, unknown> | null,
) {
  const db = new DatabaseSync(dbPath);
  const size = Buffer.byteLength(value, "utf-8");
  db.exec(`
    INSERT OR REPLACE INTO cache_entries (kind, key, value, size_bytes, created_at, last_accessed_at, expires_at, metadata)
    VALUES ('${kind}', '${key}', '${value}', ${size}, ${createdAt}, ${createdAt}, NULL, ${metadata ? `'${JSON.stringify(metadata)}'` : "NULL"})
  `);
  db.close();
}

describe("listEntries", () => {
  it("returns entries sorted by created_at DESC by default", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-list-"));
    const path = join(root, "cache.sqlite");
    const store = await makeTempStore();
    // Use explicit timestamps so ordering is deterministic
    const dbPath = join(mkdtempSync(join(tmpdir(), "summarize-cache-order-")), "cache.sqlite");
    const store2 = await createCacheStore({ path: dbPath, maxBytes: 1024 * 1024 });
    insertWithTimestamp(dbPath, "summary", "a", "first", 1000);
    insertWithTimestamp(dbPath, "summary", "b", "second", 2000);
    insertWithTimestamp(dbPath, "summary", "c", "third", 3000);

    const entries = store2.listEntries("summary");
    expect(entries).toHaveLength(3);
    // DESC order: newest first
    expect(entries[0].key).toBe("c");
    expect(entries[1].key).toBe("b");
    expect(entries[2].key).toBe("a");
    expect(entries[0].created_at).toBe(3000);
    expect(entries[2].created_at).toBe(1000);

    store.close();
    store2.close();
  });

  it("returns entries in ASC order when specified", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "summarize-cache-asc-")), "cache.sqlite");
    const store = await createCacheStore({ path: dbPath, maxBytes: 1024 * 1024 });
    insertWithTimestamp(dbPath, "summary", "a", "first", 1000);
    insertWithTimestamp(dbPath, "summary", "b", "second", 2000);

    const entries = store.listEntries("summary", { order: "asc" });
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toBe("a");
    expect(entries[1].key).toBe("b");

    store.close();
  });

  it("respects limit and offset for pagination", async () => {
    const store = await makeTempStore();

    for (let i = 0; i < 10; i++) {
      store.setText("summary", `key-${i}`, `value-${i}`, null);
    }

    const page1 = store.listEntries("summary", { limit: 3, offset: 0 });
    expect(page1).toHaveLength(3);

    const page2 = store.listEntries("summary", { limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);

    // No overlap between pages
    const page1Keys = page1.map((e) => e.key);
    const page2Keys = page2.map((e) => e.key);
    for (const k of page1Keys) {
      expect(page2Keys).not.toContain(k);
    }

    // Beyond end returns empty
    const beyondEnd = store.listEntries("summary", { limit: 10, offset: 100 });
    expect(beyondEnd).toHaveLength(0);

    store.close();
  });

  it("excludes expired entries", async () => {
    const store = await makeTempStore();

    store.setText("summary", "valid", "good", null);
    store.setText("summary", "expired", "gone", -10); // Already expired

    const entries = store.listEntries("summary");
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("valid");

    store.close();
  });

  it("returns parsed metadata JSON", async () => {
    const store = await makeTempStore();

    const meta = { url: "https://example.com", model: "gpt-4o", summaryChars: 1234 };
    store.setText("summary", "with-meta", "content", null, meta);

    const entries = store.listEntries("summary");
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata).toEqual(meta);

    store.close();
  });

  it("returns null metadata when none was stored", async () => {
    const store = await makeTempStore();

    store.setText("summary", "no-meta", "content", null);

    const entries = store.listEntries("summary");
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata).toBeNull();

    store.close();
  });

  it("only returns entries for the requested kind", async () => {
    const store = await makeTempStore();

    store.setText("summary", "sum-1", "summary content", null);
    store.setText("extract", "ext-1", "extracted content", null);
    store.setText("chat", "chat-1", "chat messages", null);

    const summaries = store.listEntries("summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].key).toBe("sum-1");

    const chats = store.listEntries("chat");
    expect(chats).toHaveLength(1);
    expect(chats[0].key).toBe("chat-1");

    store.close();
  });

  it("includes size_bytes in results", async () => {
    const store = await makeTempStore();

    const value = "hello world test content";
    store.setText("summary", "sized", value, null);

    const entries = store.listEntries("summary");
    expect(entries).toHaveLength(1);
    expect(entries[0].size_bytes).toBeGreaterThan(0);

    store.close();
  });

  it("filters entries by URL in metadata when filterUrl is provided", async () => {
    const store = await makeTempStore();

    store.setText("summary", "a", "content-a", null, { url: "https://example.com/video1" });
    store.setText("summary", "b", "content-b", null, { url: "https://example.com/video2" });
    store.setText("summary", "c", "content-c", null, { url: "https://example.com/video1" });
    store.setText("summary", "d", "content-d", null); // no metadata

    const filtered = store.listEntries("summary", { filterUrl: "https://example.com/video1" });
    expect(filtered).toHaveLength(2);
    const keys = filtered.map((e) => e.key);
    expect(keys).toContain("a");
    expect(keys).toContain("c");
    expect(keys).not.toContain("b");
    expect(keys).not.toContain("d");

    // Without filter returns all
    const all = store.listEntries("summary");
    expect(all).toHaveLength(4);

    store.close();
  });

  it("filterUrl with no matches returns empty", async () => {
    const store = await makeTempStore();

    store.setText("summary", "a", "content", null, { url: "https://example.com/video1" });

    const entries = store.listEntries("summary", { filterUrl: "https://other.com" });
    expect(entries).toHaveLength(0);

    store.close();
  });

  it("filterUrl works with ASC order", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "summarize-cache-url-asc-")), "cache.sqlite");
    const store = await createCacheStore({ path: dbPath, maxBytes: 1024 * 1024 });
    insertWithTimestamp(dbPath, "summary", "a", "first", 1000, { url: "https://example.com" });
    insertWithTimestamp(dbPath, "summary", "b", "second", 2000, { url: "https://example.com" });
    insertWithTimestamp(dbPath, "summary", "c", "third", 3000, { url: "https://other.com" });

    const entries = store.listEntries("summary", {
      filterUrl: "https://example.com",
      order: "asc",
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toBe("a");
    expect(entries[1].key).toBe("b");

    store.close();
  });
});

describe("getEntryWithMeta", () => {
  it("returns value, created_at, and metadata for existing entries", async () => {
    const store = await makeTempStore();

    const meta = { url: "https://example.com", model: "gemini-3-flash" };
    store.setText("summary", "key-1", "summary text", null, meta);

    const entry = store.getEntryWithMeta("summary", "key-1");
    expect(entry).not.toBeNull();
    expect(entry!.value).toBe("summary text");
    expect(entry!.created_at).toBeGreaterThan(0);
    expect(entry!.metadata).toEqual(meta);

    store.close();
  });

  it("returns null for nonexistent entries", async () => {
    const store = await makeTempStore();

    const entry = store.getEntryWithMeta("summary", "nonexistent");
    expect(entry).toBeNull();

    store.close();
  });

  it("returns null for expired entries", async () => {
    const store = await makeTempStore();

    store.setText("summary", "expired", "gone", -10);

    const entry = store.getEntryWithMeta("summary", "expired");
    expect(entry).toBeNull();

    store.close();
  });

  it("returns null metadata when none was stored", async () => {
    const store = await makeTempStore();

    store.setText("summary", "no-meta", "content", null);

    const entry = store.getEntryWithMeta("summary", "no-meta");
    expect(entry).not.toBeNull();
    expect(entry!.value).toBe("content");
    expect(entry!.metadata).toBeNull();

    store.close();
  });

  it("works with JSON entries", async () => {
    const store = await makeTempStore();

    const chatMessages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    const meta = { url: "https://example.com", messageCount: 2 };
    store.setJson("chat", "chat-key", chatMessages, null, meta);

    const entry = store.getEntryWithMeta("chat", "chat-key");
    expect(entry).not.toBeNull();
    const parsed = JSON.parse(entry!.value);
    expect(parsed).toEqual(chatMessages);
    expect(entry!.metadata).toEqual(meta);

    store.close();
  });

  it("respects kind isolation", async () => {
    const store = await makeTempStore();

    store.setText("summary", "key", "summary value", null);
    store.setText("chat", "key", "chat value", null);

    const summaryEntry = store.getEntryWithMeta("summary", "key");
    expect(summaryEntry!.value).toBe("summary value");

    const chatEntry = store.getEntryWithMeta("chat", "key");
    expect(chatEntry!.value).toBe("chat value");

    store.close();
  });
});
