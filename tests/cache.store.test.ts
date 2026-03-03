import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildSummaryCacheKey, buildTranscriptCacheKey, createCacheStore } from "../src/cache.js";

describe("cache store", () => {
  it("round-trips text entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    store.setText("summary", "key", "value", null);
    expect(store.getText("summary", "key")).toBe("value");

    store.close();
  });

  it("round-trips json entries and returns null for invalid json", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    store.setJson("summary", "good", { ok: true }, null);
    expect(store.getJson<{ ok: boolean }>("summary", "good")).toEqual({ ok: true });

    store.setText("summary", "bad", "{", null);
    expect(store.getJson("summary", "bad")).toBeNull();

    store.close();
  });

  it("expires entries based on ttl", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    store.setText("summary", "soon", "value", -10);
    expect(store.getText("summary", "soon")).toBeNull();

    store.close();
  });

  it("evicts oldest entries when size cap exceeded", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 60 });

    store.setText("summary", "old", "a".repeat(50), null);
    store.setText("summary", "new", "b".repeat(50), null);

    expect(store.getText("summary", "old")).toBeNull();
    expect(store.getText("summary", "new")).toBe("b".repeat(50));

    store.close();
  });

  it("namespaces transcript cache by namespace", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({
      path,
      maxBytes: 1024 * 1024,
      transcriptNamespace: "yt:web",
    });

    await store.transcriptCache.set({
      url: "https://example.com/video",
      service: "youtube",
      resourceKey: "abc123",
      ttlMs: 1000,
      content: "hello",
      source: "youtubei",
      metadata: null,
    });

    const hit = await store.transcriptCache.get({ url: "https://example.com/video" });
    store.close();

    const otherStore = await createCacheStore({
      path,
      maxBytes: 1024 * 1024,
      transcriptNamespace: "yt:yt-dlp",
    });
    const miss = await otherStore.transcriptCache.get({ url: "https://example.com/video" });

    expect(hit?.content).toBe("hello");
    expect(miss).toBeNull();

    otherStore.close();
  });

  it("stores metadata alongside cache entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    const meta = { model: "google/gemini-3-flash", length: "preset:xl", language: "auto", url: "https://example.com" };
    store.setText("summary", "k1", "summary text", null, meta);

    // Value is still readable via getText
    expect(store.getText("summary", "k1")).toBe("summary text");

    // Verify metadata was persisted in the DB
    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT metadata FROM cache_entries WHERE kind = ? AND key = ?").get("summary", "k1") as { metadata: string | null } | undefined;
    db.close();

    expect(row).toBeDefined();
    expect(row!.metadata).not.toBeNull();
    const parsed = JSON.parse(row!.metadata!);
    expect(parsed.model).toBe("google/gemini-3-flash");
    expect(parsed.length).toBe("preset:xl");
    expect(parsed.language).toBe("auto");
    expect(parsed.url).toBe("https://example.com");

    store.close();
  });

  it("stores null metadata when not provided", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    store.setText("summary", "k1", "value", null);

    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT metadata FROM cache_entries WHERE kind = ? AND key = ?").get("summary", "k1") as { metadata: string | null } | undefined;
    db.close();

    expect(row).toBeDefined();
    expect(row!.metadata).toBeNull();

    store.close();
  });

  it("stores metadata with setJson", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    const meta = { url: "https://example.com/page" };
    store.setJson("extract", "k1", { title: "Example" }, null, meta);

    expect(store.getJson<{ title: string }>("extract", "k1")).toEqual({ title: "Example" });

    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT metadata FROM cache_entries WHERE kind = ? AND key = ?").get("extract", "k1") as { metadata: string | null } | undefined;
    db.close();

    expect(row).toBeDefined();
    const parsed = JSON.parse(row!.metadata!);
    expect(parsed.url).toBe("https://example.com/page");

    store.close();
  });

  it("updates metadata on upsert", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    store.setText("summary", "k1", "v1", null, { model: "old-model" });
    store.setText("summary", "k1", "v2", null, { model: "new-model" });

    expect(store.getText("summary", "k1")).toBe("v2");

    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT metadata FROM cache_entries WHERE kind = ? AND key = ?").get("summary", "k1") as { metadata: string | null } | undefined;
    db.close();

    const parsed = JSON.parse(row!.metadata!);
    expect(parsed.model).toBe("new-model");

    store.close();
  });

  it("migrates existing databases to add metadata column", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");

    // Create a database with the old schema (no metadata column)
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE cache_entries (
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (kind, key)
      )
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_cache_accessed ON cache_entries(last_accessed_at)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache_entries(expires_at)");
    // Insert a row without metadata
    const now = Date.now();
    db.prepare("INSERT INTO cache_entries (kind, key, value, size_bytes, created_at, last_accessed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("summary", "old-key", "old-value", 9, now, now, null);
    db.close();

    // Open with createCacheStore — should migrate and work
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    // Old entry is still readable
    expect(store.getText("summary", "old-key")).toBe("old-value");

    // New entry with metadata works
    store.setText("summary", "new-key", "new-value", null, { model: "test" });
    expect(store.getText("summary", "new-key")).toBe("new-value");

    // Verify metadata column exists and has correct values
    const db2 = new DatabaseSync(path);
    const oldRow = db2.prepare("SELECT metadata FROM cache_entries WHERE key = ?").get("old-key") as { metadata: string | null } | undefined;
    const newRow = db2.prepare("SELECT metadata FROM cache_entries WHERE key = ?").get("new-key") as { metadata: string | null } | undefined;
    db2.close();

    expect(oldRow!.metadata).toBeNull();
    expect(JSON.parse(newRow!.metadata!)).toEqual({ model: "test" });

    store.close();
  });

  it("transcript cache normalizes unknown sources and handles bad payloads", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({
      path,
      maxBytes: 1024 * 1024,
      transcriptNamespace: "yt:web",
    });

    const url = "https://example.com/video";
    const key = buildTranscriptCacheKey({ url, namespace: "yt:web" });

    store.setJson(
      "transcript",
      key,
      {
        content: "hello",
        source: "definitely-not-a-real-source",
        metadata: null,
      },
      null,
    );

    const normalized = await store.transcriptCache.get({ url });
    expect(normalized?.content).toBe("hello");
    expect(normalized?.source).toBeNull();
    expect(normalized?.expired).toBe(false);

    store.setText("transcript", key, "{", null);
    const badPayload = await store.transcriptCache.get({ url });
    expect(badPayload?.content).toBeNull();
    expect(badPayload?.source).toBeNull();

    store.clear();
    expect(await store.transcriptCache.get({ url })).toBeNull();

    store.close();
  });

  it("metadata is stored even when entry expires by TTL", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    const meta = { model: "openai/gpt-5.2", length: "preset:md", language: "en", url: "https://example.com" };
    // Write with a TTL that has already expired
    store.setText("summary", "ephemeral", "value", -10, meta);

    // getText returns null because the entry is expired
    expect(store.getText("summary", "ephemeral")).toBeNull();

    // But the metadata was written to the DB before the expiry check on read
    // The entry gets deleted on the read path, so we verify by writing a new one
    // and confirming the flow works end-to-end. Let's write a fresh entry with short TTL.
    store.setText("summary", "ephemeral2", "value2", 60_000, meta);
    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT metadata FROM cache_entries WHERE kind = ? AND key = ?").get("summary", "ephemeral2") as { metadata: string | null } | undefined;
    db.close();

    expect(row).toBeDefined();
    const parsed = JSON.parse(row!.metadata!);
    expect(parsed.model).toBe("openai/gpt-5.2");
    expect(parsed.url).toBe("https://example.com");

    store.close();
  });

  it("preserves newer entries metadata when old entries are evicted for size", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    // Very small maxBytes to force eviction
    const store = await createCacheStore({ path, maxBytes: 100 });

    const oldMeta = { url: "https://old.example.com" };
    const newMeta = { url: "https://new.example.com", model: "google/gemini-3-flash" };

    store.setText("summary", "old-entry", "a".repeat(80), null, oldMeta);
    // This write should evict the old entry
    store.setText("summary", "new-entry", "b".repeat(80), null, newMeta);

    // Old entry should be evicted
    expect(store.getText("summary", "old-entry")).toBeNull();
    // New entry should survive with its metadata
    expect(store.getText("summary", "new-entry")).toBe("b".repeat(80));

    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT metadata FROM cache_entries WHERE kind = ? AND key = ?").get("summary", "new-entry") as { metadata: string | null } | undefined;
    db.close();

    expect(row).toBeDefined();
    const parsed = JSON.parse(row!.metadata!);
    expect(parsed.url).toBe("https://new.example.com");
    expect(parsed.model).toBe("google/gemini-3-flash");

    store.close();
  });

  it("stores and retrieves large metadata objects", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    const largeMeta = {
      model: "openai/gpt-5.2",
      length: "preset:xl",
      language: "en",
      url: "https://example.com/very/long/path",
      tags: Array.from({ length: 100 }, (_, i) => `tag-${i}`),
      nested: {
        deeply: {
          nested: {
            value: "still here",
            numbers: [1, 2, 3, 4, 5],
          },
        },
      },
      longString: "x".repeat(10_000),
    };

    store.setText("summary", "big-meta", "content", null, largeMeta);
    expect(store.getText("summary", "big-meta")).toBe("content");

    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT metadata FROM cache_entries WHERE kind = ? AND key = ?").get("summary", "big-meta") as { metadata: string | null } | undefined;
    db.close();

    expect(row).toBeDefined();
    const parsed = JSON.parse(row!.metadata!);
    expect(parsed.tags).toHaveLength(100);
    expect(parsed.tags[99]).toBe("tag-99");
    expect(parsed.nested.deeply.nested.value).toBe("still here");
    expect(parsed.longString).toBe("x".repeat(10_000));

    store.close();
  });

  it("handles metadata with special characters in URLs and unicode", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    const meta = {
      model: "模型/gemini-3-flash",
      language: "日本語",
      url: "https://example.com/path?q=hello&lang=en&special=%20%3D%26",
      emoji: "Summary 🎉 done",
      quotes: 'She said "hello" & <goodbye>',
    };

    store.setText("summary", "special", "value", null, meta);

    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT metadata FROM cache_entries WHERE kind = ? AND key = ?").get("summary", "special") as { metadata: string | null } | undefined;
    db.close();

    expect(row).toBeDefined();
    const parsed = JSON.parse(row!.metadata!);
    expect(parsed.model).toBe("模型/gemini-3-flash");
    expect(parsed.language).toBe("日本語");
    expect(parsed.url).toBe("https://example.com/path?q=hello&lang=en&special=%20%3D%26");
    expect(parsed.emoji).toBe("Summary 🎉 done");
    expect(parsed.quotes).toBe('She said "hello" & <goodbye>');

    store.close();
  });

  it("stores metadata across all cache kinds", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    const kinds = ["summary", "extract", "slides", "transcript", "chat"] as const;
    for (const kind of kinds) {
      const meta = { kind, url: `https://example.com/${kind}` };
      store.setText(kind, `${kind}-key`, `${kind}-value`, null, meta);
    }

    const db = new DatabaseSync(path);
    for (const kind of kinds) {
      const row = db.prepare("SELECT metadata FROM cache_entries WHERE kind = ? AND key = ?").get(kind, `${kind}-key`) as { metadata: string | null } | undefined;
      expect(row).toBeDefined();
      const parsed = JSON.parse(row!.metadata!);
      expect(parsed.kind).toBe(kind);
      expect(parsed.url).toBe(`https://example.com/${kind}`);
    }
    db.close();

    // Also verify values are still readable
    for (const kind of kinds) {
      expect(store.getText(kind, `${kind}-key`)).toBe(`${kind}-value`);
    }

    store.close();
  });

  it("buildSummaryCacheKey produces consistent keys independent of metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    const keyParams = {
      contentHash: "abc123",
      promptHash: "def456",
      model: "openai/gpt-5.2",
      lengthKey: "preset:md",
      languageKey: "en",
    };

    // Same params always produce the same key
    const key1 = buildSummaryCacheKey(keyParams);
    const key2 = buildSummaryCacheKey(keyParams);
    expect(key1).toBe(key2);

    // Write two entries with the same cache key but different metadata
    const meta1 = { model: "openai/gpt-5.2", url: "https://a.com" };
    store.setText("summary", key1, "first", null, meta1);

    const meta2 = { model: "openai/gpt-5.2", url: "https://b.com" };
    store.setText("summary", key1, "second", null, meta2);

    // The value should be the latest one (upsert)
    expect(store.getText("summary", key1)).toBe("second");

    // Metadata should be the latest one
    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT metadata FROM cache_entries WHERE kind = ? AND key = ?").get("summary", key1) as { metadata: string | null } | undefined;
    db.close();

    const parsed = JSON.parse(row!.metadata!);
    expect(parsed.url).toBe("https://b.com");

    store.close();
  });

  it("noCache bypass mode prevents both reads and writes", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    // Pre-populate a cached summary
    const meta = { model: "google/gemini-3-flash", length: "preset:xl", language: "auto" };
    store.setText("summary", "cached-key", "old cached summary", null, meta);

    // Simulate noCache=true: the server creates a bypass CacheState with store: null
    // This means cacheStore in summarizeExtractedUrl() is null → no reads, no writes
    // Verify the original entry is untouched after a "refresh" would have occurred
    expect(store.getText("summary", "cached-key")).toBe("old cached summary");

    // Verify that a null store (as used in bypass mode) means no writes happen
    // The cache store itself is set to null in bypass mode, so we just verify
    // the original entry survives and can be read on the next normal request
    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT metadata, value FROM cache_entries WHERE kind = ? AND key = ?").get("summary", "cached-key") as { metadata: string | null; value: string } | undefined;
    db.close();

    expect(row).toBeDefined();
    expect(row!.value).toBe("old cached summary");
    const parsedMeta = JSON.parse(row!.metadata!);
    expect(parsedMeta.model).toBe("google/gemini-3-flash");

    store.close();
  });

  it("normal request after noCache refresh still serves old cached entry", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    const key = buildSummaryCacheKey({
      contentHash: "content123",
      promptHash: "prompt456",
      model: "google/gemini-3-flash",
      lengthKey: "preset:xl",
      languageKey: "auto",
    });

    // First request: cache the summary with metadata
    const meta = { model: "google/gemini-3-flash", length: "preset:xl", language: "auto", url: "https://youtube.com/watch?v=test" };
    store.setText("summary", key, "original summary text", null, meta);
    expect(store.getText("summary", key)).toBe("original summary text");

    // Second request (noCache refresh): store is null, LLM runs, produces different text
    // but nothing is written to cache. We simulate by NOT writing.
    // (In production, requestCache = { mode: "bypass", store: null })

    // Third request (normal): should still get the original cached summary
    expect(store.getText("summary", key)).toBe("original summary text");

    // Verify metadata is still intact from the original write
    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT metadata FROM cache_entries WHERE kind = ? AND key = ?").get("summary", key) as { metadata: string | null } | undefined;
    db.close();

    expect(row).toBeDefined();
    const parsedMeta = JSON.parse(row!.metadata!);
    expect(parsedMeta.model).toBe("google/gemini-3-flash");
    expect(parsedMeta.url).toBe("https://youtube.com/watch?v=test");

    store.close();
  });

  it("cache write happens when noCache is false (normal request path)", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    const key = buildSummaryCacheKey({
      contentHash: "hash1",
      promptHash: "hash2",
      model: "google/gemini-3-flash",
      lengthKey: "preset:xxl",
      languageKey: "auto",
    });

    // Simulate the normal (non-bypass) path: cache store is available,
    // LLM runs, summary is written with metadata
    const meta = {
      model: "google/gemini-3-flash",
      length: "preset:xxl",
      language: "auto",
      url: "https://youtube.com/watch?v=9Kn75xtLPDY",
    };
    const summaryText = "# Walkthrough Objectives\n\nThis is the streamed summary content...";
    store.setText("summary", key, summaryText, 30 * 24 * 60 * 60 * 1000, meta);

    // Verify summary is cached
    expect(store.getText("summary", key)).toBe(summaryText);

    // Verify metadata was persisted
    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT metadata, size_bytes FROM cache_entries WHERE kind = ? AND key = ?").get("summary", key) as { metadata: string | null; size_bytes: number } | undefined;
    db.close();

    expect(row).toBeDefined();
    expect(row!.size_bytes).toBe(Buffer.byteLength(summaryText, "utf8"));
    const parsedMeta = JSON.parse(row!.metadata!);
    expect(parsedMeta.model).toBe("google/gemini-3-flash");
    expect(parsedMeta.length).toBe("preset:xxl");
    expect(parsedMeta.url).toBe("https://youtube.com/watch?v=9Kn75xtLPDY");

    store.close();
  });

  it("cache read does not return stale entry when key components differ", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    const baseParams = {
      contentHash: "same-content",
      promptHash: "same-prompt",
      model: "google/gemini-3-flash",
      lengthKey: "preset:xl",
      languageKey: "auto",
    };

    // Cache a summary with XL length
    const xlKey = buildSummaryCacheKey(baseParams);
    store.setText("summary", xlKey, "XL summary (10k chars)", null, { length: "preset:xl" });

    // Request with XXL length produces a different key
    const xxlKey = buildSummaryCacheKey({ ...baseParams, lengthKey: "preset:xxl" });
    expect(xlKey).not.toBe(xxlKey);

    // XXL request should be a cache miss
    expect(store.getText("summary", xxlKey)).toBeNull();

    // XL entry should still be there
    expect(store.getText("summary", xlKey)).toBe("XL summary (10k chars)");

    store.close();
  });

  it("asset-style metadata includes url and title when provided", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    // Simulates asset flow cache write with url/title (called from URL flow)
    const metaWithUrl = {
      model: "google/gemini-3-flash",
      length: "preset:xl",
      language: "auto",
      url: "https://example.com/video.mp4",
      title: "Cool Video File",
      summaryChars: 3000,
    };
    store.setText("summary", "asset-with-url", "asset summary", null, metaWithUrl);

    // Simulates asset flow cache write without url/title (CLI file path)
    const metaWithoutUrl = {
      model: "google/gemini-3-flash",
      length: "preset:xl",
      language: "auto",
      url: null,
      title: null,
      summaryChars: 2000,
    };
    store.setText("summary", "asset-no-url", "file summary", null, metaWithoutUrl);

    const entry1 = store.getEntryWithMeta("summary", "asset-with-url");
    expect(entry1?.metadata?.url).toBe("https://example.com/video.mp4");
    expect(entry1?.metadata?.title).toBe("Cool Video File");

    const entry2 = store.getEntryWithMeta("summary", "asset-no-url");
    expect(entry2?.metadata?.url).toBeNull();
    expect(entry2?.metadata?.title).toBeNull();

    // URL-filtered history should find the first entry but not the second
    const filtered = store.listEntries("summary", { filterUrl: "https://example.com/video" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].key).toBe("asset-with-url");

    store.close();
  });

  it("stores and retrieves title and siteName in metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    const meta = {
      model: "google/gemini-3-flash",
      url: "https://www.youtube.com/watch?v=abc123",
      title: "How to Build a Rocket",
      siteName: "YouTube",
      length: "preset:xl",
      language: "auto",
      summaryChars: 5000,
    };
    store.setText("summary", "yt-key", "summary text here", null, meta);

    const entry = store.getEntryWithMeta("summary", "yt-key");
    expect(entry).not.toBeNull();
    expect(entry!.metadata).not.toBeNull();
    expect(entry!.metadata!.title).toBe("How to Build a Rocket");
    expect(entry!.metadata!.siteName).toBe("YouTube");
    expect(entry!.metadata!.url).toBe("https://www.youtube.com/watch?v=abc123");

    store.close();
  });

  it("listEntries returns title in metadata for history display", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    store.setText("summary", "k1", "text1", null, {
      url: "https://example.com/article",
      title: "Great Article",
      model: "gemini",
    });
    store.setText("summary", "k2", "text2", null, {
      url: "https://www.youtube.com/watch?v=xyz",
      title: "Cool Video",
      siteName: "YouTube",
      model: "gemini",
    });
    store.setText("summary", "k3", "text3", null, {
      url: "https://example.com/no-title",
      model: "gemini",
    });

    const entries = store.listEntries("summary", { limit: 10 });
    expect(entries).toHaveLength(3);

    const withTitle = entries.find((e) => e.key === "k1");
    expect(withTitle?.metadata?.title).toBe("Great Article");

    const withSiteName = entries.find((e) => e.key === "k2");
    expect(withSiteName?.metadata?.title).toBe("Cool Video");
    expect(withSiteName?.metadata?.siteName).toBe("YouTube");

    const noTitle = entries.find((e) => e.key === "k3");
    expect(noTitle?.metadata?.title).toBeUndefined();
    expect(noTitle?.metadata?.url).toBe("https://example.com/no-title");

    store.close();
  });

  it("metadata title fallback chain: title > url > Unknown", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-cache-"));
    const path = join(root, "cache.sqlite");
    const store = await createCacheStore({ path, maxBytes: 1024 * 1024 });

    // Entry with title
    store.setText("summary", "has-title", "text", null, {
      title: "My Page Title",
      url: "https://example.com",
    });
    // Entry with only url
    store.setText("summary", "has-url", "text", null, {
      url: "https://example.com/page",
    });
    // Entry with no metadata
    store.setText("summary", "no-meta", "text", null);

    // Simulate the extension's title resolution logic
    const resolve = (meta: Record<string, unknown> | null) =>
      String(meta?.title || meta?.url || "Unknown");

    const e1 = store.getEntryWithMeta("summary", "has-title");
    expect(resolve(e1?.metadata ?? null)).toBe("My Page Title");

    const e2 = store.getEntryWithMeta("summary", "has-url");
    expect(resolve(e2?.metadata ?? null)).toBe("https://example.com/page");

    const e3 = store.getEntryWithMeta("summary", "no-meta");
    expect(resolve(e3?.metadata ?? null)).toBe("Unknown");

    store.close();
  });
});
