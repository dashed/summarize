# Repository Audit

Date: 2026-03-07

Scope: full workspace review of the CLI, core library, daemon, browser extension, tests, release flow, and dependency posture.

Method: three parallel sub-reviews (core/CLI, extension/security, build-release-quality), followed by local verification of the highest-signal findings with workspace commands.

## Executive Summary

The repository is in decent shape at the code-organization and test-suite level, but it has several important security and operational issues:

- The extension currently exposes a page-world bridge that lets arbitrary site JavaScript ask the extension to send debugger-backed native input into the current tab.
- The packaged CLI can report the caller's project version instead of Summarize's own version.
- The production dependency tree carries unresolved high and critical vulnerabilities through `@mariozechner/pi-ai`.
- The daemon persists its bearer token and API-key snapshot in plain JSON without explicitly tightening filesystem permissions.
- The extension's lint command is broken, and CI does not enforce the documented full workspace gate.

## Severity Summary

| Severity | Count |
| --- | ---: |
| High | 3 |
| Medium | 6 |
| Low | 4 |

## Findings

### High 1: Untrusted page JavaScript can trigger debugger-backed native input

Impact: any page that can run JavaScript in its own origin can cross the extension boundary and ask the extension to synthesize clicks and keystrokes in that tab, even when the user has not explicitly enabled automation.

Evidence:

- `apps/chrome-extension/src/entrypoints/automation.content.ts:340-360` forwards any `window.postMessage` with `source: "summarize-native-input"` from the page to the extension.
- `apps/chrome-extension/src/entrypoints/automation.content.ts:397-402` installs that bridge on `"<all_urls>"`.
- `apps/chrome-extension/src/entrypoints/background.ts:2242-2258` accepts the forwarded request without checking origin, sender intent, or an "automation enabled" state.
- `apps/chrome-extension/src/entrypoints/background.ts:623-700` turns the request into `chrome.debugger` input events.
- `apps/chrome-extension/wxt.config.ts:63-75` grants `debugger` and `<all_urls>` at install time.

Why this matters: this is a real privilege-boundary failure. A web page should not be able to invoke extension-owned debugger automation simply by posting a magic message shape into `window`.

Recommendation:

- Gate the bridge behind an explicit runtime feature flag.
- Reject page-world requests by default and require a nonce/session token scoped to a user-initiated automation session.
- Move `debugger` to optional permissions if possible, or at minimum require explicit enablement before honoring any native-input message.

### High 2: `--version` can report the caller's project version instead of Summarize's version

Impact: packaged installs can print the wrong version and git SHA when the command runs from another project directory, which breaks supportability and release verification.

Evidence:

- `src/version.ts:9-48` and `src/version.ts:103-158` fall back to `process.cwd()` when `importMetaUrl` is absent.
- `src/run/runner.ts:143-149` and `src/run/slides-cli.ts:76-83` call `formatVersionLine()` without passing `importMetaUrl`.
- Local verification against the built package surface reproduced this: from a temp directory containing `{"version":"999.0.0"}`, `node --input-type=module -e "import { formatVersionLine } from '/home/alberto/github/summarize/dist/esm/version.js'; console.log(formatVersionLine())"` printed `999.0.0`.
- `src/daemon/server.ts` avoids the bug because it passes `import.meta.url` into `buildHealthPayload()`.

Why this matters: the CLI can misidentify itself in precisely the environments where users rely on `--version` for debugging.

Recommendation:

- Pass `import.meta.url` through every CLI version call site.
- Prefer resolving package metadata from the module location, not the current working directory.

### High 3: Production dependencies currently include unresolved high and critical advisories

Impact: the shipped dependency graph includes known supply-chain vulnerabilities, mostly through `@mariozechner/pi-ai`.

Evidence:

- `package.json:57-69` pins `@mariozechner/pi-ai` at `^0.52.12`.
- `pnpm audit --prod --audit-level moderate` reported 8 vulnerabilities: 2 critical, 4 high, 1 moderate, 1 low.
- Reported examples included `basic-ftp`, `fast-xml-parser`, `minimatch`, and `ajv`, all reachable through `@mariozechner/pi-ai`.
- `pnpm outdated -r` shows `@mariozechner/pi-ai` at `0.52.12` with `0.56.3` available.

Why this matters: the repo depends on remote-provider SDKs and model gateways, so carrying stale vulnerable transitives is avoidable risk.

Recommendation:

- Upgrade `@mariozechner/pi-ai` first, then rerun `pnpm audit`.
- If a direct upgrade is blocked, pin/override the vulnerable transitives and document the exception.

### Medium 1: The page-world artifacts bridge exposes extension-owned data to arbitrary sites

Impact: page JavaScript can read, overwrite, and delete extension-managed artifacts for the current tab session.

Evidence:

- `apps/chrome-extension/src/entrypoints/automation.content.ts:363-394` forwards `summarize-artifacts` messages from the page.
- `apps/chrome-extension/src/entrypoints/background.ts:2266-2295` services artifact RPC requests from that bridge.
- `apps/chrome-extension/src/automation/artifacts-store.ts` stores those artifacts in extension storage keyed by tab.

Why this matters: artifacts belong to the extension's automation/session layer, not to untrusted page scripts.

Recommendation:

- Remove the page-world bridge unless there is a strict, authenticated need for it.
- If it must exist, require an explicit session capability and limit the allowed operations.

### Medium 2: The daemon stores bearer tokens and API keys in plain JSON without restrictive file permissions

Impact: the daemon config file can expose the local bearer token and a large API-key snapshot to other local users, depending on filesystem defaults and home-directory permissions.

Evidence:

- `src/daemon/config.ts:82-100` writes `~/.summarize/daemon.json` with `fs.writeFile(...)` and no explicit mode.
- `src/daemon/env-snapshot.ts:1-57` includes a wide set of secrets in that persisted snapshot, including `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `FIRECRAWL_API_KEY`, `APIFY_API_TOKEN`, and more.

Why this matters: this is a local-secret handling issue. The design intentionally persists sensitive material, so the file and directory modes should be tightened deliberately.

Recommendation:

- Create the config directory with `0o700` and the config file with `0o600`.
- Consider splitting short-lived secrets from durable config, or moving secrets into the OS keychain where available.

### Medium 3: Video paths emit unconditional stderr debug logs

Impact: normal runs can leak input URLs, provider-routing details, response metadata, and partial error bodies to stderr even when verbose/debug modes are not enabled.

Evidence:

- `src/llm/generate-text.ts:347-399` logs video URLs and routing decisions via `console.error`.
- `src/llm/providers/openai.ts:271-390` logs model, base URL, provider routing, response status, response-body snippets, and token details.
- `src/llm/providers/openai.ts:453-616` does the same for streaming video requests.
- `src/run/summary-engine.ts:309-331` and `src/run/flows/url/summary.ts:232-286` also emit direct `console.error(...)` diagnostics in video-related paths.

Why this matters: the CLI otherwise has a notion of verbose output. These direct logs bypass it and can pollute automation, JSON-oriented workflows, and privacy-sensitive runs.

Recommendation:

- Route all video/debug output through the existing verbose logger.
- Never print raw URLs, provider payload details, or response fragments unless an explicit debug flag is on.

### Medium 4: History restoration keys are too coarse and can restore stale state

Impact: the extension can restore the wrong summary or chat history on query-driven pages, SPAs, dashboards, or personalized views that reuse the same URL path while changing visible content.

Evidence:

- `apps/chrome-extension/src/lib/history.ts:2-17` collapses all non-YouTube history keys to `origin + pathname`, dropping query params and hashes.
- `src/daemon/server.ts:1683-1739` keys chat history only by `{ url, automationEnabled }`, ignoring `pageContent` even though the daemon receives it elsewhere during chat requests.
- The side panel restores the most recent match for that coarse key, so a page like `...?id=1` can collide with `...?id=2`.

Why this matters: users will see believable but incorrect restored context, which is worse than failing closed.

Recommendation:

- Include a stable content fingerprint or a narrower canonicalization strategy in history keys.
- At minimum, preserve semantically meaningful query params for non-YouTube pages.

### Medium 5: Slide extraction exports the full Google and YouTube cookie jar to the daemon

Impact: enabling slides causes the extension to collect every `.google.com` and `.youtube.com` cookie it can see and forward that jar through the localhost daemon path for `yt-dlp` use.

Evidence:

- `apps/chrome-extension/src/lib/cookies.ts:1-27` collects all cookies for `.youtube.com` and `.google.com`.
- `apps/chrome-extension/src/entrypoints/background.ts:1363-1446` automatically includes that cookie export when slide extraction is enabled.
- `src/daemon/server.ts:771-776` writes the cookie jar to a temp file for downstream processing.

Why this matters: the feature needs some cookie access for slide/video extraction, but the current implementation is much broader than least privilege and moves sensitive Google account state through the daemon boundary.

Recommendation:

- Export only the minimal cookie subset required by the downloader flow.
- Prefer origin- and name-level allowlists over whole-domain dumps.
- Delete temp files aggressively and document the privacy tradeoff in user-facing setup docs.

### Medium 6: Extension quality gates are inconsistent and partially broken

Impact: extension-specific static checks are not currently protecting the codebase, and CI does not fully reflect the documented gate.

Evidence:

- `apps/chrome-extension/package.json:6-17` defines `lint` as `wxt lint`.
- Local verification: `pnpm -C apps/chrome-extension lint` fails with `No entrypoints found in .../apps/chrome-extension/lint/entrypoints`.
- `package.json:34-55` defines the canonical root gate as `pnpm check` (`format:check && lint && test:coverage`).
- `.github/workflows/ci.yml` does not run the extension lint command, and the extension job only builds plus Chromium E2E.
- `vitest.config.ts:53-79` excludes daemon coverage and does not measure the browser extension tree at all.

Why this matters: the repo has strong test volume, but some of the highest-risk surfaces are protected only by integration confidence and local discipline.

Recommendation:

- Fix or replace the extension lint command.
- Make CI run the same gate the repo advertises, or update the docs to match reality.
- Add at least one extension-specific static/type check that runs in CI.

## Low-Severity Observations

### Low 1: Root wrapper modules are unreachable through the package export map

Evidence:

- `src/language.ts` and `src/processes.ts` re-export valid core surfaces.
- `package.json:20-33` only exports `.`, `./content`, and `./prompts`.
- Local verification: `import('@steipete/summarize/language')` and `import('@steipete/summarize/processes')` both fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`, while `import('@steipete/summarize/content')` succeeds.

Recommendation: either publish those wrappers in the export map or remove the dead surfaces.

### Low 2: Release/version metadata is currently not lockstep

Evidence:

- `package.json:2-3` is `0.11.2-fork`.
- `packages/core/package.json:2-3` is `0.11.2`.
- `scripts/release.sh:28-35` requires exact equality and will exit early when versions diverge.
- `apps/chrome-extension/package.json:2-3` still advertises `0.8.0`, while `apps/chrome-extension/wxt.config.ts:5-17` derives the shipped manifest version from the root package and strips the suffix.

Recommendation: either make the fork release flow explicit, or restore a true lockstep versioning contract.

### Low 3: The daemon's localhost surface is detectable from the web

Evidence:

- `src/daemon/server.ts:141-151` reflects arbitrary origins in CORS and enables Private Network Access.
- `src/daemon/server.ts:514-522` leaves `/health` unauthenticated while protecting only `/v1/*`.

Recommendation: this may be an acceptable tradeoff, but it should be a documented privacy choice rather than an accidental side effect.

### Low 4: Firefox release documentation disagrees with the current manifest identity

Evidence:

- `RELEASING.md` describes a UUID-based Firefox identity for self-hosted signing.
- `apps/chrome-extension/wxt.config.ts:107-121` currently sets the Gecko ID to `summarize-test@steipete.com`.

Recommendation: keep the release docs and manifest identity aligned, because AMO signing and update continuity depend on the extension ID remaining stable.

## Validation Notes

Commands run locally:

- `pnpm -s lint` -> passed.
- `pnpm -s build` -> passed.
- `pnpm -s test` -> passed sequentially (`298` files, `1525` tests; `19` files skipped).
- `pnpm -C apps/chrome-extension build` -> passed after the root/core build completed.
- `pnpm -s check` -> failed in this checkout at `format:check`. One failing file was clean and tracked (`tests/link-preview.fetcher.pdf.test.ts`); the others were already-dirty workspace files listed below.
- `pnpm audit --prod --audit-level moderate` -> failed with the vulnerability set described above.
- `pnpm outdated -r` -> confirmed several lagging dependencies, especially `@mariozechner/pi-ai`.
- `pnpm -C apps/chrome-extension lint` -> failed because the configured `wxt lint` path is broken.
- `pnpm -C apps/chrome-extension test:chrome` -> not a useful product signal in this environment because Playwright Chromium was not installed locally (`Executable doesn't exist ... chromium-1208/.../chrome`).

Important note: I initially ran some build/test commands in parallel, which transiently broke imports because `pnpm build` runs `pnpm clean` and removes `packages/core/dist`. I did not count those transient failures as repository defects; all functional findings above were re-verified after rerunning commands sequentially.

## Strengths

- The root/core split is mostly clean and understandable.
- The repository has substantial targeted automated coverage, and the main Node/Vitest suite is healthy when run sequentially.
- The extension build is reproducible once the workspace build artifacts are in place.

## Prioritized Next Steps

1. Remove or hard-gate the page-world native-input bridge.
2. Fix CLI version reporting by threading `import.meta.url` into every `formatVersionLine()` call site.
3. Upgrade `@mariozechner/pi-ai` and re-run `pnpm audit`.
4. Lock down daemon secret persistence (`0o700` directory, `0o600` file, or keychain storage).
5. Fix extension linting and align CI with the documented gate.
6. Tighten history keying so stale summaries/chats are not restored across different content.

## Ignored Existing Changes

Per workspace instructions, I ignored these pre-existing modifications while preparing the audit:

- `apps/chrome-extension/src/entrypoints/sidepanel/main.ts`
- `apps/chrome-extension/src/lib/history.ts`
- `tests/cache.list-entries.test.ts`
- `tests/chrome.history.test.ts`
- `tests/sidepanel.panel-cache.test.ts`
