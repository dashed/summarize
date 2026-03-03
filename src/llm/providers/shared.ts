import type { Api, AssistantMessage, Context, KnownProvider, Model } from "@mariozechner/pi-ai";
import { getModel } from "@mariozechner/pi-ai";

export function resolveBaseUrlOverride(raw: string | null | undefined): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function extractText(message: AssistantMessage): string {
  const text = message.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  return text.trim();
}

export function wantsImages(context: Context): boolean {
  for (const msg of context.messages) {
    if (msg.role === "user" || msg.role === "toolResult") {
      if (Array.isArray(msg.content) && msg.content.some((c) => c.type === "image")) return true;
    }
  }
  return false;
}

export function tryGetModel(provider: KnownProvider, modelId: string): Model<Api> | null {
  try {
    return getModel(provider, modelId as never) as unknown as Model<Api>;
  } catch {
    return null;
  }
}

/**
 * Check whether a model supports image inputs by looking it up in the pi-ai
 * registry.  For unknown models (not in the registry) we assume image support
 * since most modern multimodal models accept images and the worst case is a
 * recoverable API error.
 *
 * Providers like "nvidia" and "zai" are routed through the OpenAI-compatible
 * API and are not in the pi-ai registry directly, so we map them to "openai"
 * for the lookup.
 */
export function modelSupportsImages(provider: string, modelId: string): boolean {
  // nvidia and zai use the OpenAI completions API under the hood
  const lookupProvider: KnownProvider =
    provider === "nvidia" || provider === "zai" ? "openai" : (provider as KnownProvider);
  const model = tryGetModel(lookupProvider, modelId);
  if (!model) return true; // assume capable for unknown models
  return model.input.includes("image");
}

export function createSyntheticModel({
  provider,
  modelId,
  api,
  baseUrl,
  allowImages,
  headers,
}: {
  provider: KnownProvider;
  modelId: string;
  api: Model<Api>["api"];
  baseUrl: string;
  allowImages: boolean;
  headers?: Record<string, string>;
}): Model<Api> {
  return {
    id: modelId,
    name: `${provider}/${modelId}`,
    api,
    provider,
    baseUrl,
    reasoning: false,
    input: allowImages ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    ...(headers ? { headers } : {}),
  };
}
