# RFC: Chrome Extension Cookie Passthrough for yt-dlp

## Summary

Add built-in cookie passthrough from the Chrome extension to the daemon so
yt-dlp can authenticate with YouTube for age-restricted and login-required
content. The extension uses `chrome.cookies.getAll()` to read decrypted cookies
directly from the browser, sends them in the request body, and the daemon writes
a temporary Netscape cookie file for yt-dlp's `--cookies` flag.

This eliminates the need for `--cookies-from-browser`, which fails on WSL and
other environments where browser cookie databases are locked or use unsupported
encryption (Chromium v20).

## Motivation

### The Problem

The current approach requires users to set
`SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER` (e.g., `chrome`, `edge:<path>`), which
tells yt-dlp to read the browser's cookie database directly. This fails in
several common scenarios:

1. **Windows file locks (WSL)**: Chrome and Edge lock their `Cookies` SQLite
   database while running. On WSL, the lock is enforced at the Windows filesystem
   level — even `cp` fails with `Permission denied`:

   ```
   ERROR: [Errno 13] Permission denied:
     '/mnt/c/Users/.../Google/Chrome/User Data/Default/Network/Cookies'
   ```

2. **Chromium v20 cookie encryption**: Newer Chromium versions (Chrome 130+,
   Edge 130+) use v20 cookie encryption that yt-dlp cannot decrypt:

   ```
   WARNING: unknown cookie version: "b'v20'"
   ERROR: [youtube] Sign in to confirm your age.
   ```

   yt-dlp reads the database but the cookie values are gibberish.

3. **Configuration burden**: Users must close their browser, set env vars,
   reinstall the daemon, and manage different browser paths per OS. This is a
   poor experience for a feature that should "just work."

### The Insight

The Chrome extension is already running **inside** the browser. It has direct
access to decrypted cookies via the `chrome.cookies` API — no file locks, no
encryption, no external tools. The cookies are already in memory, ready to use.

## Current Architecture

```
Extension                     Daemon                          yt-dlp
    |                            |                               |
    |-- POST /v1/summarize ----->|                               |
    |   { url, slides: true }   |                               |
    |                            |-- reads env var:              |
    |                            |   YT_DLP_COOKIES_FROM_BROWSER |
    |                            |                               |
    |                            |-- spawn yt-dlp -------------->|
    |                            |   --cookies-from-browser edge |
    |                            |                               |
    |                            |   FAILS: locked DB or v20     |
```

### Relevant Code Paths

| File                                                       | Role                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/chrome-extension/src/lib/daemon-payload.ts`          | Builds the POST body sent to the daemon                          |
| `apps/chrome-extension/src/entrypoints/background.ts:899`  | Sends extract request with `slides: true`                        |
| `apps/chrome-extension/src/entrypoints/background.ts:1461` | Sends parallel slides request                                    |
| `src/daemon/server.ts:705`                                 | Parses the request body                                          |
| `src/daemon/flow-context.ts:186,438`                       | Threads `ytDlpCookiesFromBrowser` into the flow                  |
| `src/slides/extract.ts:80-83`                              | `buildYtDlpCookiesArgs()` — builds `--cookies-from-browser` args |
| `src/slides/extract.ts:121`                                | `ExtractSlidesArgs.ytDlpCookiesFromBrowser`                      |
| `src/slides/extract.ts:746-758`                            | `downloadYoutubeVideo()` — invokes yt-dlp                        |
| `src/run/run-env.ts:100-108`                               | Reads `SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER` from env           |
| `src/daemon/env-snapshot.ts:27-28`                         | Snapshots cookie env vars into `daemon.json`                     |

## Proposed Design

```
Extension                          Daemon                         yt-dlp
    |                                 |                              |
    |-- chrome.cookies.getAll() -->   |                              |
    |   .youtube.com, .google.com     |                              |
    |                                 |                              |
    |-- POST /v1/summarize ---------> |                              |
    |   { url, slides: true,         |                              |
    |     cookies: "# Netscape..." } |                              |
    |                                 |                              |
    |                                 |-- write /tmp/cookies-xxx.txt |
    |                                 |-- spawn yt-dlp ------------> |
    |                                 |   --cookies /tmp/cookies.txt |
    |                                 |                              |
    |                                 |-- rm /tmp/cookies-xxx.txt    |
```

### Priority / Fallback Order

1. **Per-request cookies** from extension → `--cookies <tempfile>` (preferred)
2. **`SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER`** env var → `--cookies-from-browser` (CLI fallback)
3. **No cookies** (works for non-restricted content)

Per-request cookies take priority because they are always fresh, always
decrypted, and never locked.

## Detailed Changes

### 1. Extension Manifest — `apps/chrome-extension/wxt.config.ts`

Add `"cookies"` to the permissions array:

```diff
 permissions: [
   "tabs",
   "activeTab",
   "storage",
   ...(browser === "firefox" ? [] : ["sidePanel" as const]),
   "webNavigation",
   "scripting",
   "windows",
+  "cookies",
   ...(browser === "firefox" ? [] : ["debugger" as const]),
 ],
```

The extension already has `host_permissions: ["<all_urls>"]`, which satisfies
the domain-level requirement for `chrome.cookies.getAll()`.

### 2. New Module — `apps/chrome-extension/src/lib/cookies.ts`

Exports YouTube/Google cookies as a Netscape cookie jar string.

```ts
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
```

### 3. Request Payload — `apps/chrome-extension/src/lib/daemon-payload.ts`

Add an optional `cookies` field to the request builders:

```diff
 export function buildSummarizeRequestBody({
   extracted,
   settings,
   noCache,
   inputMode,
   timestamps,
   slides,
+  cookies,
 }: {
   extracted: ExtractedPage;
   settings: Settings;
   noCache?: boolean;
   inputMode?: "page" | "video";
   timestamps?: boolean;
   slides?: { enabled: boolean; ocr?: boolean; ... };
+  cookies?: string | null;
 }): Record<string, unknown> {
   // ... existing logic ...
-  return slidesEnabled ? { ...withTimestamps, ...slidesSettings } : withTimestamps;
+  const base = slidesEnabled ? { ...withTimestamps, ...slidesSettings } : withTimestamps;
+  return cookies ? { ...base, cookies } : base;
 }
```

### 4. Extension Background — `apps/chrome-extension/src/entrypoints/background.ts`

Before sending slides requests, export cookies and include them in the body.
This applies to the three fetch sites that include slides:

- **Line ~899** — extract-only request with `slides: true`
- **Line ~1461** — parallel slides request via `buildSummarizeRequestBody`
- **Line ~2081** — automation/chat slides request

Example change for the extract request (~899):

```diff
+import { exportYouTubeCookies } from "../lib/cookies";

 // Before the fetch:
+const cookies = wantsSlides ? await exportYouTubeCookies() : null;

 res = await fetch("http://127.0.0.1:8787/v1/summarize", {
   method: "POST",
   headers: { ... },
   body: JSON.stringify({
     url: tab.url,
     mode: "url",
     extractOnly: true,
     timestamps: true,
     ...(wantsSlides ? { slides: true } : {}),
+    ...(cookies ? { cookies } : {}),
     maxCharacters: null,
   }),
 });
```

For the `buildSummarizeRequestBody` calls, pass `cookies` through:

```diff
 const slidesBody = buildSummarizeRequestBody({
   extracted: resolvedPayload,
   settings,
   noCache: Boolean(opts?.refresh),
   inputMode: effectiveInputMode,
   timestamps: slidesTimestamps,
   slides: slidesConfig,
+  cookies,
 });
```

### 5. Daemon Server — `src/daemon/server.ts`

Read the `cookies` field from the request body. If present, write to a temp file
and pass the path to the flow context.

```diff
 // In the request handler (~line 705):
 const modelOverride = typeof obj.model === "string" ? obj.model.trim() : null;
+const cookiesRaw = typeof obj.cookies === "string" ? obj.cookies : null;
```

Write the temp file and clean up after the request:

```ts
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

async function writeTempCookieFile(cookies: string): Promise<string> {
  const filePath = join(tmpdir(), `summarize-cookies-${randomUUID()}.txt`);
  await writeFile(filePath, cookies, "utf8");
  return filePath;
}

// In request handler:
let cookiesFilePath: string | null = null;
try {
  if (cookiesRaw) {
    cookiesFilePath = await writeTempCookieFile(cookiesRaw);
  }
  // ... existing flow (pass cookiesFilePath to flow context) ...
} finally {
  if (cookiesFilePath) {
    unlink(cookiesFilePath).catch(() => {});
  }
}
```

### 6. Flow Context — `src/daemon/flow-context.ts`

Thread `ytDlpCookiesFile` alongside `ytDlpCookiesFromBrowser`:

```diff
 // In createDaemonUrlFlowContext and related functions:
+ytDlpCookiesFile,
 ytDlpCookiesFromBrowser,
```

### 7. Slides Extractor — `src/slides/extract.ts`

Update the args type and cookie resolution:

```diff
 type ExtractSlidesArgs = {
   source: SlideSource;
   settings: SlideSettings;
   // ...
   ytDlpCookiesFromBrowser?: string | null;
+  ytDlpCookiesFile?: string | null;
   // ...
 };
```

Update `buildYtDlpCookiesArgs` to prefer file-based cookies:

```diff
-function buildYtDlpCookiesArgs(cookiesFromBrowser?: string | null): string[] {
-  const value = typeof cookiesFromBrowser === "string" ? cookiesFromBrowser.trim() : "";
-  return value.length > 0 ? ["--cookies-from-browser", value] : [];
-}
+function buildYtDlpCookiesArgs({
+  cookiesFile,
+  cookiesFromBrowser,
+}: {
+  cookiesFile?: string | null;
+  cookiesFromBrowser?: string | null;
+}): string[] {
+  // Prefer file-based cookies (from extension passthrough)
+  if (typeof cookiesFile === "string" && cookiesFile.trim().length > 0) {
+    return ["--cookies", cookiesFile.trim()];
+  }
+  // Fall back to browser-based cookies (from env var)
+  const browser = typeof cookiesFromBrowser === "string" ? cookiesFromBrowser.trim() : "";
+  return browser.length > 0 ? ["--cookies-from-browser", browser] : [];
+}
```

Update all call sites of `buildYtDlpCookiesArgs` (lines 326, 355, 378, 407,
758, 948) to pass the new shape:

```diff
-...buildYtDlpCookiesArgs(cookiesFromBrowser),
+...buildYtDlpCookiesArgs({ cookiesFile, cookiesFromBrowser }),
```

### 8. URL Flow Types — `src/run/flows/url/types.ts`

```diff
 ytDlpCookiesFromBrowser: string | null;
+ytDlpCookiesFile?: string | null;
```

## Request Schema Change

The `POST /v1/summarize` body gains one optional field:

| Field     | Type                  | Description                                                                                             |
| --------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| `cookies` | `string \| undefined` | Netscape cookie jar content. When present, written to a temp file and passed to yt-dlp via `--cookies`. |

Example request body (abbreviated):

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "mode": "url",
  "slides": true,
  "model": "auto",
  "cookies": "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tvalue...\n"
}
```

## Cookie Format

The [Netscape cookie file format](http://www.cookiecentral.com/faq/#3.5) is a
tab-separated text file:

```
# Netscape HTTP Cookie File
.youtube.com	TRUE	/	TRUE	1735689600	SID	FgJ2...
.youtube.com	TRUE	/	TRUE	1735689600	HSID	AeL...
.google.com	TRUE	/	TRUE	1735689600	NID	511=...
```

Fields: `domain`, `include_subdomains`, `path`, `secure`, `expires`, `name`,
`value`.

This is the same format yt-dlp expects for `--cookies <file>`.

## Security Considerations

- **Transport**: Cookies travel over `http://127.0.0.1:8787` (localhost only).
  This is the same transport used for all extension-daemon communication,
  including the auth token. No cookies leave the machine.
- **Auth**: The daemon requires `Authorization: Bearer <token>` on every
  request. Unauthenticated requests cannot inject cookies.
- **Temp file lifetime**: Cookie files are written to `/tmp/` with a random UUID
  name and deleted in a `finally` block immediately after yt-dlp exits. The
  window of exposure is seconds.
- **Scope**: Only `.youtube.com` and `.google.com` cookies are exported. The
  extension does not export all browser cookies.
- **No persistence**: Cookies are per-request and never written to `daemon.json`
  or any persistent store.

## Backwards Compatibility

- The `cookies` field is optional. Existing clients (older extensions, CLI) that
  don't send it continue to work exactly as before.
- `SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER` continues to work as a fallback.
- CLI users are unaffected — this change only adds a new code path.
- The `"cookies"` permission will trigger a Chrome permission prompt on
  extension update. The permission description is "Read and change all your
  data on all websites" (already covered by `host_permissions: ["<all_urls>"]`).
  Chrome may not show an additional prompt since the host permissions already
  grant equivalent access.

## Testing

### Unit Tests

- `buildYtDlpCookiesArgs({ cookiesFile: "/tmp/x.txt" })` →
  `["--cookies", "/tmp/x.txt"]`
- `buildYtDlpCookiesArgs({ cookiesFromBrowser: "edge" })` →
  `["--cookies-from-browser", "edge"]`
- `buildYtDlpCookiesArgs({ cookiesFile: "/tmp/x.txt", cookiesFromBrowser: "edge" })` →
  `["--cookies", "/tmp/x.txt"]` (file takes priority)
- `buildYtDlpCookiesArgs({})` → `[]`

### Extension Tests

- `exportYouTubeCookies()` returns valid Netscape format when cookies exist.
- `exportYouTubeCookies()` returns `null` when no YouTube cookies are present.
- `buildSummarizeRequestBody` includes `cookies` field when provided.
- `buildSummarizeRequestBody` omits `cookies` field when null.

### Integration Tests

- Daemon writes temp cookie file when `cookies` field is present in request.
- Temp cookie file is cleaned up after request completes.
- Temp cookie file is cleaned up even if yt-dlp fails.
- yt-dlp receives `--cookies <path>` when cookies are provided.
- yt-dlp receives `--cookies-from-browser` when no cookies but env var is set.

### Manual Testing

- Age-restricted YouTube video extracts slides successfully with extension.
- Non-age-restricted YouTube video works with and without cookies.
- CLI usage without extension still works via env var.
- Slides work when `SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER` is unset and
  extension provides cookies.

## Alternatives Considered

| Approach                                                 | Pros                                                      | Cons                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **`--cookies-from-browser`** (current)                   | No code changes                                           | Fails on WSL (file locks), fails with v20 encryption, requires browser to be closed |
| **Manual cookie file export**                            | Simple, no extension changes                              | Poor UX, cookies expire, requires external tool                                     |
| **Daemon endpoint for cookie push** (`POST /v1/cookies`) | Persistent, works across requests                         | Extra endpoint, stale cookie risk, more complex                                     |
| **Extension cookie passthrough** (this RFC)              | Always fresh, no locks, no encryption issues, zero config | Slightly larger request body (~2-5 KB), requires `"cookies"` permission             |
| **rookiepy / browser cookie library**                    | Works without browser running                             | Still fails with v20, requires Python dep                                           |

## Open Questions

1. **Firefox support**: Firefox uses `browser.cookies.getAll()` with the same
   API shape. Should the `cookies.ts` helper support both `chrome.cookies` and
   `browser.cookies`? (WXT likely polyfills this already.)

2. **Cookie refresh interval**: Should the extension cache the exported cookies
   for a short period (e.g., 60 seconds) to avoid calling `chrome.cookies.getAll()`
   on every request, or is per-request acceptable? YouTube cookies are small
   (~2-5 KB) and the API is fast, so per-request is likely fine.

3. **Non-YouTube sites**: Should the cookie export be scoped to YouTube/Google
   only, or should it be generic (export cookies matching the request URL
   domain)? Starting with YouTube-only is safest; generalization can come later.

4. **CLI cookie file support**: Should the CLI also gain a `--cookies <file>`
   flag for parity? This is orthogonal to this RFC but could share the same
   `buildYtDlpCookiesArgs` changes.
