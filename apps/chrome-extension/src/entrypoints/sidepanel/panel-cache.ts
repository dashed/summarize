import type { SseSlidesData } from "../../../../../src/shared/sse-events.js";

type PanelCacheMeta = {
  inputSummary: string | null;
  model: string | null;
  modelLabel: string | null;
};

export type PanelCachePayload = {
  tabId: number;
  url: string;
  title: string | null;
  runId: string | null;
  slidesRunId: string | null;
  summaryMarkdown: string | null;
  summaryFromCache: boolean | null;
  lastMeta: PanelCacheMeta;
  slides: SseSlidesData | null;
  transcriptTimedText: string | null;
  /** Elapsed timer value (ms) at the time the cache was saved. */
  elapsedMs?: number | null;
  /** Progress bar position (0–100) at the time the cache was saved. */
  trackedProgress?: number | null;
};

export type PanelCacheResponse = {
  requestId: string;
  ok: boolean;
  cache?: PanelCachePayload;
};

export type PanelCacheRequest = {
  requestId: string;
  tabId: number;
  url: string;
};

export type PanelCacheResult = {
  tabId: number;
  url: string;
  preserveChat: boolean;
  cache: PanelCachePayload | null;
};

export type PanelCacheController = {
  resolve: (tabId: number, url: string) => PanelCachePayload | null;
  scheduleSync: (delayMs?: number) => void;
  syncNow: () => void;
  request: (tabId: number, url: string, preserveChat: boolean) => PanelCacheRequest;
  consumeResponse: (response: PanelCacheResponse) => PanelCacheResult | null;
};

export type PanelCacheControllerOptions = {
  getSnapshot: () => PanelCachePayload | null;
  sendCache: (payload: PanelCachePayload) => void;
  sendRequest: (request: PanelCacheRequest) => void;
};

export function createPanelCacheController(
  options: PanelCacheControllerOptions,
): PanelCacheController {
  const { getSnapshot, sendCache, sendRequest } = options;
  const cacheByKey = new Map<string, PanelCachePayload>();
  let syncTimer = 0;
  let requestCounter = 0;
  let pendingRequest: {
    requestId: string;
    tabId: number;
    url: string;
    preserveChat: boolean;
  } | null = null;

  const buildKey = (tabId: number, url: string) => `${tabId}:${url}`;

  const store = (payload: PanelCachePayload) => {
    for (const key of cacheByKey.keys()) {
      if (key.startsWith(`${payload.tabId}:`) && key !== buildKey(payload.tabId, payload.url)) {
        cacheByKey.delete(key);
      }
    }
    cacheByKey.set(buildKey(payload.tabId, payload.url), payload);
  };

  const resolve = (tabId: number, url: string) => cacheByKey.get(buildKey(tabId, url)) ?? null;

  const syncNow = () => {
    const snapshot = getSnapshot();
    if (!snapshot) return;
    store(snapshot);
    sendCache(snapshot);
  };

  const scheduleSync = (delayMs = 800) => {
    const snapshot = getSnapshot();
    if (snapshot) {
      store(snapshot);
    }
    if (syncTimer) globalThis.clearTimeout(syncTimer);
    syncTimer = globalThis.setTimeout(() => {
      syncTimer = 0;
      syncNow();
    }, delayMs);
  };

  const request = (tabId: number, url: string, preserveChat: boolean): PanelCacheRequest => {
    const requestId = `cache-${++requestCounter}`;
    pendingRequest = { requestId, tabId, url, preserveChat };
    const payload = { requestId, tabId, url };
    sendRequest(payload);
    return payload;
  };

  const consumeResponse = (response: PanelCacheResponse): PanelCacheResult | null => {
    if (!pendingRequest || response.requestId !== pendingRequest.requestId) return null;
    const pending = pendingRequest;
    pendingRequest = null;
    if (!response.ok || !response.cache) {
      return {
        tabId: pending.tabId,
        url: pending.url,
        preserveChat: pending.preserveChat,
        cache: null,
      };
    }
    store(response.cache);
    return {
      tabId: pending.tabId,
      url: pending.url,
      preserveChat: pending.preserveChat,
      cache: response.cache,
    };
  };

  return { resolve, scheduleSync, syncNow, request, consumeResponse };
}

// ---------------------------------------------------------------------------
// Pure helper: decide what to do when restoring a cached panel state
// ---------------------------------------------------------------------------

export type RestoreAction =
  | { kind: "render"; markdown: string }
  | { kind: "reconnect"; runId: string; url: string; title: string }
  | { kind: "empty" };

/**
 * Given a cached panel payload, decide whether to render the cached markdown,
 * reconnect to the daemon SSE replay (in-progress run that was interrupted by
 * a tab switch), or show an empty state.
 */
export function resolveRestoreAction(payload: PanelCachePayload): RestoreAction {
  if (payload.summaryMarkdown) {
    return { kind: "render", markdown: payload.summaryMarkdown };
  }
  if (payload.runId) {
    return {
      kind: "reconnect",
      runId: payload.runId,
      url: payload.url,
      title: payload.title ?? "",
    };
  }
  return { kind: "empty" };
}
