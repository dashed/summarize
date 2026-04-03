const NON_YOUTUBE_TRANSIENT_QUERY_PARAM_PATTERNS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^mkt_tok$/i,
  /^si$/i,
  /^feature$/i,
  /^t$/i,
  /^time_continue$/i,
  /^pp$/i,
  /^download$/i,
];

function shouldDropNonYouTubeQueryParam(key: string): boolean {
  return NON_YOUTUBE_TRANSIENT_QUERY_PARAM_PATTERNS.some((pattern) => pattern.test(key));
}

/** Strip transient query params so history matches the semantic page URL used for restore keys. */
export function canonicalizeUrlForHistory(raw: string): string {
  try {
    const u = new URL(raw);
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

    const keptParams = Array.from(u.searchParams.entries()).filter(
      ([key]) => !shouldDropNonYouTubeQueryParam(key),
    );
    u.search = "";
    for (const [key, value] of keptParams) {
      u.searchParams.append(key, value);
    }
    u.hash = "";
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Returns true if the canonical URL is specific enough for history restore lookups.
 * Bare domains are intentionally skipped to avoid reviving unrelated homepage state.
 */
export function isSpecificEnoughForHistoryLookup(canonical: string): boolean {
  try {
    const u = new URL(canonical);
    if (u.hostname.includes("youtube.com")) {
      if (u.searchParams.get("v")) return true;
      if (u.pathname.startsWith("/shorts/") && u.pathname.length > "/shorts/".length) return true;
      return false;
    }
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.length > 1;
    }
    return u.pathname.length > 1 || u.search.length > 1;
  } catch {
    return canonical.length > 0;
  }
}

export function buildHistoryUrlMetadata(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  return canonicalizeUrlForHistory(raw) || raw;
}
