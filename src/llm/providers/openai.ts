import type { Context } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import { isOpenRouterBaseUrl, normalizeBaseUrl } from "@steipete/summarize-core";
import type { Attachment } from "../attachments.js";
import type { PromptPart } from "../prompt.js";
import type { LlmTokenUsage } from "../types.js";
import type { OpenAiClientConfig } from "./types.js";
import { dumpVideoRequest } from "../../debug/request-dump.js";
import { createUnsupportedFunctionalityError } from "../errors.js";
import { normalizeOpenAiUsage, normalizeTokenUsage } from "../usage.js";
import { resolveOpenAiModel } from "./models.js";
import { bytesToBase64 } from "./shared.js";

export type OpenAiClientConfigInput = {
  apiKeys: {
    openaiApiKey: string | null;
    openrouterApiKey: string | null;
  };
  forceOpenRouter?: boolean;
  openaiBaseUrlOverride?: string | null;
  forceChatCompletions?: boolean;
};

export function resolveOpenAiClientConfig({
  apiKeys,
  forceOpenRouter,
  openaiBaseUrlOverride,
  forceChatCompletions,
}: OpenAiClientConfigInput): OpenAiClientConfig {
  const baseUrlRaw =
    openaiBaseUrlOverride ??
    (typeof process !== "undefined" ? process.env.OPENAI_BASE_URL : undefined);
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  const isOpenRouterViaBaseUrl = baseUrl ? isOpenRouterBaseUrl(baseUrl) : false;
  const hasOpenRouterKey = apiKeys.openrouterApiKey != null;
  const hasOpenAiKey = apiKeys.openaiApiKey != null;
  const isOpenRouter =
    Boolean(forceOpenRouter) ||
    isOpenRouterViaBaseUrl ||
    (hasOpenRouterKey && !baseUrl && !hasOpenAiKey);

  const apiKey = isOpenRouter
    ? (apiKeys.openrouterApiKey ?? apiKeys.openaiApiKey)
    : apiKeys.openaiApiKey;
  if (!apiKey) {
    throw new Error(
      isOpenRouter
        ? "Missing OPENROUTER_API_KEY (or OPENAI_API_KEY) for OpenRouter"
        : "Missing OPENAI_API_KEY for openai/... model",
    );
  }

  const baseURL = forceOpenRouter
    ? "https://openrouter.ai/api/v1"
    : (baseUrl ?? (isOpenRouter ? "https://openrouter.ai/api/v1" : undefined));

  const isCustomBaseURL = (() => {
    if (!baseURL) return false;
    try {
      const url = new URL(baseURL);
      return url.host !== "api.openai.com" && url.host !== "openrouter.ai";
    } catch {
      return false;
    }
  })();

  const useChatCompletions = Boolean(forceChatCompletions) || isOpenRouter || isCustomBaseURL;
  return {
    apiKey,
    baseURL: baseURL ?? undefined,
    useChatCompletions,
    isOpenRouter,
  };
}

function resolveOpenAiResponsesUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/$/, "");
  if (/\/responses$/.test(path)) {
    url.pathname = path;
    return url;
  }
  if (/\/v1$/.test(path)) {
    url.pathname = `${path}/responses`;
    return url;
  }
  url.pathname = `${path}/v1/responses`;
  return url;
}

function extractOpenAiResponseText(payload: {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ text?: string }> }>;
}): string {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  const text = output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("")
    .trim();
  return text;
}

export async function completeOpenAiText({
  modelId,
  openaiConfig,
  context,
  temperature,
  maxOutputTokens,
  reasoning,
  signal,
}: {
  modelId: string;
  openaiConfig: OpenAiClientConfig;
  context: Context;
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: "minimal" | "low" | "medium" | "high";
  signal: AbortSignal;
}): Promise<{ text: string; usage: LlmTokenUsage | null }> {
  const model = resolveOpenAiModel({ modelId, context, openaiConfig });
  const result = await completeSimple(model, context, {
    ...(typeof temperature === "number" ? { temperature } : {}),
    ...(typeof maxOutputTokens === "number" ? { maxTokens: maxOutputTokens } : {}),
    ...(reasoning ? { reasoning } : {}),
    apiKey: openaiConfig.apiKey,
    signal,
  });
  const text = result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();
  if (!text) throw new Error(`LLM returned an empty summary (model openai/${modelId}).`);
  return { text, usage: normalizeTokenUsage(result.usage) };
}

export async function completeOpenAiDocument({
  modelId,
  openaiConfig,
  promptText,
  document,
  maxOutputTokens,
  temperature,
  timeoutMs,
  fetchImpl,
}: {
  modelId: string;
  openaiConfig: OpenAiClientConfig;
  promptText: string;
  document: Attachment;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<{ text: string; usage: LlmTokenUsage | null }> {
  if (document.kind !== "document") {
    throw new Error("Internal error: expected a document attachment for OpenAI.");
  }
  if (openaiConfig.isOpenRouter) {
    throw createUnsupportedFunctionalityError(
      "OpenRouter does not support PDF attachments for openai/... models",
    );
  }
  const baseUrl = openaiConfig.baseURL ?? "https://api.openai.com/v1";
  const host = new URL(baseUrl).host;
  if (host !== "api.openai.com") {
    throw createUnsupportedFunctionalityError(
      `Document attachments require api.openai.com; got ${host}`,
    );
  }

  const url = resolveOpenAiResponsesUrl(baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const filename = document.filename?.trim() || "document.pdf";
  const payload = {
    model: modelId,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename,
            file_data: `data:${document.mediaType};base64,${bytesToBase64(document.bytes)}`,
          },
          { type: "input_text", text: promptText },
        ],
      },
    ],
    ...(typeof maxOutputTokens === "number" ? { max_output_tokens: maxOutputTokens } : {}),
    ...(typeof temperature === "number" ? { temperature } : {}),
  };

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openaiConfig.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    if (!response.ok) {
      const error = new Error(`OpenAI API error (${response.status}).`);
      (error as { statusCode?: number }).statusCode = response.status;
      (error as { responseBody?: string }).responseBody = bodyText;
      throw error;
    }

    const data = JSON.parse(bodyText) as {
      output_text?: unknown;
      output?: Array<{ content?: Array<{ text?: string }> }>;
      usage?: unknown;
    };
    const text = extractOpenAiResponseText(data);
    if (!text) {
      throw new Error(`LLM returned an empty summary (model openai/${modelId}).`);
    }
    return { text, usage: normalizeOpenAiUsage(data.usage) };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send a chat completion request that includes `video_url` content parts.
 *
 * The pi-ai SDK has no concept of video content, so we build the
 * OpenAI-compatible chat completions payload ourselves and make a raw fetch
 * call.  This is used when the prompt contains interleaved `video_url` parts
 * (e.g. a YouTube URL passed to Gemini via OpenRouter).
 */
export async function completeOpenAiTextWithVideo({
  modelId,
  openaiConfig,
  system,
  interleavedParts,
  temperature,
  maxOutputTokens,
  reasoning,
  timeoutMs,
  fetchImpl,
}: {
  modelId: string;
  openaiConfig: OpenAiClientConfig;
  system?: string;
  interleavedParts: PromptPart[];
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: "minimal" | "low" | "medium" | "high";
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<{ text: string; usage: LlmTokenUsage | null }> {
  const baseUrl = openaiConfig.baseURL ?? "https://api.openai.com/v1";
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  // Count part types for logging.
  const partCounts = { text: 0, image: 0, video_url: 0 };
  for (const p of interleavedParts) {
    if (p.kind in partCounts) partCounts[p.kind as keyof typeof partCounts]++;
  }
  const videoUrls = interleavedParts
    .filter((p) => p.kind === "video_url")
    .map((p) => (p as { url: string }).url);
  console.error(
    `[summarize:video] completeOpenAiTextWithVideo: model=${modelId}, ` +
      `baseUrl=${baseUrl}, parts=[text=${partCounts.text}, image=${partCounts.image}, video=${partCounts.video_url}], ` +
      `videoUrls=${videoUrls.join(", ")}`,
  );
  console.error(
    `[video-debug] completeOpenAiTextWithVideo REQUEST: model=${modelId}, isOpenRouter=${openaiConfig.isOpenRouter}, ` +
      `reasoning=${reasoning ?? "none"}, timeout=${timeoutMs}ms, maxOutputTokens=${maxOutputTokens ?? "default"}, ` +
      `temperature=${temperature ?? "default"}, apiKey=***${openaiConfig.apiKey.slice(-4)}`,
  );

  // Build the user message content array with text, image_url, and video_url parts.
  const contentParts: Array<Record<string, unknown>> = [];
  for (const part of interleavedParts) {
    if (part.kind === "text") {
      contentParts.push({ type: "text", text: part.text });
    } else if (part.kind === "image") {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${part.mimeType};base64,${bytesToBase64(part.bytes)}` },
      });
    } else if (part.kind === "video_url") {
      contentParts.push({
        type: "video_url",
        video_url: { url: part.url },
      });
    }
  }

  const messages: Array<Record<string, unknown>> = [];
  if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: contentParts });

  const payload: Record<string, unknown> = {
    model: modelId,
    messages,
    ...(typeof temperature === "number" ? { temperature } : {}),
    ...(typeof maxOutputTokens === "number" ? { max_tokens: maxOutputTokens } : {}),
    ...(reasoning ? { reasoning: { effort: reasoning } } : {}),
    // Force Google AI Studio — Vertex does not support YouTube video_url parts.
    ...(openaiConfig.isOpenRouter
      ? { provider: { order: ["google-ai-studio"], allow_fallbacks: true } }
      : {}),
  };

  if (openaiConfig.isOpenRouter && payload.provider) {
    console.error(
      `[video-debug] completeOpenAiTextWithVideo PROVIDER_ROUTING: ${JSON.stringify(payload.provider)}`,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchStartMs = Date.now();

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openaiConfig.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    const fetchElapsedMs = Date.now() - fetchStartMs;
    console.error(
      `[summarize:video] completeOpenAiTextWithVideo response: status=${response.status}, ` +
        `bodyLength=${bodyText.length} chars`,
    );
    console.error(
      `[video-debug] completeOpenAiTextWithVideo FETCH_DONE: elapsed=${fetchElapsedMs}ms, status=${response.status}`,
    );

    // Log useful x- response headers (provider info, rate limits, timing).
    const xHeaders: string[] = [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith("x-")) xHeaders.push(`${key}=${value}`);
    });
    if (xHeaders.length > 0) {
      console.error(`[video-debug] completeOpenAiTextWithVideo HEADERS: ${xHeaders.join(", ")}`);
    }

    if (!response.ok) {
      console.error(
        `[summarize:video] completeOpenAiTextWithVideo ERROR: ${bodyText.slice(0, 500)}`,
      );
      const error = new Error(`OpenAI API error (${response.status}): ${bodyText}`);
      (error as { statusCode?: number }).statusCode = response.status;
      (error as { responseBody?: string }).responseBody = bodyText;
      throw error;
    }

    const data = JSON.parse(bodyText) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: unknown;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      throw new Error(`LLM returned an empty summary (model openai/${modelId}).`);
    }
    const usage = normalizeOpenAiUsage(data.usage);
    console.error(
      `[summarize:video] completeOpenAiTextWithVideo success: responseChars=${text.length}, ` +
        `usage=${JSON.stringify(usage)}`,
    );

    // Log raw token breakdown including any reasoning/thinking tokens.
    const rawUsage = data.usage as Record<string, unknown> | undefined;
    if (rawUsage) {
      const details = rawUsage.completion_tokens_details as Record<string, unknown> | undefined;
      console.error(
        `[video-debug] completeOpenAiTextWithVideo TOKENS: prompt=${rawUsage.prompt_tokens ?? "?"}, ` +
          `completion=${rawUsage.completion_tokens ?? "?"}, ` +
          `reasoning=${details?.reasoning_tokens ?? details?.thinking_tokens ?? "n/a"}, ` +
          `total=${rawUsage.total_tokens ?? "?"}`,
      );
    }

    // Fire-and-forget debug dump
    dumpVideoRequest({
      url,
      payload,
      apiKey: openaiConfig.apiKey,
      modelId,
      usage,
      elapsedMs: fetchElapsedMs,
      provider: response.headers.get("x-provider") ?? undefined,
    });

    return { text, usage };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Streaming version of {@link completeOpenAiTextWithVideo}.  Instead of waiting
 * for the full response, this returns an async iterable of text deltas parsed
 * from the SSE stream.  This is critical for video+reasoning requests that can
 * take 3-5+ minutes — streaming avoids both the daemon LLM timeout and the
 * extension idle timeout.
 */
export function streamOpenAiTextWithVideo({
  modelId,
  openaiConfig,
  system,
  interleavedParts,
  temperature,
  maxOutputTokens,
  reasoning,
  timeoutMs,
  fetchImpl,
}: {
  modelId: string;
  openaiConfig: OpenAiClientConfig;
  system?: string;
  interleavedParts: PromptPart[];
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: "minimal" | "low" | "medium" | "high";
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): {
  textStream: AsyncIterable<string>;
  usage: Promise<LlmTokenUsage | null>;
} {
  const baseUrl = openaiConfig.baseURL ?? "https://api.openai.com/v1";
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  // Count part types for logging.
  const partCounts = { text: 0, image: 0, video_url: 0 };
  for (const p of interleavedParts) {
    if (p.kind in partCounts) partCounts[p.kind as keyof typeof partCounts]++;
  }
  const videoUrls = interleavedParts
    .filter((p) => p.kind === "video_url")
    .map((p) => (p as { url: string }).url);
  console.error(
    `[summarize:video] streamOpenAiTextWithVideo: model=${modelId}, ` +
      `baseUrl=${baseUrl}, parts=[text=${partCounts.text}, image=${partCounts.image}, video=${partCounts.video_url}], ` +
      `videoUrls=${videoUrls.join(", ")}`,
  );
  console.error(
    `[video-debug] streamOpenAiTextWithVideo REQUEST: model=${modelId}, isOpenRouter=${openaiConfig.isOpenRouter}, ` +
      `reasoning=${reasoning ?? "none"}, timeout=${timeoutMs}ms, maxOutputTokens=${maxOutputTokens ?? "default"}, ` +
      `temperature=${temperature ?? "default"}, apiKey=***${openaiConfig.apiKey.slice(-4)}`,
  );

  // Build the user message content array.
  const contentParts: Array<Record<string, unknown>> = [];
  for (const part of interleavedParts) {
    if (part.kind === "text") {
      contentParts.push({ type: "text", text: part.text });
    } else if (part.kind === "image") {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${part.mimeType};base64,${bytesToBase64(part.bytes)}` },
      });
    } else if (part.kind === "video_url") {
      contentParts.push({
        type: "video_url",
        video_url: { url: part.url },
      });
    }
  }

  const messages: Array<Record<string, unknown>> = [];
  if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: contentParts });

  const payload: Record<string, unknown> = {
    model: modelId,
    messages,
    stream: true,
    ...(typeof temperature === "number" ? { temperature } : {}),
    ...(typeof maxOutputTokens === "number" ? { max_tokens: maxOutputTokens } : {}),
    ...(reasoning ? { reasoning: { effort: reasoning } } : {}),
    // Force Google AI Studio — Vertex does not support YouTube video_url parts.
    ...(openaiConfig.isOpenRouter
      ? { provider: { order: ["google-ai-studio"], allow_fallbacks: true } }
      : {}),
  };

  if (openaiConfig.isOpenRouter && payload.provider) {
    console.error(
      `[video-debug] streamOpenAiTextWithVideo PROVIDER_ROUTING: ${JSON.stringify(payload.provider)}`,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let usageResolve: (v: LlmTokenUsage | null) => void;
  const usagePromise = new Promise<LlmTokenUsage | null>((res) => {
    usageResolve = res;
  });

  const streamStartMs = Date.now();

  const textStream: AsyncIterable<string> = {
    async *[Symbol.asyncIterator]() {
      let streamProvider: string | undefined;
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${openaiConfig.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        streamProvider = response.headers.get("x-provider") ?? undefined;

        const connectElapsedMs = Date.now() - streamStartMs;
        console.error(
          `[video-debug] streamOpenAiTextWithVideo CONNECTED: elapsed=${connectElapsedMs}ms, status=${response.status}`,
        );

        // Log useful x- response headers (provider info, rate limits, timing).
        const xHeaders: string[] = [];
        response.headers.forEach((value, key) => {
          if (key.toLowerCase().startsWith("x-")) xHeaders.push(`${key}=${value}`);
        });
        if (xHeaders.length > 0) {
          console.error(`[video-debug] streamOpenAiTextWithVideo HEADERS: ${xHeaders.join(", ")}`);
        }

        if (!response.ok) {
          const bodyText = await response.text().catch(() => "");
          console.error(
            `[summarize:video] streamOpenAiTextWithVideo ERROR: ${bodyText.slice(0, 500)}`,
          );
          throw new Error(`OpenAI API error (${response.status}): ${bodyText}`);
        }
        if (!response.body) throw new Error("Missing stream body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let totalChars = 0;
        let lastUsage: LlmTokenUsage | null = null;
        let lastRawUsage: Record<string, unknown> | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
                usage?: unknown;
              };
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                totalChars += delta.length;
                yield delta;
              }
              if (parsed.usage) {
                lastUsage = normalizeOpenAiUsage(parsed.usage);
                lastRawUsage = parsed.usage as Record<string, unknown>;
              }
            } catch {
              // skip malformed JSON chunks
            }
          }
        }

        const totalElapsedMs = Date.now() - streamStartMs;
        console.error(
          `[summarize:video] streamOpenAiTextWithVideo completed: totalChars=${totalChars}, ` +
            `usage=${JSON.stringify(lastUsage)}`,
        );
        console.error(
          `[video-debug] streamOpenAiTextWithVideo DONE: totalElapsed=${totalElapsedMs}ms, chars=${totalChars}`,
        );

        // Log raw token breakdown including any reasoning/thinking tokens.
        if (lastRawUsage) {
          const details = lastRawUsage.completion_tokens_details as
            | Record<string, unknown>
            | undefined;
          console.error(
            `[video-debug] streamOpenAiTextWithVideo TOKENS: prompt=${lastRawUsage.prompt_tokens ?? "?"}, ` +
              `completion=${lastRawUsage.completion_tokens ?? "?"}, ` +
              `reasoning=${details?.reasoning_tokens ?? details?.thinking_tokens ?? "n/a"}, ` +
              `total=${lastRawUsage.total_tokens ?? "?"}`,
          );
        }

        // Fire-and-forget debug dump
        dumpVideoRequest({
          url,
          payload,
          apiKey: openaiConfig.apiKey,
          modelId,
          usage: lastUsage,
          elapsedMs: Date.now() - streamStartMs,
          provider: streamProvider,
        });

        usageResolve!(lastUsage);
      } catch (error) {
        const errorElapsedMs = Date.now() - streamStartMs;
        console.error(
          `[video-debug] streamOpenAiTextWithVideo ERROR: elapsed=${errorElapsedMs}ms, error=${error instanceof Error ? error.message : String(error)}`,
        );
        usageResolve!(null);
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };

  return { textStream, usage: usagePromise };
}

/**
 * Ask a Gemini model (via OpenRouter) to identify key visual moments in a
 * video and return their timestamps.  Uses the same raw-fetch pattern as
 * {@link completeOpenAiTextWithVideo}.
 */
export async function getVideoTimestampsFromGemini({
  videoUrl,
  openrouterApiKey,
  maxSlides,
  timeoutMs,
  fetchImpl,
  modelId,
}: {
  videoUrl: string;
  openrouterApiKey: string;
  maxSlides?: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  modelId?: string;
}): Promise<{ timestamps: Array<{ seconds: number; description: string }> }> {
  const model = modelId ?? "google/gemini-3-flash-preview";
  const effectiveMaxSlides = maxSlides ?? 12;

  console.error(
    `[summarize:video] getVideoTimestampsFromGemini: model=${model}, videoUrl=${videoUrl}, maxSlides=${effectiveMaxSlides}`,
  );
  console.error(
    `[video-debug] getVideoTimestampsFromGemini REQUEST: model=${model}, timeout=${timeoutMs}ms, ` +
      `apiKey=***${openrouterApiKey.slice(-4)}`,
  );

  const url = "https://openrouter.ai/api/v1/chat/completions";

  const messages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content:
        "You are a video analysis assistant. Your task is to identify key visual moments in videos.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text:
            `Watch this video and identify up to ${effectiveMaxSlides} key visual moments where the visual content changes significantly (e.g., new slide, diagram, topic change, demo transition). For each moment, provide the timestamp in seconds and a brief description of what appears.\n\n` +
            `Return ONLY valid JSON with this structure: {"timestamps": [{"seconds": <number>, "description": "<brief description>"}]}\n\n` +
            `Order by timestamp. Be precise with timestamps.`,
        },
        {
          type: "video_url",
          video_url: { url: videoUrl },
        },
      ],
    },
  ];

  const payload: Record<string, unknown> = {
    model,
    messages,
    // Force Google AI Studio — Vertex does not support YouTube video_url parts.
    provider: { order: ["google-ai-studio"], allow_fallbacks: true },
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "video_timestamps",
        strict: true,
        schema: {
          type: "object",
          properties: {
            timestamps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  seconds: { type: "number" },
                  description: { type: "string" },
                },
                required: ["seconds", "description"],
                additionalProperties: false,
              },
            },
          },
          required: ["timestamps"],
          additionalProperties: false,
        },
      },
    },
  };

  console.error(
    `[video-debug] getVideoTimestampsFromGemini PROVIDER_ROUTING: ${JSON.stringify(payload.provider)}`,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchStartMs = Date.now();

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openrouterApiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    const fetchElapsedMs = Date.now() - fetchStartMs;
    console.error(
      `[summarize:video] getVideoTimestampsFromGemini response: status=${response.status}, bodyLength=${bodyText.length} chars`,
    );
    console.error(
      `[video-debug] getVideoTimestampsFromGemini FETCH_DONE: elapsed=${fetchElapsedMs}ms, status=${response.status}`,
    );

    // Log useful x- response headers (provider info, rate limits, timing).
    const xHeaders: string[] = [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith("x-")) xHeaders.push(`${key}=${value}`);
    });
    if (xHeaders.length > 0) {
      console.error(`[video-debug] getVideoTimestampsFromGemini HEADERS: ${xHeaders.join(", ")}`);
    }

    if (!response.ok) {
      console.error(
        `[summarize:video] getVideoTimestampsFromGemini ERROR: ${bodyText.slice(0, 500)}`,
      );
      const error = new Error(`OpenRouter API error (${response.status}): ${bodyText}`);
      (error as { statusCode?: number }).statusCode = response.status;
      (error as { responseBody?: string }).responseBody = bodyText;
      throw error;
    }

    const data = JSON.parse(bodyText) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: Record<string, unknown>;
    };

    // Log raw token breakdown.
    if (data.usage) {
      const details = data.usage.completion_tokens_details as Record<string, unknown> | undefined;
      console.error(
        `[video-debug] getVideoTimestampsFromGemini TOKENS: prompt=${data.usage.prompt_tokens ?? "?"}, ` +
          `completion=${data.usage.completion_tokens ?? "?"}, ` +
          `reasoning=${details?.reasoning_tokens ?? details?.thinking_tokens ?? "n/a"}, ` +
          `total=${data.usage.total_tokens ?? "?"}`,
      );
    }

    const rawContent = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!rawContent) {
      throw new Error(`getVideoTimestampsFromGemini: LLM returned empty content (model ${model}).`);
    }

    // Try parsing the content as JSON directly, then fall back to extracting
    // from a markdown code block.
    let parsed: { timestamps?: unknown };
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      const match = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (!match) {
        throw new Error(
          `getVideoTimestampsFromGemini: Failed to parse JSON from response: ${rawContent.slice(0, 200)}`,
        );
      }
      parsed = JSON.parse(match[1].trim());
    }

    // Validate and filter timestamps.
    const raw = Array.isArray(parsed.timestamps) ? parsed.timestamps : [];
    const timestamps = raw
      .filter(
        (entry: { seconds?: unknown; description?: unknown }) =>
          typeof entry.seconds === "number" &&
          Number.isFinite(entry.seconds) &&
          entry.seconds > 0 &&
          typeof entry.description === "string",
      )
      .map((entry: { seconds: number; description: string }) => ({
        seconds: entry.seconds,
        description: entry.description,
      }))
      .sort((a: { seconds: number }, b: { seconds: number }) => a.seconds - b.seconds);

    console.error(
      `[summarize:video] getVideoTimestampsFromGemini success: found ${timestamps.length} timestamps`,
    );

    return { timestamps };
  } finally {
    clearTimeout(timeout);
  }
}
