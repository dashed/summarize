const COOKIE_DOMAINS = [".youtube.com", ".google.com"];

export async function exportYouTubeCookies(): Promise<string | null> {
  if (typeof chrome?.cookies?.getAll !== "function") return null;

  const allCookies: chrome.cookies.Cookie[] = [];
  for (const domain of COOKIE_DOMAINS) {
    const cookies = await chrome.cookies.getAll({ domain });
    allCookies.push(...cookies);
  }

  if (allCookies.length === 0) return null;

  const lines = ["# Netscape HTTP Cookie File"];
  for (const c of allCookies) {
    const domain = c.domain;
    const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
    const path = c.path;
    const secure = c.secure ? "TRUE" : "FALSE";
    const expires = Math.floor(c.expirationDate ?? 0);
    lines.push(
      `${domain}\t${includeSubdomains}\t${path}\t${secure}\t${expires}\t${c.name}\t${c.value}`,
    );
  }

  return lines.join("\n") + "\n";
}
