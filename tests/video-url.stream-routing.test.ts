import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Prompt } from "../src/llm/prompt.js";
import { streamTextWithModelId, VIDEO_MIN_TIMEOUT_MS } from "../src/llm/generate-text.js";

// Mock the OpenAI provider to capture calls.
vi.mock("../src/llm/providers/openai.js", async () => {
  const actual = await vi.importActual<typeof import("../src/llm/providers/openai.js")>(
    "../src/llm/providers/openai.js",
  );
  return {
    ...actual,
    // Still mock the non-streaming version (used in generateTextWithModelId)
    completeOpenAiTextWithVideo: vi.fn().mockResolvedValue({
      text: "Video summary from stream fallback",
      usage: { inputTokens: 200, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }),
    // Mock the streaming version (used in streamTextWithModelId)
    streamOpenAiTextWithVideo: vi.fn().mockReturnValue({
      textStream: (async function* () {
        yield "Video ";
        yield "summary ";
        yield "from stream";
      })(),
      usage: Promise.resolve({
        inputTokens: 200,
        outputTokens: 80,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
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

describe("streamTextWithModelId video routing", () => {
  beforeEach(async () => {
    const { streamOpenAiTextWithVideo } = await import("../src/llm/providers/openai.js");
    (streamOpenAiTextWithVideo as ReturnType<typeof vi.fn>).mockClear();
    // Re-create the mock return value (generators are consumed after first use)
    (streamOpenAiTextWithVideo as ReturnType<typeof vi.fn>).mockReturnValue({
      textStream: (async function* () {
        yield "Video ";
        yield "summary ";
        yield "from stream";
      })(),
      usage: Promise.resolve({
        inputTokens: 200,
        outputTokens: 80,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    });
  });

  it("uses streaming streamOpenAiTextWithVideo for openai provider with video_url parts", async () => {
    const { streamOpenAiTextWithVideo } = await import("../src/llm/providers/openai.js");

    const prompt: Prompt = {
      system: "You are a summarizer.",
      userText: "Summarize this video.",
      interleavedParts: [
        { kind: "text", text: "Summarize this video." },
        { kind: "video_url", url: "https://www.youtube.com/watch?v=abc" },
        { kind: "image", bytes: new Uint8Array([1, 2]), mimeType: "image/png" },
      ],
    };

    const result = await streamTextWithModelId({
      modelId: "openai/google/gemini-3-flash-preview",
      apiKeys: baseApiKeys,
      prompt,
      timeoutMs: 30000,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      forceOpenRouter: true,
    });

    // Collect the stream chunks.
    const chunks: string[] = [];
    for await (const chunk of result.textStream) {
      chunks.push(chunk);
    }

    // Should emit multiple chunks (true streaming).
    expect(chunks).toEqual(["Video ", "summary ", "from stream"]);
    expect(result.canonicalModelId).toBe("openai/google/gemini-3-flash-preview");
    expect(result.provider).toBe("openai");

    // Verify streamOpenAiTextWithVideo was called with the original parts (not stripped).
    expect(streamOpenAiTextWithVideo).toHaveBeenCalled();
    const callArgs = (streamOpenAiTextWithVideo as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.interleavedParts).toEqual(prompt.interleavedParts);
    expect(callArgs.system).toBe("You are a summarizer.");

    // Usage should resolve to the value from streamOpenAiTextWithVideo.
    const usage = await result.usage;
    expect(usage).toEqual({
      inputTokens: 200,
      outputTokens: 80,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("preserves video_url parts in the raw fetch (not stripped)", async () => {
    const { streamOpenAiTextWithVideo } = await import("../src/llm/providers/openai.js");

    const prompt: Prompt = {
      system: "Summarize.",
      userText: "Test",
      interleavedParts: [
        { kind: "text", text: "Test" },
        { kind: "video_url", url: "https://www.youtube.com/watch?v=xyz" },
      ],
    };

    await streamTextWithModelId({
      modelId: "openai/google/gemini-3-flash-preview",
      apiKeys: baseApiKeys,
      prompt,
      timeoutMs: 30000,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      forceOpenRouter: true,
    });

    const callArgs = (streamOpenAiTextWithVideo as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // The video_url part must be present — it should NOT be stripped.
    const videoPartInCall = callArgs.interleavedParts.find(
      (p: { kind: string }) => p.kind === "video_url",
    );
    expect(videoPartInCall).toBeDefined();
    expect(videoPartInCall.url).toBe("https://www.youtube.com/watch?v=xyz");
  });

  it("returns a working lastError function", async () => {
    const prompt: Prompt = {
      system: "Test.",
      userText: "Test",
      interleavedParts: [
        { kind: "text", text: "Test" },
        { kind: "video_url", url: "https://youtube.com/watch?v=123" },
      ],
    };

    const result = await streamTextWithModelId({
      modelId: "openai/google/gemini-3-flash-preview",
      apiKeys: baseApiKeys,
      prompt,
      timeoutMs: 30000,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      forceOpenRouter: true,
    });

    // lastError should return null (no error in the video streaming path).
    expect(result.lastError()).toBeNull();
  });

  it("does NOT call streamOpenAiTextWithVideo when prompt has no video_url parts", async () => {
    const { streamOpenAiTextWithVideo } = await import("../src/llm/providers/openai.js");

    const prompt: Prompt = {
      system: "Summarize.",
      userText: "No video here.",
      interleavedParts: [
        { kind: "text", text: "No video here." },
        { kind: "image", bytes: new Uint8Array([1, 2]), mimeType: "image/png" },
      ],
    };

    // This will try to use pi-ai streamSimple which we haven't mocked,
    // so it should throw. The key assertion is that streamOpenAiTextWithVideo
    // is NOT called.
    try {
      await streamTextWithModelId({
        modelId: "openai/google/gemini-3-flash-preview",
        apiKeys: baseApiKeys,
        prompt,
        timeoutMs: 30000,
        fetchImpl: vi.fn() as unknown as typeof fetch,
        forceOpenRouter: true,
      });
    } catch {
      // Expected — pi-ai stream mocking is not set up.
    }

    expect(streamOpenAiTextWithVideo).not.toHaveBeenCalled();
  });

  it("passes multiple video_url parts through to the raw fetch", async () => {
    const { streamOpenAiTextWithVideo } = await import("../src/llm/providers/openai.js");

    const prompt: Prompt = {
      system: "Summarize.",
      userText: "Test multi-video",
      interleavedParts: [
        { kind: "text", text: "Test multi-video" },
        { kind: "video_url", url: "https://youtube.com/watch?v=aaa" },
        { kind: "image", bytes: new Uint8Array([1]), mimeType: "image/png" },
        { kind: "video_url", url: "https://youtube.com/watch?v=bbb" },
      ],
    };

    const result = await streamTextWithModelId({
      modelId: "openai/google/gemini-3-flash-preview",
      apiKeys: baseApiKeys,
      prompt,
      timeoutMs: 30000,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      forceOpenRouter: true,
    });

    const chunks: string[] = [];
    for await (const chunk of result.textStream) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["Video ", "summary ", "from stream"]);

    const callArgs = (streamOpenAiTextWithVideo as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const videoParts = callArgs.interleavedParts.filter(
      (p: { kind: string }) => p.kind === "video_url",
    );
    expect(videoParts).toHaveLength(2);
    expect(videoParts[0].url).toBe("https://youtube.com/watch?v=aaa");
    expect(videoParts[1].url).toBe("https://youtube.com/watch?v=bbb");
  });

  it("passes temperature, maxOutputTokens, and video timeout to streamOpenAiTextWithVideo", async () => {
    const { streamOpenAiTextWithVideo } = await import("../src/llm/providers/openai.js");

    const prompt: Prompt = {
      system: "Test.",
      userText: "Test",
      interleavedParts: [
        { kind: "text", text: "Test" },
        { kind: "video_url", url: "https://youtube.com/watch?v=123" },
      ],
    };

    await streamTextWithModelId({
      modelId: "openai/google/gemini-3-flash-preview",
      apiKeys: baseApiKeys,
      prompt,
      temperature: 0.5,
      maxOutputTokens: 4096,
      timeoutMs: 30000,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      forceOpenRouter: true,
    });

    const callArgs = (streamOpenAiTextWithVideo as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.temperature).toBe(0.5);
    expect(callArgs.maxOutputTokens).toBe(4096);
    // Video timeout is Math.max(30000, VIDEO_MIN_TIMEOUT_MS)
    expect(callArgs.timeoutMs).toBe(VIDEO_MIN_TIMEOUT_MS);
  });
});
