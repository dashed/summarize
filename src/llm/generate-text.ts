import type { Context, Message } from "@mariozechner/pi-ai";
import { completeSimple, streamSimple } from "@mariozechner/pi-ai";
import type { OpenAiClientConfig } from "./providers/types.js";
import type { LlmTokenUsage } from "./types.js";
import { createUnsupportedFunctionalityError } from "./errors.js";
import { parseGatewayStyleModelId } from "./model-id.js";
import {
  type Prompt,
  hasVideoUrlParts,
  stripVideoUrlParts,
  userInterleavedMessage,
  userTextAndImageMessage,
  userTextAndImagesMessage,
} from "./prompt.js";
import {
  completeAnthropicDocument,
  completeAnthropicText,
  normalizeAnthropicModelAccessError,
} from "./providers/anthropic.js";
import { completeGoogleDocument, completeGoogleText } from "./providers/google.js";
import {
  resolveAnthropicModel,
  resolveGoogleModel,
  resolveOpenAiModel,
  resolveXaiModel,
  resolveNvidiaModel,
  resolveZaiModel,
} from "./providers/models.js";
import {
  completeOpenAiDocument,
  completeOpenAiText,
  completeOpenAiTextWithVideo,
  streamOpenAiTextWithVideo,
  resolveOpenAiClientConfig,
} from "./providers/openai.js";
import { extractText } from "./providers/shared.js";
import { normalizeTokenUsage } from "./usage.js";

export type LlmApiKeys = {
  xaiApiKey: string | null;
  openaiApiKey: string | null;
  googleApiKey: string | null;
  anthropicApiKey: string | null;
  openrouterApiKey: string | null;
};

export type OpenRouterOptions = {
  providers: string[] | null;
};

export type { LlmTokenUsage } from "./types.js";

type RetryNotice = {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  error: unknown;
};

function promptToContext(prompt: Prompt): Context {
  // When interleaved parts are provided, they take priority over userText+attachments.
  if (prompt.interleavedParts && prompt.interleavedParts.length > 0) {
    const messages: Message[] = [userInterleavedMessage({ parts: prompt.interleavedParts })];
    return { systemPrompt: prompt.system, messages };
  }

  const attachments = prompt.attachments ?? [];
  if (attachments.some((attachment) => attachment.kind === "document")) {
    throw new Error("Internal error: document prompt cannot be converted to context.");
  }
  const imageAttachments = attachments.filter((a) => a.kind === "image");
  if (imageAttachments.length !== attachments.length) {
    throw new Error("Internal error: non-image attachments cannot be converted to context.");
  }
  if (imageAttachments.length === 0) {
    return {
      systemPrompt: prompt.system,
      messages: [{ role: "user", content: prompt.userText, timestamp: Date.now() }],
    };
  }
  if (imageAttachments.length === 1) {
    const attachment = imageAttachments[0]!;
    const messages: Message[] = [
      userTextAndImageMessage({
        text: prompt.userText,
        imageBytes: attachment.bytes,
        mimeType: attachment.mediaType,
      }),
    ];
    return { systemPrompt: prompt.system, messages };
  }
  const messages: Message[] = [
    userTextAndImagesMessage({
      text: prompt.userText,
      images: imageAttachments.map((a) => ({ imageBytes: a.bytes, mimeType: a.mediaType })),
    }),
  ];
  return { systemPrompt: prompt.system, messages };
}

/**
 * Minimum timeout for video_url requests (2 minutes).  With Google AI Studio
 * provider routing, video+reasoning requests typically complete in ~10 seconds,
 * so 2 minutes provides ample safety margin.
 */
export const VIDEO_MIN_TIMEOUT_MS = 120_000;

function isRetryableTimeoutError(error: unknown): boolean {
  if (!error) return false;
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : typeof (error as { message?: unknown }).message === "string"
          ? String((error as { message?: unknown }).message)
          : "";
  return /timed out/i.test(message) || /empty summary/i.test(message);
}

function computeRetryDelayMs(attempt: number): number {
  const base = 500;
  const jitter = Math.floor(Math.random() * 200);
  return Math.min(2000, base * (attempt + 1) + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeoutFallback<T>({
  promise,
  timeoutMs,
  fallback,
}: {
  promise: Promise<T>;
  timeoutMs: number;
  fallback: T;
}): Promise<T> {
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 30_000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), effectiveTimeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function streamUsageWithTimeout({
  result,
  timeoutMs,
}: {
  result: Promise<{ usage?: unknown }>;
  timeoutMs: number;
}): Promise<LlmTokenUsage | null> {
  const normalized = result.then((msg) => normalizeTokenUsage(msg.usage)).catch(() => null);
  return withTimeoutFallback({
    promise: normalized,
    timeoutMs,
    fallback: null,
  });
}

function isOpenaiGpt5Model(parsed: ReturnType<typeof parseGatewayStyleModelId>): boolean {
  return parsed.provider === "openai" && /^gpt-5([-.].+)?$/i.test(parsed.model);
}

function resolveEffectiveTemperature({
  parsed,
  temperature,
}: {
  parsed: ReturnType<typeof parseGatewayStyleModelId>;
  temperature?: number;
}): number | undefined {
  if (typeof temperature !== "number") return undefined;
  if (isOpenaiGpt5Model(parsed)) return undefined;
  return temperature;
}

/** Models that support and benefit from reasoning/thinking tokens. */
export function isGeminiThinkingModel(model: string): boolean {
  return model.includes("gemini-3") || model.includes("gemini-2.5-flash");
}

export type ReasoningLevel = "minimal" | "low" | "medium" | "high";

export function resolveEffectiveReasoning({
  parsed,
  reasoning,
}: {
  parsed: { model: string };
  reasoning?: ReasoningLevel;
}): ReasoningLevel | undefined {
  if (reasoning) return reasoning;
  if (isGeminiThinkingModel(parsed.model)) return "high";
  return undefined;
}

export async function generateTextWithModelId({
  modelId,
  apiKeys,
  prompt,
  temperature,
  maxOutputTokens,
  reasoning,
  timeoutMs,
  fetchImpl,
  forceOpenRouter,
  openaiBaseUrlOverride,
  anthropicBaseUrlOverride,
  googleBaseUrlOverride,
  xaiBaseUrlOverride,
  forceChatCompletions,
  retries = 0,
  onRetry,
}: {
  modelId: string;
  apiKeys: LlmApiKeys;
  prompt: Prompt;
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: "minimal" | "low" | "medium" | "high";
  timeoutMs: number;
  fetchImpl: typeof fetch;
  forceOpenRouter?: boolean;
  openaiBaseUrlOverride?: string | null;
  anthropicBaseUrlOverride?: string | null;
  googleBaseUrlOverride?: string | null;
  xaiBaseUrlOverride?: string | null;
  forceChatCompletions?: boolean;
  retries?: number;
  onRetry?: (notice: RetryNotice) => void;
}): Promise<{
  text: string;
  canonicalModelId: string;
  provider: "xai" | "openai" | "google" | "anthropic" | "zai" | "nvidia";
  usage: LlmTokenUsage | null;
}> {
  const parsed = parseGatewayStyleModelId(modelId);
  const effectiveTemperature = resolveEffectiveTemperature({ parsed, temperature });
  const effectiveReasoning = resolveEffectiveReasoning({ parsed, reasoning });

  const attachments = prompt.attachments ?? [];
  const documentAttachment =
    attachments.find((attachment) => attachment.kind === "document") ?? null;

  if (documentAttachment) {
    if (attachments.length !== 1) {
      throw new Error("Internal error: document attachments cannot be combined with other inputs.");
    }
    if (parsed.provider === "anthropic") {
      const apiKey = apiKeys.anthropicApiKey;
      if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY for anthropic/... model");
      try {
        const result = await completeAnthropicDocument({
          modelId: parsed.model,
          apiKey,
          promptText: prompt.userText,
          document: documentAttachment,
          system: prompt.system,
          maxOutputTokens,
          timeoutMs,
          fetchImpl,
          anthropicBaseUrlOverride,
        });
        return {
          text: result.text,
          canonicalModelId: parsed.canonical,
          provider: parsed.provider,
          usage: result.usage,
        };
      } catch (error) {
        const normalized = normalizeAnthropicModelAccessError(error, parsed.model);
        if (normalized) throw normalized;
        throw error;
      }
    }

    if (parsed.provider === "openai") {
      const openaiConfig = resolveOpenAiClientConfig({
        apiKeys: {
          openaiApiKey: apiKeys.openaiApiKey,
          openrouterApiKey: apiKeys.openrouterApiKey,
        },
        forceOpenRouter,
        openaiBaseUrlOverride,
        forceChatCompletions,
      });
      const result = await completeOpenAiDocument({
        modelId: parsed.model,
        openaiConfig,
        promptText: prompt.userText,
        document: documentAttachment,
        maxOutputTokens,
        temperature: effectiveTemperature,
        timeoutMs,
        fetchImpl,
      });
      return {
        text: result.text,
        canonicalModelId: parsed.canonical,
        provider: parsed.provider,
        usage: result.usage,
      };
    }

    if (parsed.provider === "google") {
      const apiKey = apiKeys.googleApiKey;
      if (!apiKey)
        throw new Error(
          "Missing GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_API_KEY) for google/... model",
        );
      const result = await completeGoogleDocument({
        modelId: parsed.model,
        apiKey,
        promptText: prompt.userText,
        document: documentAttachment,
        maxOutputTokens,
        temperature: effectiveTemperature,
        timeoutMs,
        fetchImpl,
        googleBaseUrlOverride,
      });
      return {
        text: result.text,
        canonicalModelId: parsed.canonical,
        provider: parsed.provider,
        usage: result.usage,
      };
    }

    throw createUnsupportedFunctionalityError(
      `document attachments are not supported for ${parsed.provider}/... models`,
    );
  }

  // Handle prompts that contain video_url parts (e.g. YouTube URL for Gemini).
  // The pi-ai SDK has no video content type, so we use a raw fetch path for
  // OpenAI-compatible APIs (including OpenRouter).  For other providers we
  // strip the video parts and fall through to the normal path.
  if (hasVideoUrlParts(prompt)) {
    const videoUrls = prompt.interleavedParts!
      .filter((p) => p.kind === "video_url")
      .map((p) => (p as { url: string }).url);
    console.error(
      `[summarize:video] non-streaming path detected ${videoUrls.length} video_url part(s) for ${parsed.canonical}; ` +
        `provider=${parsed.provider}. URLs: ${videoUrls.join(", ")}`,
    );
    if (parsed.provider === "openai") {
      const openaiConfig = resolveOpenAiClientConfig({
        apiKeys: {
          openaiApiKey: apiKeys.openaiApiKey,
          openrouterApiKey: apiKeys.openrouterApiKey,
        },
        forceOpenRouter,
        openaiBaseUrlOverride,
        forceChatCompletions,
      });
      const videoTimeoutMs = Math.max(timeoutMs, VIDEO_MIN_TIMEOUT_MS);
      const result = await completeOpenAiTextWithVideo({
        modelId: parsed.model,
        openaiConfig,
        system: prompt.system,
        interleavedParts: prompt.interleavedParts!,
        temperature: effectiveTemperature,
        maxOutputTokens,
        reasoning: effectiveReasoning,
        timeoutMs: videoTimeoutMs,
        fetchImpl,
      });
      console.error(
        `[summarize:video] non-streaming video request completed for ${parsed.canonical}; ` +
          `response length=${result.text.length} chars`,
      );
      return {
        text: result.text,
        canonicalModelId: parsed.canonical,
        provider: parsed.provider,
        usage: result.usage,
      };
    }
    // For non-OpenAI providers, strip video_url parts and continue with normal path.
    console.error(
      `[summarize:video] stripping video_url parts for non-openai provider ${parsed.provider}/${parsed.model}`,
    );
    const strippedParts = prompt.interleavedParts
      ? stripVideoUrlParts(prompt.interleavedParts)
      : undefined;
    prompt = { ...prompt, interleavedParts: strippedParts };
  }

  const context = promptToContext(prompt);

  const resolveOpenAiConfig = (): OpenAiClientConfig =>
    resolveOpenAiClientConfig({
      apiKeys: {
        openaiApiKey: apiKeys.openaiApiKey,
        openrouterApiKey: apiKeys.openrouterApiKey,
      },
      forceOpenRouter,
      openaiBaseUrlOverride,
      forceChatCompletions,
    });

  const completeSimpleText = async ({
    model,
    apiKey,
    signal,
  }: {
    model: Parameters<typeof completeSimple>[0];
    apiKey: string;
    signal: AbortSignal;
  }): Promise<{ text: string; usage: LlmTokenUsage | null }> => {
    const result = await completeSimple(model, context, {
      ...(typeof effectiveTemperature === "number" ? { temperature: effectiveTemperature } : {}),
      ...(typeof maxOutputTokens === "number" ? { maxTokens: maxOutputTokens } : {}),
      ...(effectiveReasoning ? { reasoning: effectiveReasoning } : {}),
      apiKey,
      signal,
    });
    const text = extractText(result);
    if (!text) throw new Error(`LLM returned an empty summary (model ${parsed.canonical}).`);
    return { text, usage: normalizeTokenUsage(result.usage) };
  };

  const maxRetries = Math.max(0, retries);
  let attempt = 0;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (parsed.provider === "xai") {
        const apiKey = apiKeys.xaiApiKey;
        if (!apiKey) throw new Error("Missing XAI_API_KEY for xai/... model");
        const model = resolveXaiModel({
          modelId: parsed.model,
          context,
          xaiBaseUrlOverride,
        });
        const result = await completeSimple(model, context, {
          ...(typeof effectiveTemperature === "number"
            ? { temperature: effectiveTemperature }
            : {}),
          ...(typeof maxOutputTokens === "number" ? { maxTokens: maxOutputTokens } : {}),
          ...(effectiveReasoning ? { reasoning: effectiveReasoning } : {}),
          apiKey,
          signal: controller.signal,
        });
        const text = extractText(result);
        if (!text) throw new Error(`LLM returned an empty summary (model ${parsed.canonical}).`);
        return {
          text,
          canonicalModelId: parsed.canonical,
          provider: parsed.provider,
          usage: normalizeTokenUsage(result.usage),
        };
      }

      if (parsed.provider === "google") {
        const apiKey = apiKeys.googleApiKey;
        if (!apiKey)
          throw new Error(
            "Missing GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_API_KEY) for google/... model",
          );
        const result = await completeGoogleText({
          modelId: parsed.model,
          apiKey,
          context,
          temperature: effectiveTemperature,
          maxOutputTokens,
          signal: controller.signal,
          googleBaseUrlOverride,
        });
        return {
          text: result.text,
          canonicalModelId: parsed.canonical,
          provider: parsed.provider,
          usage: result.usage,
        };
      }

      if (parsed.provider === "anthropic") {
        const apiKey = apiKeys.anthropicApiKey;
        if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY for anthropic/... model");
        const result = await completeAnthropicText({
          modelId: parsed.model,
          apiKey,
          context,
          temperature: effectiveTemperature,
          maxOutputTokens,
          signal: controller.signal,
          anthropicBaseUrlOverride,
        });
        return {
          text: result.text,
          canonicalModelId: parsed.canonical,
          provider: parsed.provider,
          usage: result.usage,
        };
      }

      if (parsed.provider === "zai") {
        const apiKey = apiKeys.openaiApiKey;
        if (!apiKey) throw new Error("Missing Z_AI_API_KEY for zai/... model");
        const model = resolveZaiModel({ modelId: parsed.model, context, openaiBaseUrlOverride });
        const result = await completeSimpleText({ model, apiKey, signal: controller.signal });
        return {
          text: result.text,
          canonicalModelId: parsed.canonical,
          provider: parsed.provider,
          usage: result.usage,
        };
      }

      if (parsed.provider === "nvidia") {
        const apiKey = apiKeys.openaiApiKey;
        if (!apiKey) throw new Error("Missing NVIDIA_API_KEY for nvidia/... model");
        const model = resolveNvidiaModel({ modelId: parsed.model, context, openaiBaseUrlOverride });
        const result = await completeSimpleText({ model, apiKey, signal: controller.signal });
        return {
          text: result.text,
          canonicalModelId: parsed.canonical,
          provider: parsed.provider,
          usage: result.usage,
        };
      }

      if (parsed.provider === "openai") {
        const openaiConfig = resolveOpenAiConfig();
        const result = await completeOpenAiText({
          modelId: parsed.model,
          openaiConfig,
          context,
          temperature: effectiveTemperature,
          maxOutputTokens,
          reasoning: effectiveReasoning,
          signal: controller.signal,
        });
        return {
          text: result.text,
          canonicalModelId: parsed.canonical,
          provider: parsed.provider,
          usage: result.usage,
        };
      }

      /* v8 ignore next */
      throw new Error(`Unknown provider ${parsed.provider}`);
    } catch (error) {
      const normalizedError =
        error instanceof DOMException && error.name === "AbortError"
          ? new Error(`LLM request timed out after ${timeoutMs}ms (model ${parsed.canonical}).`)
          : error;
      if (parsed.provider === "anthropic") {
        const normalized = normalizeAnthropicModelAccessError(normalizedError, parsed.model);
        if (normalized) throw normalized;
      }
      if (isRetryableTimeoutError(normalizedError) && attempt < maxRetries) {
        const delayMs = computeRetryDelayMs(attempt);
        onRetry?.({ attempt: attempt + 1, maxRetries, delayMs, error: normalizedError });
        await sleep(delayMs);
        attempt += 1;
        continue;
      }
      throw normalizedError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`LLM request failed after ${maxRetries + 1} attempts.`);
}

export async function streamTextWithModelId({
  modelId,
  apiKeys,
  prompt,
  temperature,
  maxOutputTokens,
  reasoning,
  timeoutMs,
  fetchImpl,
  forceOpenRouter,
  openaiBaseUrlOverride,
  anthropicBaseUrlOverride,
  googleBaseUrlOverride,
  xaiBaseUrlOverride,
  forceChatCompletions,
}: {
  modelId: string;
  apiKeys: LlmApiKeys;
  prompt: Prompt;
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: "minimal" | "low" | "medium" | "high";
  timeoutMs: number;
  fetchImpl: typeof fetch;
  forceOpenRouter?: boolean;
  openaiBaseUrlOverride?: string | null;
  anthropicBaseUrlOverride?: string | null;
  googleBaseUrlOverride?: string | null;
  xaiBaseUrlOverride?: string | null;
  forceChatCompletions?: boolean;
}): Promise<{
  textStream: AsyncIterable<string>;
  canonicalModelId: string;
  provider: "xai" | "openai" | "google" | "anthropic" | "zai" | "nvidia";
  usage: Promise<LlmTokenUsage | null>;
  lastError: () => unknown;
}> {
  const parsed = parseGatewayStyleModelId(modelId);
  const effectiveTemperature = resolveEffectiveTemperature({ parsed, temperature });
  const effectiveReasoning = resolveEffectiveReasoning({ parsed, reasoning });

  // When the prompt contains video_url parts and the provider speaks the OpenAI
  // chat completions protocol (which includes OpenRouter), use a raw streaming
  // fetch with video_url content parts.  The pi-ai SDK has no VideoContent type
  // so the normal streaming path cannot serialise video parts.
  if (hasVideoUrlParts(prompt) && parsed.provider === "openai") {
    const openaiConfig = resolveOpenAiClientConfig({
      apiKeys: {
        openaiApiKey: apiKeys.openaiApiKey,
        openrouterApiKey: apiKeys.openrouterApiKey,
      },
      forceOpenRouter,
      openaiBaseUrlOverride,
      forceChatCompletions,
    });

    const videoUrls = prompt.interleavedParts!
      .filter((p) => p.kind === "video_url")
      .map((p) => (p as { url: string }).url);
    console.error(
      `[summarize:video] streaming path detected ${videoUrls.length} video_url part(s) for ${parsed.canonical}; ` +
        `using raw streaming fetch. URLs: ${videoUrls.join(", ")}`,
    );

    const videoTimeoutMs = Math.max(timeoutMs, VIDEO_MIN_TIMEOUT_MS);
    const streamResult = streamOpenAiTextWithVideo({
      modelId: parsed.model,
      openaiConfig,
      system: prompt.system,
      interleavedParts: prompt.interleavedParts!,
      temperature: effectiveTemperature,
      maxOutputTokens,
      reasoning: effectiveReasoning,
      timeoutMs: videoTimeoutMs,
      fetchImpl,
    });

    return {
      textStream: streamResult.textStream,
      canonicalModelId: parsed.canonical,
      provider: parsed.provider,
      usage: streamResult.usage,
      lastError: () => null,
    };
  }

  // For non-openai providers (or prompts without video), strip video_url parts
  // (which the pi-ai SDK cannot serialise) and continue with normal streaming.
  if (hasVideoUrlParts(prompt)) {
    console.error(
      `[summarize:video] stripping video_url parts for non-openai provider ${parsed.provider}/${parsed.model}`,
    );
  }
  const effectivePrompt = hasVideoUrlParts(prompt)
    ? { ...prompt, interleavedParts: stripVideoUrlParts(prompt.interleavedParts!) }
    : prompt;
  const context = promptToContext(effectivePrompt);
  return streamTextWithContext({
    modelId,
    apiKeys,
    context,
    temperature,
    maxOutputTokens,
    reasoning: effectiveReasoning,
    timeoutMs,
    fetchImpl,
    forceOpenRouter,
    openaiBaseUrlOverride,
    anthropicBaseUrlOverride,
    googleBaseUrlOverride,
    xaiBaseUrlOverride,
    forceChatCompletions,
  });
}

export async function streamTextWithContext({
  modelId,
  apiKeys,
  context,
  temperature,
  maxOutputTokens,
  reasoning,
  timeoutMs,
  fetchImpl,
  forceOpenRouter,
  openaiBaseUrlOverride,
  anthropicBaseUrlOverride,
  googleBaseUrlOverride,
  xaiBaseUrlOverride,
  forceChatCompletions,
}: {
  modelId: string;
  apiKeys: LlmApiKeys;
  context: Context;
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: "minimal" | "low" | "medium" | "high";
  timeoutMs: number;
  fetchImpl: typeof fetch;
  forceOpenRouter?: boolean;
  openaiBaseUrlOverride?: string | null;
  anthropicBaseUrlOverride?: string | null;
  googleBaseUrlOverride?: string | null;
  xaiBaseUrlOverride?: string | null;
  forceChatCompletions?: boolean;
}): Promise<{
  textStream: AsyncIterable<string>;
  canonicalModelId: string;
  provider: "xai" | "openai" | "google" | "anthropic" | "zai" | "nvidia";
  usage: Promise<LlmTokenUsage | null>;
  lastError: () => unknown;
}> {
  const parsed = parseGatewayStyleModelId(modelId);
  const effectiveTemperature = resolveEffectiveTemperature({ parsed, temperature });
  void fetchImpl;

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const startedAtMs = Date.now();
  let lastError: unknown = null;
  const timeoutError = new Error("LLM request timed out");
  const markTimedOut = () => {
    if (lastError === timeoutError) return;
    lastError = timeoutError;
    controller.abort();
  };

  const startTimeout = () => {
    if (timeoutId) return;
    timeoutId = setTimeout(markTimedOut, timeoutMs);
  };

  const stopTimeout = () => {
    if (!timeoutId) return;
    clearTimeout(timeoutId);
    timeoutId = null;
  };

  const nextWithDeadline = async <T>(promise: Promise<T>): Promise<T> => {
    const elapsed = Date.now() - startedAtMs;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      markTimedOut();
      throw timeoutError;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            markTimedOut();
            reject(timeoutError);
          }, remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const wrapTextStream = (textStream: AsyncIterable<string>): AsyncIterable<string> => ({
    async *[Symbol.asyncIterator]() {
      startTimeout();
      const iterator = textStream[Symbol.asyncIterator]();
      try {
        while (true) {
          const result = await nextWithDeadline(iterator.next());
          if (result.done) break;
          yield result.value;
        }
      } finally {
        stopTimeout();
        if (typeof iterator.return === "function") {
          const cleanup = iterator.return();
          const cleanupPromise =
            typeof cleanup === "undefined" ? undefined : (cleanup as Promise<unknown>);
          if (typeof cleanupPromise?.catch === "function") {
            void cleanupPromise.catch(() => {});
          }
        }
      }
    },
  });

  try {
    if (parsed.provider === "xai") {
      const apiKey = apiKeys.xaiApiKey;
      if (!apiKey) throw new Error("Missing XAI_API_KEY for xai/... model");
      const model = resolveXaiModel({
        modelId: parsed.model,
        context,
        xaiBaseUrlOverride,
      });
      const stream = streamSimple(model, context, {
        ...(typeof effectiveTemperature === "number" ? { temperature: effectiveTemperature } : {}),
        ...(typeof maxOutputTokens === "number" ? { maxTokens: maxOutputTokens } : {}),
        ...(reasoning ? { reasoning } : {}),
        apiKey,
        signal: controller.signal,
      });

      const textStream: AsyncIterable<string> = {
        async *[Symbol.asyncIterator]() {
          for await (const event of stream) {
            if (event.type === "text_delta") yield event.delta;
            if (event.type === "error") {
              lastError = event.error;
              break;
            }
          }
        },
      };
      return {
        textStream: wrapTextStream(textStream),
        canonicalModelId: parsed.canonical,
        provider: parsed.provider,
        usage: streamUsageWithTimeout({ result: stream.result(), timeoutMs }),
        lastError: () => lastError,
      };
    }

    if (parsed.provider === "google") {
      const apiKey = apiKeys.googleApiKey;
      if (!apiKey)
        throw new Error(
          "Missing GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_API_KEY) for google/... model",
        );
      const model = resolveGoogleModel({
        modelId: parsed.model,
        context,
        googleBaseUrlOverride,
      });
      const stream = streamSimple(model, context, {
        ...(typeof effectiveTemperature === "number" ? { temperature: effectiveTemperature } : {}),
        ...(typeof maxOutputTokens === "number" ? { maxTokens: maxOutputTokens } : {}),
        ...(reasoning ? { reasoning } : {}),
        apiKey,
        signal: controller.signal,
      });

      const textStream: AsyncIterable<string> = {
        async *[Symbol.asyncIterator]() {
          for await (const event of stream) {
            if (event.type === "text_delta") yield event.delta;
            if (event.type === "error") {
              lastError = event.error;
              break;
            }
          }
        },
      };
      return {
        textStream: wrapTextStream(textStream),
        canonicalModelId: parsed.canonical,
        provider: parsed.provider,
        usage: streamUsageWithTimeout({ result: stream.result(), timeoutMs }),
        lastError: () => lastError,
      };
    }

    if (parsed.provider === "anthropic") {
      const apiKey = apiKeys.anthropicApiKey;
      if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY for anthropic/... model");
      const model = resolveAnthropicModel({
        modelId: parsed.model,
        context,
        anthropicBaseUrlOverride,
      });
      const stream = streamSimple(model, context, {
        ...(typeof effectiveTemperature === "number" ? { temperature: effectiveTemperature } : {}),
        ...(typeof maxOutputTokens === "number" ? { maxTokens: maxOutputTokens } : {}),
        ...(reasoning ? { reasoning } : {}),
        apiKey,
        signal: controller.signal,
      });

      const textStream: AsyncIterable<string> = {
        async *[Symbol.asyncIterator]() {
          for await (const event of stream) {
            if (event.type === "text_delta") yield event.delta;
            if (event.type === "error") {
              lastError =
                normalizeAnthropicModelAccessError(event.error, parsed.model) ?? event.error;
              break;
            }
          }
        },
      };
      return {
        textStream: wrapTextStream(textStream),
        canonicalModelId: parsed.canonical,
        provider: parsed.provider,
        usage: streamUsageWithTimeout({ result: stream.result(), timeoutMs }),
        lastError: () => lastError,
      };
    }

    if (parsed.provider === "openai" || parsed.provider === "zai" || parsed.provider === "nvidia") {
      const openaiConfig: OpenAiClientConfig = (() => {
        if (parsed.provider === "openai") {
          return resolveOpenAiClientConfig({
            apiKeys: {
              openaiApiKey: apiKeys.openaiApiKey,
              openrouterApiKey: apiKeys.openrouterApiKey,
            },
            forceOpenRouter,
            openaiBaseUrlOverride,
            forceChatCompletions,
          });
        }
        if (parsed.provider === "zai") {
          const key = apiKeys.openaiApiKey;
          if (!key) throw new Error("Missing Z_AI_API_KEY for zai/... model");
          return {
            apiKey: key,
            baseURL: openaiBaseUrlOverride ?? "https://api.z.ai/api/paas/v4",
            useChatCompletions: true,
            isOpenRouter: false,
          };
        }
        const key = apiKeys.openaiApiKey;
        if (!key) throw new Error("Missing NVIDIA_API_KEY for nvidia/... model");
        return {
          apiKey: key,
          baseURL: openaiBaseUrlOverride ?? "https://integrate.api.nvidia.com/v1",
          useChatCompletions: true,
          isOpenRouter: false,
        };
      })();

      const model = resolveOpenAiModel({ modelId: parsed.model, context, openaiConfig });
      const stream = streamSimple(model, context, {
        ...(typeof effectiveTemperature === "number" ? { temperature: effectiveTemperature } : {}),
        ...(typeof maxOutputTokens === "number" ? { maxTokens: maxOutputTokens } : {}),
        ...(reasoning ? { reasoning } : {}),
        apiKey: openaiConfig.apiKey,
        signal: controller.signal,
      });

      const textStream: AsyncIterable<string> = {
        async *[Symbol.asyncIterator]() {
          for await (const event of stream) {
            if (event.type === "text_delta") yield event.delta;
            if (event.type === "error") {
              lastError = event.error;
              break;
            }
          }
        },
      };
      return {
        textStream: wrapTextStream(textStream),
        canonicalModelId: parsed.canonical,
        provider: parsed.provider,
        usage: streamUsageWithTimeout({ result: stream.result(), timeoutMs }),
        lastError: () => lastError,
      };
    }

    /* v8 ignore next */
    throw new Error(`Unknown provider ${parsed.provider}`);
  } catch (error) {
    if (parsed.provider === "anthropic") {
      const normalized = normalizeAnthropicModelAccessError(error, parsed.model);
      if (normalized) throw normalized;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("LLM request timed out");
    }
    throw error;
  } finally {
    stopTimeout();
  }
}
