/**
 * Shared URL normalization and matching utilities.
 *
 * Strips fragments (#hash) and handles trailing-slash / boundary differences
 * so that `https://example.com/page#s1` matches `https://example.com/page`.
 */

export function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

export function urlsMatch(a: string, b: string): boolean {
  const left = normalizeUrl(a);
  const right = normalizeUrl(b);
  if (left === right) return true;
  const boundaryMatch = (longer: string, shorter: string) => {
    if (!longer.startsWith(shorter)) return false;
    if (longer.length === shorter.length) return true;
    const next = longer[shorter.length];
    return next === "/" || next === "?" || next === "&";
  };
  return boundaryMatch(left, right) || boundaryMatch(right, left);
}
