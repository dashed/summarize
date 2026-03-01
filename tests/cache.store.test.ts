import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildTranscriptCacheKey, createCacheStore } from "../src/cache.js";

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
});
