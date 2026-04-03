import { describe, expect, it, vi } from "vitest";
import type { Prompt } from "../src/llm/prompt.js";
import { generateTextWithModelId } from "../src/llm/generate-text.js";

// Mock the OpenAI provider to capture calls.
vi.mock("../src/llm/providers/openai.js", async () => {
  const actual = await vi.importActual<typeof import("../src/llm/providers/openai.js")>(
    "../src/llm/providers/openai.js",
  );
  return {
    ...actual,
    completeOpenAiTextWithVideo: vi.fn().mockResolvedValue({
      text: "Video summary result",
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }),
    completeOpenAiText: vi.fn().mockResolvedValue({
      text: "Regular text result",
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }),
  };
});

// Mock models to avoid pi-ai registry lookups.
vi.mock("../src/llm/providers/models.js", async () => {
  const actual = await vi.importActual<typeof import("../src/llm/providers/models.js")>(
    "../src/llm/providers/models.js",
  );
  return {
    ...actual,
    resolveOpenAiModel: vi.fn().mockReturnValue({
      id: "test-model",
      name: "test/model",
      api: "openai-chat",
      provider: "openai",
      baseUrl: "https://openrouter.ai/api/v1",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    }),
  };
});

const baseApiKeys = {
  xaiApiKey: null,
  openaiApiKey: null,
  googleApiKey: null,
  anthropicApiKey: null,
  openrouterApiKey: "test-openrouter-key",
};

describe("generateTextWithModelId video routing", () => {
  it("routes to completeOpenAiTextWithVideo when prompt has video_url parts and provider is openai", async () => {
    const { completeOpenAiTextWithVideo } = await import("../src/llm/providers/openai.js");

    const prompt: Prompt = {
      system: "You are a summarizer.",
      userText: "Summarize this video.",
      interleavedParts: [
        { kind: "text", text: "Summarize this video." },
        { kind: "video_url", url: "https://www.youtube.com/watch?v=abc" },
        { kind: "image", bytes: new Uint8Array([1, 2]), mimeType: "image/png" },
      ],
    };

    const result = await generateTextWithModelId({
      modelId: "openai/google/gemini-3-flash-preview",
      apiKeys: baseApiKeys,
      prompt,
      timeoutMs: 30000,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      forceOpenRouter: true,
    });

    expect(result.text).toBe("Video summary result");
    expect(completeOpenAiTextWithVideo).toHaveBeenCalled();
    const callArgs = (completeOpenAiTextWithVideo as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.interleavedParts).toEqual(prompt.interleavedParts);
    expect(callArgs.system).toBe("You are a summarizer.");
  });

  it("strips video_url parts for non-openai providers", async () => {
    // For non-openai providers (like google), it should strip video parts
    // and continue with normal flow. We can verify by checking that
    // completeOpenAiTextWithVideo is NOT called and instead the code
    // falls through. Since we'd need to mock completeGoogleText too,
    // let's just test the stripping logic.
    const { stripVideoUrlParts } = await import("../src/llm/prompt.js");

    const parts = [
      { kind: "text" as const, text: "Summarize" },
      { kind: "video_url" as const, url: "https://youtube.com/watch?v=abc" },
      { kind: "image" as const, bytes: new Uint8Array([1]), mimeType: "image/png" },
    ];

    const stripped = stripVideoUrlParts(parts);
    expect(stripped).toHaveLength(2);
    expect(stripped[0]!.kind).toBe("text");
    expect(stripped[1]!.kind).toBe("image");
  });
});
