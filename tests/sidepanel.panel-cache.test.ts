import { describe, expect, it, vi } from "vitest";
import {
  createPanelCacheController,
  resolveRestoreAction,
  type PanelCachePayload,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/panel-cache.js";

const samplePayload = (overrides: Partial<PanelCachePayload> = {}): PanelCachePayload => ({
  tabId: 1,
  url: "https://example.com",
  title: "Example",
  runId: "run-1",
  summaryMarkdown: "Hello",
  summaryFromCache: true,
  lastMeta: { inputSummary: "Summary", model: "model", modelLabel: "label" },
  slides: null,
  transcriptTimedText: null,
  ...overrides,
});

describe("panel cache controller", () => {
  it("stores and resolves snapshots per tab", () => {
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    const payload = samplePayload();
    const controller = createPanelCacheController({
      getSnapshot: () => payload,
      sendCache,
      sendRequest,
    });

    controller.syncNow();
    expect(sendCache).toHaveBeenCalledWith(payload);
    expect(controller.resolve(1, "https://example.com")).toEqual(payload);
    expect(controller.resolve(1, "https://other.example")).toBeNull();
  });

  it("debounces scheduled sync and stores latest snapshot", () => {
    vi.useFakeTimers();
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    let snapshot = samplePayload({ summaryMarkdown: "First" });
    const controller = createPanelCacheController({
      getSnapshot: () => snapshot,
      sendCache,
      sendRequest,
    });

    controller.scheduleSync(10);
    snapshot = samplePayload({ summaryMarkdown: "Second" });
    controller.scheduleSync(10);

    vi.runAllTimers();

    expect(sendCache).toHaveBeenCalledTimes(1);
    expect(sendCache).toHaveBeenCalledWith(snapshot);
    expect(controller.resolve(1, "https://example.com")?.summaryMarkdown).toBe("Second");
    vi.useRealTimers();
  });

  it("returns pending request info on cache response", () => {
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    const payload = samplePayload();
    const controller = createPanelCacheController({
      getSnapshot: () => payload,
      sendCache,
      sendRequest,
    });

    const request = controller.request(2, "https://example.com/2", true);
    const result = controller.consumeResponse({
      requestId: request.requestId,
      ok: true,
      cache: payload,
    });

    expect(sendRequest).toHaveBeenCalledWith(request);
    expect(result).toEqual({
      tabId: 2,
      url: "https://example.com/2",
      preserveChat: true,
      cache: payload,
    });
  });

  it("ignores stale cache responses", () => {
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    const payload = samplePayload();
    const controller = createPanelCacheController({
      getSnapshot: () => payload,
      sendCache,
      sendRequest,
    });

    controller.request(2, "https://example.com/2", false);
    const result = controller.consumeResponse({
      requestId: "cache-unknown",
      ok: true,
      cache: payload,
    });

    expect(result).toBeNull();
  });

  it("syncNow preserves runId when summaryMarkdown is null (in-progress run)", () => {
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    const payload = samplePayload({ runId: "run-active", summaryMarkdown: null });
    const controller = createPanelCacheController({
      getSnapshot: () => payload,
      sendCache,
      sendRequest,
    });

    controller.syncNow();

    const cached = controller.resolve(1, "https://example.com");
    expect(cached).not.toBeNull();
    expect(cached!.runId).toBe("run-active");
    expect(cached!.summaryMarkdown).toBeNull();
  });

  it("syncNow before abort preserves state that would otherwise be lost", () => {
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    // Simulate mutable panel state that changes after syncNow
    let currentState = samplePayload({ runId: "run-42", summaryMarkdown: null });
    const controller = createPanelCacheController({
      getSnapshot: () => currentState,
      sendCache,
      sendRequest,
    });

    // Step 1: syncNow captures in-progress state
    controller.syncNow();

    // Step 2: simulate abort + resetSummaryView (clears state)
    currentState = samplePayload({ runId: null, summaryMarkdown: null });

    // Step 3: resolve still returns the pre-abort snapshot
    const cached = controller.resolve(1, "https://example.com");
    expect(cached).not.toBeNull();
    expect(cached!.runId).toBe("run-42");
  });

  it("tab switch simulation: sync tab A, switch to tab B, restore tab A with runId", () => {
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    // Tab A has an in-progress summarization
    let currentState: PanelCachePayload | null = samplePayload({
      tabId: 10,
      url: "https://tab-a.example.com",
      runId: "run-tab-a",
      summaryMarkdown: null,
    });
    const controller = createPanelCacheController({
      getSnapshot: () => currentState,
      sendCache,
      sendRequest,
    });

    // User switches to Tab B — syncNow captures Tab A state before abort
    controller.syncNow();

    // State is now cleared (simulates abort + resetSummaryView)
    currentState = null;

    // Tab B is active — cache for Tab B is empty
    expect(controller.resolve(20, "https://tab-b.example.com")).toBeNull();

    // User switches back to Tab A — resolve finds the cached state
    const restored = controller.resolve(10, "https://tab-a.example.com");
    expect(restored).not.toBeNull();
    expect(restored!.runId).toBe("run-tab-a");
    expect(restored!.summaryMarkdown).toBeNull();
  });

  it("preserves elapsedMs and trackedProgress for in-progress runs", () => {
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    const payload = samplePayload({
      tabId: 10,
      runId: "run-progress",
      summaryMarkdown: null,
      elapsedMs: 12345,
      trackedProgress: 42,
    });
    const controller = createPanelCacheController({
      getSnapshot: () => payload,
      sendCache,
      sendRequest,
    });

    controller.syncNow();

    const cached = controller.resolve(10, "https://example.com");
    expect(cached).not.toBeNull();
    expect(cached!.elapsedMs).toBe(12345);
    expect(cached!.trackedProgress).toBe(42);
  });

  it("round-trips elapsed/progress through tab switch simulation", () => {
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    let currentState: PanelCachePayload | null = samplePayload({
      tabId: 10,
      url: "https://tab-a.example.com",
      runId: "run-tab-a",
      summaryMarkdown: null,
      elapsedMs: 5000,
      trackedProgress: 35,
    });
    const controller = createPanelCacheController({
      getSnapshot: () => currentState,
      sendCache,
      sendRequest,
    });

    // Tab switch away — sync captures state
    controller.syncNow();
    currentState = null;

    // Tab switch back — restore
    const restored = controller.resolve(10, "https://tab-a.example.com");
    expect(restored).not.toBeNull();
    expect(restored!.runId).toBe("run-tab-a");
    expect(restored!.elapsedMs).toBe(5000);
    expect(restored!.trackedProgress).toBe(35);
  });

  it("syncNow preserves partial markdown from streaming", () => {
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    const payload = samplePayload({
      runId: "run-partial",
      summaryMarkdown: "# Title\n\nPartial content so far...",
    });
    const controller = createPanelCacheController({
      getSnapshot: () => payload,
      sendCache,
      sendRequest,
    });

    controller.syncNow();

    const cached = controller.resolve(1, "https://example.com");
    expect(cached!.runId).toBe("run-partial");
    expect(cached!.summaryMarkdown).toBe("# Title\n\nPartial content so far...");
  });
});

describe("resolveRestoreAction", () => {
  it("returns render action when summaryMarkdown is present", () => {
    const payload = samplePayload({ summaryMarkdown: "# Summary\n\nContent here" });
    const action = resolveRestoreAction(payload);
    expect(action).toEqual({ kind: "render", markdown: "# Summary\n\nContent here" });
  });

  it("returns reconnect action when runId is present but no summaryMarkdown", () => {
    const payload = samplePayload({
      runId: "run-reconnect",
      summaryMarkdown: null,
      url: "https://example.com/video",
      title: "My Video",
    });
    const action = resolveRestoreAction(payload);
    expect(action).toEqual({
      kind: "reconnect",
      runId: "run-reconnect",
      url: "https://example.com/video",
      title: "My Video",
    });
  });

  it("returns reconnect with empty title when title is null", () => {
    const payload = samplePayload({
      runId: "run-no-title",
      summaryMarkdown: null,
      title: null,
    });
    const action = resolveRestoreAction(payload);
    expect(action.kind).toBe("reconnect");
    if (action.kind === "reconnect") {
      expect(action.title).toBe("");
    }
  });

  it("returns empty action when neither summaryMarkdown nor runId is present", () => {
    const payload = samplePayload({ runId: null, summaryMarkdown: null });
    const action = resolveRestoreAction(payload);
    expect(action).toEqual({ kind: "empty" });
  });

  it("prefers render over reconnect when both summaryMarkdown and runId are present", () => {
    const payload = samplePayload({
      runId: "run-complete",
      summaryMarkdown: "# Complete Summary",
    });
    const action = resolveRestoreAction(payload);
    expect(action.kind).toBe("render");
  });
});
