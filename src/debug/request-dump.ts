import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LlmTokenUsage } from "../llm/types.js";

const DEBUG_DIR = join(homedir(), ".summarize", "debug");

function isEnabled(): boolean {
  return (
    typeof process !== "undefined" &&
    process.env.SUMMARIZE_DEBUG_DUMP === "true"
  );
}

/** Extract a YouTube video ID from content parts that contain video_url entries. */
export function extractVideoId(
  messages: Array<Record<string, unknown>>,
): string | undefined {
  for (const msg of messages) {
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as Record<string, unknown>).type === "video_url"
      ) {
        const videoUrl = (part as Record<string, { url?: string }>).video_url
          ?.url;
        if (typeof videoUrl !== "string") continue;
        // youtube.com/watch?v=ID or youtu.be/ID
        try {
          const u = new URL(videoUrl);
          if (
            u.hostname === "www.youtube.com" ||
            u.hostname === "youtube.com"
          ) {
            const v = u.searchParams.get("v");
            if (v) return v;
          }
          if (u.hostname === "youtu.be") {
            const id = u.pathname.slice(1).split("/")[0];
            if (id) return id;
          }
        } catch {
          // not a valid URL
        }
      }
    }
  }
  return undefined;
}

/** Derive a short model name for the filename (e.g. "google/gemini-3-flash-preview" -> "gemini-3-flash-preview"). */
export function shortModelName(modelId: string): string {
  const after = modelId.includes("/")
    ? modelId.slice(modelId.lastIndexOf("/") + 1)
    : modelId;
  // Keep filesystem-safe: replace anything non-alphanumeric/dash/dot with dash
  return after.replace(/[^a-zA-Z0-9._-]/g, "-");
}

/** Build a filesystem-safe ISO timestamp (colons replaced with dashes). */
function safeTimestamp(): string {
  return new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "");
}

export function buildCurlCommand(
  url: string,
  payload: Record<string, unknown>,
): string {
  // Remove stream:true from the payload for curl replay
  const replayPayload = { ...payload };
  delete replayPayload.stream;

  const jsonBody = JSON.stringify(replayPayload);
  return [
    `curl -X POST ${url} \\`,
    `  -H "Authorization: Bearer $OPENROUTER_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${jsonBody}'`,
  ].join("\n");
}

export function redactApiKey(
  payload: Record<string, unknown>,
  apiKey: string,
): Record<string, unknown> {
  // Deep-clone and replace API key occurrences in string values
  const json = JSON.stringify(payload);
  const redacted = json.replaceAll(apiKey, "$OPENROUTER_API_KEY");
  return JSON.parse(redacted) as Record<string, unknown>;
}

export interface DumpVideoRequestParams {
  url: string;
  payload: Record<string, unknown>;
  apiKey: string;
  modelId: string;
  usage: LlmTokenUsage | null;
  elapsedMs: number;
  provider?: string;
}

/**
 * Save a debug dump of a video LLM request to ~/.summarize/debug/.
 * Fire-and-forget — errors are logged to stderr, never thrown.
 */
export function dumpVideoRequest(params: DumpVideoRequestParams): void {
  if (!isEnabled()) return;
  _dumpVideoRequestAsync(params).catch((err) => {
    console.error(`[summarize:debug] Failed to write request dump: ${err}`);
  });
}

async function _dumpVideoRequestAsync(
  params: DumpVideoRequestParams,
): Promise<void> {
  const { url, payload, apiKey, modelId, usage, elapsedMs, provider } = params;
  const messages = (payload.messages ?? []) as Array<Record<string, unknown>>;

  const videoId = extractVideoId(messages) ?? "unknown";
  const ts = safeTimestamp();
  const model = shortModelName(modelId);
  const filename = `${ts}-${videoId}-${model}.json`;

  // Find the video URL for context
  let videoUrl: string | undefined;
  for (const msg of messages) {
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as Record<string, unknown>).type === "video_url"
      ) {
        videoUrl = (part as Record<string, { url?: string }>).video_url?.url;
        if (videoUrl) break;
      }
    }
    if (videoUrl) break;
  }

  const redactedPayload = redactApiKey(payload, apiKey);

  const dump = {
    request: redactedPayload,
    response_meta: {
      tokens: usage
        ? {
            prompt: usage.promptTokens,
            completion: usage.completionTokens,
            total: usage.totalTokens,
          }
        : null,
      timing: { elapsed_ms: elapsedMs },
      provider: provider ?? null,
    },
    context: {
      url: videoUrl ?? null,
      timestamp: new Date().toISOString(),
      model_id: modelId,
    },
    curl_command: buildCurlCommand(url, redactedPayload),
  };

  await mkdir(DEBUG_DIR, { recursive: true });
  const filePath = join(DEBUG_DIR, filename);
  await writeFile(filePath, JSON.stringify(dump, null, 2) + "\n", "utf-8");
  console.error(`[summarize:debug] Request dump saved to ${filePath}`);
}
