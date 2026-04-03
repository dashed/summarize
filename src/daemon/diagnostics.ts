import type { SqliteDatabase } from "../cache.js";

export type DiagnosticEvent = {
  timestamp?: number;
  source: string;
  event: string;
  url?: string | null;
  tabId?: number | null;
  sessionId?: string | null;
  detail?: Record<string, unknown> | null;
};

export type DiagnosticEntry = {
  id: number;
  timestamp: number;
  source: string;
  event: string;
  url: string | null;
  tabId: number | null;
  sessionId: string | null;
  detail: Record<string, unknown> | null;
};

export type DiagnosticsStore = {
  log: (event: DiagnosticEvent) => void;
  logBatch: (events: DiagnosticEvent[]) => void;
  query: (opts?: {
    limit?: number;
    offset?: number;
    event?: string;
    source?: string;
    url?: string;
    since?: number;
    until?: number;
  }) => DiagnosticEntry[];
  count: () => number;
  purge: (olderThanMs?: number) => number;
};

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function parseDetail(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toEntry(row: Record<string, unknown>): DiagnosticEntry {
  return {
    id: row.id as number,
    timestamp: row.timestamp as number,
    source: row.source as string,
    event: row.event as string,
    url: (row.url as string) ?? null,
    tabId: typeof row.tab_id === "number" ? row.tab_id : null,
    sessionId: (row.session_id as string) ?? null,
    detail: parseDetail(row.detail),
  };
}

export function createDiagnosticsStore(db: SqliteDatabase): DiagnosticsStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS diagnostic_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      source TEXT NOT NULL,
      event TEXT NOT NULL,
      url TEXT,
      tab_id INTEGER,
      session_id TEXT,
      detail TEXT
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_diag_timestamp ON diagnostic_events(timestamp)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_diag_source ON diagnostic_events(source)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_diag_event ON diagnostic_events(event)");

  const stmtInsert = db.prepare(`
    INSERT INTO diagnostic_events (timestamp, source, event, url, tab_id, session_id, detail)
    VALUES (@timestamp, @source, @event, @url, @tabId, @sessionId, @detail)
  `);

  const stmtCount = db.prepare("SELECT COUNT(*) AS cnt FROM diagnostic_events");

  const stmtPurge = db.prepare("DELETE FROM diagnostic_events WHERE timestamp < ?");

  const insertMany = (events: DiagnosticEvent[]) => {
    const now = Date.now();
    db.exec("BEGIN");
    try {
      for (const ev of events) {
        stmtInsert.run({
          timestamp: ev.timestamp ?? now,
          source: ev.source,
          event: ev.event,
          url: ev.url ?? null,
          tabId: ev.tabId ?? null,
          sessionId: ev.sessionId ?? null,
          detail: ev.detail ? JSON.stringify(ev.detail) : null,
        });
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };

  // Auto-purge events older than 7 days
  stmtPurge.run(Date.now() - SEVEN_DAYS_MS);

  const log = (event: DiagnosticEvent): void => {
    const now = Date.now();
    stmtInsert.run({
      timestamp: event.timestamp ?? now,
      source: event.source,
      event: event.event,
      url: event.url ?? null,
      tabId: event.tabId ?? null,
      sessionId: event.sessionId ?? null,
      detail: event.detail ? JSON.stringify(event.detail) : null,
    });
  };

  const logBatch = (events: DiagnosticEvent[]): void => {
    if (events.length === 0) return;
    insertMany(events);
  };

  const query = (opts?: {
    limit?: number;
    offset?: number;
    event?: string;
    source?: string;
    url?: string;
    since?: number;
    until?: number;
  }): DiagnosticEntry[] => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.event) {
      conditions.push("event = ?");
      params.push(opts.event);
    }
    if (opts?.source) {
      conditions.push("source = ?");
      params.push(opts.source);
    }
    if (opts?.url) {
      conditions.push("url = ?");
      params.push(opts.url);
    }
    if (opts?.since != null) {
      conditions.push("timestamp >= ?");
      params.push(opts.since);
    }
    if (opts?.until != null) {
      conditions.push("timestamp <= ?");
      params.push(opts.until);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;

    const sql = `SELECT * FROM diagnostic_events ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(toEntry);
  };

  const count = (): number => {
    const row = stmtCount.get() as { cnt: number };
    return row.cnt;
  };

  const purge = (olderThanMs?: number): number => {
    const cutoff = Date.now() - (olderThanMs ?? SEVEN_DAYS_MS);
    const result = stmtPurge.run(cutoff) as { changes?: number };
    return typeof result.changes === "number" ? result.changes : 0;
  };

  return { log, logBatch, query, count, purge };
}
