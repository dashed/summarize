/**
 * Lightweight diagnostic event logger.
 *
 * Batches events in memory and flushes them to the daemon's
 * POST /v1/diagnostics endpoint periodically.
 */

type DiagnosticEvent = {
  timestamp?: number;
  source: string;
  event: string;
  url?: string | null;
  tabId?: number | null;
  sessionId?: string | null;
  detail?: Record<string, unknown> | null;
};

const FLUSH_INTERVAL_MS = 2_000;
const MAX_QUEUE_SIZE = 200;

let queue: DiagnosticEvent[] = [];
let flushTimer = 0;
let flushing = false;
let cachedToken: string | null = null;

function getToken(): string | null {
  return cachedToken;
}

export function setDiagnosticsToken(token: string | null): void {
  cachedToken = token;
}

async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return;
  const token = getToken();
  if (!token) return;

  const batch = queue.splice(0, MAX_QUEUE_SIZE);
  flushing = true;
  try {
    await fetch("http://127.0.0.1:8787/v1/diagnostics", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    // If flush fails, re-queue events (drop if too many to avoid memory leak)
    if (queue.length < MAX_QUEUE_SIZE * 2) {
      queue.unshift(...batch);
    }
  } finally {
    flushing = false;
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = globalThis.setTimeout(() => {
    flushTimer = 0;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

export function logDiagnostic(
  source: string,
  event: string,
  detail?: Record<string, unknown> | null,
  opts?: { url?: string | null; tabId?: number | null; sessionId?: string | null },
): void {
  const entry: DiagnosticEvent = {
    timestamp: Date.now(),
    source,
    event,
    url: opts?.url ?? null,
    tabId: opts?.tabId ?? null,
    sessionId: opts?.sessionId ?? null,
    detail: detail ?? null,
  };

  queue.push(entry);

  if (queue.length >= MAX_QUEUE_SIZE) {
    void flush();
  } else {
    scheduleFlush();
  }
}

/** Force-flush any pending events (e.g. before extension unloads). */
export function flushDiagnostics(): Promise<void> {
  if (flushTimer) {
    globalThis.clearTimeout(flushTimer);
    flushTimer = 0;
  }
  return flush();
}
