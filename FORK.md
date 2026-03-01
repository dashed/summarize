# Fork: dashed/summarize

Fork of [steipete/summarize](https://github.com/steipete/summarize) focused on **YouTube/video multimodal support**, **Gemini reasoning tokens**, and **Chrome extension UX improvements**.

**Version:** `0.11.2-fork` (25 commits ahead of upstream)

---

## What's Different

### 1. YouTube/Video Multimodal Support

The centerpiece of this fork. Sends actual YouTube video URLs and slide images directly to multimodal models (Gemini Flash 3 via OpenRouter) instead of relying solely on text extraction.

**Key capabilities:**
- **`video_url` passthrough** — YouTube URLs sent as `video_url` content parts to Gemini, enabling visual understanding of video content
- **Interleaved `PromptPart` type** — New type system (`text | image | video_url`) for composing multimodal prompts that flow through the entire LLM pipeline
- **Gemini timestamp pre-pass** — Replaces ffmpeg scene detection. Sends video URL to Gemini Flash 3 with a JSON schema response format to extract structured timestamps. Runs in parallel with yt-dlp download (zero added latency)
- **Tesseract OCR elimination** — When Gemini pre-pass succeeds, its visual descriptions are used directly as slide `ocrText`, skipping Tesseract entirely
- **Raw fetch bypass** — pi-ai SDK has no video content type, so `video_url` payloads use direct OpenAI-compatible `fetch()` calls (`completeOpenAiTextWithVideo`, `streamOpenAiTextWithVideo`)
- **Provider routing** — All `video_url` payloads force Google AI Studio via OpenRouter provider routing (Vertex doesn't support YouTube video_url parts)
- **Cookie passthrough** — Chrome extension cookies exported in Netscape format for yt-dlp, enabling age-restricted video access
- **Agent chat video** — `streamAgentWithVideo()` sends video_url parts in agent/chat mode

**Environment variables:**
- `SUMMARIZE_SLIDES_MULTIMODAL` — Gate sending slide images to model (default: `true`)
- `SUMMARIZE_SLIDES_VIDEO` — Gate sending video_url to model (default: `true`)

**Key files:**
- `src/llm/prompt.ts` — `PromptPart` type, `hasVideoUrlParts()`, `stripVideoUrlParts()`
- `src/llm/generate-text.ts` — Video routing in `generateTextWithModelId` and `streamTextWithModelId`
- `src/llm/providers/openai.ts` — `completeOpenAiTextWithVideo()`, `streamOpenAiTextWithVideo()`, `getVideoTimestampsFromGemini()`
- `src/slides/extract.ts` — Gemini timestamp pre-pass, OCR skip, cookie passthrough
- `src/daemon/agent.ts` — `streamAgentWithVideo()`, video_url in agent chat
- `apps/chrome-extension/src/lib/cookies.ts` — Chrome cookie export for yt-dlp

---

### 2. Reasoning Tokens / Gemini Thinking

Auto-enables reasoning/thinking tokens for Gemini thinking models across all LLM call paths.

- `isGeminiThinkingModel()` detects models containing `gemini-3` or `gemini-2.5-flash`
- `resolveEffectiveReasoning()` auto-sets `"high"` reasoning effort for detected models
- Threaded through pi-ai SDK (`reasoning` option), raw fetch (`reasoning: { effort }` payload), and agent chat
- Uses OpenRouter's unified `reasoning: { effort }` format

**Key files:**
- `src/llm/generate-text.ts` — Detection and resolution functions, param threading
- `src/llm/providers/openai.ts` — `reasoning: { effort }` in raw fetch payloads
- `src/daemon/agent.ts` — Reasoning in agent streaming and completion

---

### 3. Chrome Extension UX

- **Live progress bar** — Maps daemon SSE status events to pipeline stages (connecting → fetching → extracting → processing → summarizing → complete). Deterministic progress replaces indeterminate animation
- **Elapsed timer** — Live timer updates every 100ms during summarization
- **Daemon status footer** — Shows daemon version + commit hash (e.g. `v0.11.2-fork . 35be332`) with green/red connection indicator
- **Mode display** — Active source (Page/Video/Video + Slides) shown on Summarize button
- **Abort on tab switch** — SSE stream aborted when tab/URL changes to prevent stale content
- **Auto-restore on tab switch back** — When switching back to a tab that had an in-progress summarization, the extension reconnects to the daemon's SSE replay endpoint to restore the completed summary without requiring a manual Summarize click. Panel cache is saved before aborting streams so the `runId` is preserved across tab switches

**Key files:**
- `apps/chrome-extension/src/entrypoints/sidepanel/progress-stages.ts` — Pipeline stage resolution
- `apps/chrome-extension/src/entrypoints/sidepanel/main.ts` — Progress bar, timer, status bar
- `apps/chrome-extension/src/entrypoints/sidepanel/style.css` — UI styling
- `apps/chrome-extension/src/entrypoints/sidepanel/panel-cache.ts` — `resolveRestoreAction()` for tab-switch restore decisions
- `apps/chrome-extension/src/entrypoints/sidepanel/pickers.tsx` — Mode display on button

---

### 4. Cache Improvements

- **Metadata column** — SQLite `metadata TEXT` column added via `ALTER TABLE` migration. Stores model, length, language, URL, prompt, system prompt, content stats, video duration, and max tokens as JSON
- **Cache on refresh** — "Clear and refresh" (bypass mode) now skips cache reads but still persists the fresh summary. Achieved by splitting into `cacheStoreForRead` (null in bypass) and `cacheStoreForWrite` (always available)
- **10 e2e cache tests** — TTL, eviction, metadata, special chars, all cache kinds

**Key files:**
- `src/cache.ts` — `CacheMetadata` type, ALTER TABLE migration
- `src/daemon/server.ts` — Keep cache store in bypass mode
- `src/run/flows/url/summary.ts` — Read/write split, enriched metadata at write site
- `src/run/flows/asset/summary.ts` — Same read/write split

---

### 5. Prompt Quality

- **Content extraction reframe** — System prompt changed from "summarization engine" to "content extraction engine" for video content. YouTube audience reframed from "curious Twitter users" to "readers who want full video content in text form"
- **Comprehensive video coverage** — New instructions: cover entire video evenly, expand visual descriptions for sparse-transcript videos, at least one timestamp per 1-2 minutes, narrate visual content for gameplay/screen recordings
- **Curated token budgets** — Replaces `chars/4` heuristic with `SUMMARY_LENGTH_TO_TOKENS` map. XXL fixed from 5,500 to 12,288 tokens. Content-length hard cap relaxed for video/transcript content

**Key files:**
- `packages/core/src/prompts/summary-system.ts` — System prompt reframe
- `packages/core/src/prompts/link-summary.ts` — Video prompt instructions, timestamp coverage
- `packages/core/src/prompts/summary-lengths.ts` — Token budget map

---

### 6. Debug/Logging Infrastructure

- **Request dump system** — Full LLM request payloads saved to `~/.summarize/debug/` as JSON with ready-to-paste curl replay commands. Gated behind `SUMMARIZE_DEBUG_DUMP=true`
- **`[video-debug]` logging** — Prefixed logs throughout the pipeline for `journalctl | grep video-debug` filtering

**Key files:**
- `src/debug/request-dump.ts` — Request dump with curl replay generation
- `src/daemon/env-snapshot.ts` — `SUMMARIZE_DEBUG_DUMP` in daemon env snapshot

---

## Commits

25 commits ahead of upstream, oldest to newest:

| # | Hash | Subject | Area |
|---|------|---------|------|
| 1 | `fa8441f` | feat: pass Chrome extension cookies to yt-dlp for age-restricted videos | Video |
| 2 | `4768c4b` | fix: apply snapshot PATH to daemon process.env and add yt-dlp JS solver | Bug Fix |
| 3 | `a321fc5` | feat: show selected mode on Summarize button and fix manifest version | Extension UX |
| 4 | `c57b52f` | feat: multimodal slides, YouTube chapters, and video URL passthrough for Gemini | Video |
| 5 | `d1bcef8` | feat: capture multimodal env vars in daemon snapshot | Video |
| 6 | `d72c2a8` | feat: fix streaming video URL passthrough and add comprehensive logging | Video |
| 7 | `8f9d486` | fix: inject video_url even when slide images aren't ready | Video |
| 8 | `b0197c3` | feat: replace ffmpeg scene detection with Gemini timestamp pre-pass for YouTube | Video |
| 9 | `35be332` | fix: abort SSE stream on tab/URL switch to prevent stale content | Extension Fix |
| 10 | `b7677ee` | fix: use curated token budgets for length presets and improve video summary depth | Prompts |
| 11 | `71ffd46` | fix: sync FALLBACK_VERSION with package.json fork version | Bug Fix |
| 12 | `0a2b7af` | feat: skip Tesseract OCR when Gemini pre-pass succeeds | Video |
| 13 | `060f566` | feat: show daemon version and connection status in sidepanel footer | Extension UX |
| 14 | `7f8468c` | feat: add live progress bar and elapsed timer to sidepanel | Extension UX |
| 15 | `ec955f2` | feat: pass YouTube video_url multimodal part in agent chat | Video |
| 16 | `5554d28` | feat: enable reasoning tokens for Gemini thinking models | Reasoning |
| 17 | `7ad685a` | feat: add streaming video path, provider routing, and reasoning tokens | Video/Reasoning |
| 18 | `16a42c2` | feat: add video debug logging, request replay dump, and tests | Debug |
| 19 | `1096b94` | feat: add debug logging to agent chat video/reasoning path | Debug |
| 20 | `5340af2` | feat: add metadata column to cache for enriched summary diagnostics | Cache |
| 21 | `6467000` | feat: cache fresh summaries on refresh and add e2e cache tests | Cache |
| 22 | `ea9c0d5` | feat: enrich cache metadata with prompt, settings, and input stats | Cache |
| 23 | `5542f3d` | feat: reframe prompts from summarization to content extraction for video | Prompts |
| 24 | `a1e5eac` | docs: add FORK.md documenting all fork changes | Docs |
| 25 | | fix: auto-restore summaries on tab switch back | Extension Fix |

---

## Test Coverage

3,176 lines of test code added across 23 test files:

- `tests/chrome.cookies.test.ts` — Chrome cookie export
- `tests/slides.build-yt-dlp-cookies-args.test.ts` — yt-dlp cookie args
- `tests/llm.interleaved-prompt.test.ts` — PromptPart interleaving
- `tests/prompts.chapters.test.ts` — YouTube chapter prompts
- `tests/slides.multimodal-prompt.test.ts` — Multimodal slide prompts
- `tests/video-url.generate-text-routing.test.ts` — Video routing in generateText
- `tests/video-url.multimodal-prompt.test.ts` — Multimodal prompt assembly
- `tests/video-url.openai-raw-fetch.test.ts` — Raw fetch video payloads
- `tests/video-url.prompt-parts.test.ts` — PromptPart utilities
- `tests/video-url.stream-routing.test.ts` — Video routing in streamText
- `tests/video-url.video-enablement.test.ts` — Video env var gating
- `tests/video-url.video-gating.test.ts` — Video feature gating
- `tests/video-url.gemini-timestamps.test.ts` — Gemini timestamp pre-pass
- `tests/slides.gemini-ocr-skip.test.ts` — OCR skip when Gemini succeeds
- `tests/reasoning-tokens.test.ts` — Reasoning token auto-detection
- `tests/agent.video-url.test.ts` — Agent chat video_url
- `tests/request-dump.test.ts` — Request dump system
- `tests/cache.store.test.ts` — Cache store e2e tests
- `tests/chrome-extension/progress-stages.test.ts` — Progress stage resolution
- `tests/sidepanel.panel-cache.test.ts` — Panel cache controller and tab-switch restore logic

## Architecture Decisions

1. **PromptPart type system** — Clean abstraction for interleaved text/image/video content that flows through the entire LLM pipeline without leaking provider-specific details
2. **Raw fetch bypass of pi-ai SDK** — Necessary because pi-ai has no video content type; all video_url handling goes through direct OpenAI-compatible API calls
3. **Gemini timestamp pre-pass in parallel** — Kicks off alongside yt-dlp download so there's zero added latency; falls back to ffmpeg if it fails
4. **Cookie passthrough via Netscape file format** — Bypasses WSL cookie DB locks and Chromium v20 encryption that prevent `--cookies-from-browser`
5. **Cache read/write split** — "Clear and refresh" skips reads but always writes, so fresh summaries are persisted with full metadata for debugging
6. **Provider routing forced to Google AI Studio** — Vertex doesn't support YouTube video_url parts; OpenRouter provider routing enforces this
7. **Content extraction vs summarization** — Video prompts reframed from "summarize" to "extract into readable text with timestamps" for better output quality
8. **Tab-switch SSE reconnect** — Save panel cache before aborting streams, then reconnect to daemon's SSE replay buffer on tab switch back for seamless restore
