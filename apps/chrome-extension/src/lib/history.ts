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
 * Returns true if the canonical URL is specific enough for a history prefix-match lookup.
 * Bare domains (e.g. "https://www.youtube.com/") and index-like paths (e.g. "/watch" without v=)
 * would match too many entries via the LIKE prefix SQL, so we skip those.
 */
export function isSpecificEnoughForHistoryLookup(canonical: string): boolean {
  try {
    const u = new URL(canonical);
    // YouTube: must have a video ID (?v=) or be a /shorts/ or youtu.be path
    if (u.hostname.includes("youtube.com")) {
      if (u.searchParams.get("v")) return true;
      if (u.pathname.startsWith("/shorts/") && u.pathname.length > "/shorts/".length) return true;
      return false; // homepage, /watch without v=, /feed, etc.
    }
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.length > 1; // must have a video ID in path
    }
    // Non-YouTube: pathname must be more than just "/"
    return u.pathname.length > 1;
  } catch {
    return canonical.length > 0;
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
