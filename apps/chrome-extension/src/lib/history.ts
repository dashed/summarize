/** Strip transient query params (t, si, feature) so history matches the canonical URL. */
export function canonicalizeUrlForHistory(raw: string): string {
  try {
    const u = new URL(raw);
    // YouTube: keep only the v= param (or /shorts/ path)
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
      const videoId = u.searchParams.get("v");
      if (videoId) {
        u.search = `?v=${videoId}`;
      } else {
        u.search = "";
      }
      u.hash = "";
      return u.toString();
    }
    // Non-YouTube: keep origin + pathname (strip all query/hash)
    return u.origin + u.pathname;
  } catch {
    return raw;
  }
}

/**
 * Extract display-ready title and model from daemon history summary metadata.
 * Used when restoring summaries from history (both manual load and automatic fallback).
 */
export function parseSummaryHistoryMeta(metadata: Record<string, unknown> | null): {
  title: string;
  model: string | null;
} {
  const meta = metadata ?? {};
  return {
    title: String(meta.title || meta.url || "Summary"),
    model: typeof meta.model === "string" ? meta.model : null,
  };
}
