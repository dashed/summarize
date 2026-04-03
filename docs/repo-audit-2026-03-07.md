# Repository Audit

Date: 2026-03-07

Scope: full workspace review of the CLI, core library, daemon, browser extension, tests, release flow, and dependency posture.

Method: three parallel sub-reviews (core/CLI, extension/security, build-release-quality), followed by local verification of the highest-signal findings with workspace commands.

## Status Update

Status on the current branch after follow-up remediation work:

- Resolved: High 1 (`summarize-native-input` page-world bridge).
- Resolved: Medium 1 (`summarize-artifacts` page-world bridge).
- Resolved: Medium 4 (history restoration keys / stale restore collisions).
- Resolved: Medium 6 (extension quality gates / broken lint path).
- Added regression coverage for both removed bridges in the extension security tests.
- Added regression coverage for canonical history matching and content-aware chat history keys.
- Replaced the broken extension `wxt lint` command with a deterministic type-aware `oxlint` gate, and CI now runs the documented root gate plus an extension-specific static check.

## Executive Summary

The repository is in decent shape at the code-organization and test-suite level, but it has several important security and operational issues:

- The highest-risk extension page-world bridges identified in the initial audit have now been removed and covered by regression tests.
- History restore and chat persistence now key off canonical URLs plus richer content identity, which closes the stale-state collision called out below.
- The packaged CLI can report the caller's project version instead of Summarize's own version.
- The production dependency tree carries unresolved high and critical vulnerabilities through `@mariozechner/pi-ai`.
- The daemon persists its bearer token and API-key snapshot in plain JSON without explicitly tightening filesystem permissions.
- The extension now has a working static gate, and CI now runs both the documented root gate and an extension-specific check.

## Open Severity Summary

| Severity | Count |
| -------- | ----: |
| High     |     2 |
| Medium   |     3 |
| Low      |     4 |

## Findings

### High 1 (Resolved): Untrusted page JavaScript can trigger debugger-backed native input

Status: resolved on the current branch.

Evidence:

- `apps/chrome-extension/src/entrypoints/automation.content.ts:340-374` no longer installs any `window.postMessage` bridge for native input or artifacts.
- `apps/chrome-extension/src/entrypoints/background.ts:687-735` now accepts automation/artifact RPCs only through `chrome.runtime.onUserScriptMessage`.
- `apps/chrome-extension/src/automation/repl.ts:210-315` sends automation RPCs through trusted user-script runtime messaging with `configureWorld({ messaging: true })`.
- `tests/chrome.user-script-requests.test.ts:8-39` covers missing-tab rejection and native-input dispatch at the request handler layer.
- `apps/chrome-extension/tests/native-input.security.spec.ts:150-246` verifies page JavaScript no longer gets a reply from the deleted `summarize-native-input` bridge.

Why this mattered: this was a real privilege-boundary failure. A web page should not be able to invoke extension-owned debugger automation simply by posting a magic message shape into `window`.

Resolution:

- The page-world bridge was removed.
- Trusted automation now runs only through the user-script messaging path.
- Regression tests were added so the old attack shape does not silently come back.

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

### Medium 1 (Resolved): The page-world artifacts bridge exposes extension-owned data to arbitrary sites

Status: resolved on the current branch.

Evidence:

- `apps/chrome-extension/src/entrypoints/automation.content.ts:340-374` no longer forwards any `summarize-artifacts` page messages.
- `apps/chrome-extension/src/entrypoints/background.ts:699-729` only handles artifact RPCs through `chrome.runtime.onUserScriptMessage`.
- `tests/chrome.user-script-requests.test.ts:41-106` covers artifact list/get handling on the trusted request path.
- `apps/chrome-extension/tests/native-input.security.spec.ts:248-345` seeds extension-owned artifacts, attempts the old page-world `summarize-artifacts` request, and verifies there is no reply and no storage change.

Why this mattered: artifacts belong to the extension's automation/session layer, not to untrusted page scripts.

Resolution:

- The page-world artifacts bridge was removed.
- Artifact RPCs now use the same trusted user-script messaging path as native automation.
- Regression coverage now checks that arbitrary page JavaScript cannot read extension-owned artifacts through the old bridge shape.

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

### Medium 4 (Resolved): History restoration keys were too coarse and could restore stale state

Status: resolved on the current branch.

Evidence:

- `src/shared/history.ts` now preserves semantically meaningful non-YouTube query params, strips tracking-only params, and provides a shared canonical history URL.
- `src/run/flows/url/summary.ts` and `src/run/flows/asset/summary.ts` now persist `metadata.historyUrl` so history restore can match canonical URLs exactly.
- `src/cache.ts` supports canonical history lookup mode, and the sidepanel restore path now requests `match=canonical` instead of relying on broad prefix matching.
- `src/daemon/history.ts` and `src/daemon/server.ts` now key daemon chat history by canonical URL, automation state, and a content fingerprint derived from `cacheContent` / `pageContent`.
- `apps/chrome-extension/src/entrypoints/sidepanel/chat-history-store.ts` and `apps/chrome-extension/src/entrypoints/sidepanel/main.ts` now scope local chat restore keys to `tabId + canonicalUrl`, instead of `tabId` alone.
- Regression coverage now exists in:
  - `tests/chrome.history.test.ts`
  - `tests/cache.list-entries.test.ts`
  - `tests/daemon.history-api.test.ts`
  - `tests/sidepanel.chat-history-store.test.ts`
  - `apps/chrome-extension/tests/extension.spec.ts` (canonical URL restore request)

Why this mattered: query-driven pages and same-path content revisions could otherwise restore believable but wrong summaries or chat threads.

Resolution:

- Canonical summary restore now preserves meaningful query identity and matches the persisted `historyUrl`.
- Daemon chat history now distinguishes same-URL pages by content fingerprint.
- The sidepanel session cache now restores local chat only for the exact current canonical URL.

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

### Medium 6 (Resolved): Extension quality gates were inconsistent and partially broken

Status: resolved on the current branch.

Evidence:

- `apps/chrome-extension/package.json` no longer points `lint` at `wxt lint`; it now runs a deterministic type-aware `oxlint` check over the extension source, tests, `wxt.config.ts`, and `playwright.config.ts`.
- `apps/chrome-extension/tsconfig.check.json` provides a dedicated config for the extension static check path instead of relying on WXT's broken lint entrypoint behavior.
- `package.json` now exposes `pnpm check:extension` while preserving `pnpm check` as the documented root gate.
- `.github/workflows/ci.yml` now runs `pnpm -s check` in the main job and `pnpm -s check:extension` in the Chromium extension job before build/E2E.
- Local verification: `pnpm -C apps/chrome-extension lint` now passes.

Why this mattered: the repo had strong runtime coverage, but the extension's local static gate was effectively dead, and CI was not actually running the documented root gate.

Resolution:

- Replaced the broken extension lint command with a working extension-specific static gate.
- Aligned CI with the advertised root `pnpm check` command.
- Added an extension-specific CI static check without duplicating it across the Node version matrix.

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
- `pnpm -s test` -> passed sequentially (`300` files passed, `19` skipped; `1540` tests passed, `31` skipped).
- `pnpm -s check:extension` -> passed.
- `pnpm -C apps/chrome-extension build` -> passed after the root/core build completed.
- `pnpm -C apps/chrome-extension test:e2e` -> passed in this environment with `45` tests skipped. The suite now detects unsupported local Chromium hosts and skips cleanly instead of failing at browser startup.
- `pnpm -s check` -> failed in this checkout at `format:check` because of already-dirty workspace files: `apps/chrome-extension/src/automation/user-script-requests.ts`, `apps/chrome-extension/tests/native-input.security.spec.ts`, and `tests/link-preview.fetcher.pdf.test.ts`.
- `pnpm audit --prod --audit-level moderate` -> failed with the vulnerability set described above.
- `pnpm outdated -r` -> confirmed several lagging dependencies, especially `@mariozechner/pi-ai`.
- `pnpm -C apps/chrome-extension lint` -> passed after replacing the broken `wxt lint` path with the explicit extension static gate.

Important note: I initially ran some build/test commands in parallel, which transiently broke imports because `pnpm build` runs `pnpm clean` and removes `packages/core/dist`. I did not count those transient failures as repository defects; all functional findings above were re-verified after rerunning commands sequentially.

## Strengths

- The root/core split is mostly clean and understandable.
- The repository has substantial targeted automated coverage, and the main Node/Vitest suite is healthy when run sequentially.
- The extension build is reproducible once the workspace build artifacts are in place.

## Prioritized Next Steps

1. Fix CLI version reporting by threading `import.meta.url` into every `formatVersionLine()` call site.
2. Upgrade `@mariozechner/pi-ai` and re-run `pnpm audit`.
3. Lock down daemon secret persistence (`0o700` directory, `0o600` file, or keychain storage).
4. Fix extension linting and align CI with the documented gate.
5. Tighten history keying so stale summaries/chats are not restored across different content.

## Ignored Existing Changes

Per workspace instructions, I ignored these pre-existing modifications while preparing the audit:

- `apps/chrome-extension/src/entrypoints/sidepanel/main.ts`
- `apps/chrome-extension/src/lib/history.ts`
- `tests/cache.list-entries.test.ts`
- `tests/chrome.history.test.ts`
- `tests/sidepanel.panel-cache.test.ts`
