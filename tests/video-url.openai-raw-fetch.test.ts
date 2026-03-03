import { describe, expect, it, vi } from "vitest";
import type { PromptPart } from "../src/llm/prompt.js";
import {
  completeOpenAiTextWithVideo,
  streamOpenAiTextWithVideo,
} from "../src/llm/providers/openai.js";

describe("completeOpenAiTextWithVideo", () => {
  const makeConfig = (overrides?: { baseURL?: string; isOpenRouter?: boolean }) => ({
    apiKey: "test-key",
    baseURL: overrides?.baseURL ?? "https://openrouter.ai/api/v1",
    useChatCompletions: true,
    isOpenRouter: overrides?.isOpenRouter ?? true,
  });

  it("sends video_url content part to the API", async () => {
    const capturedRequests: { url: string; body: unknown; headers: Record<string, string> }[] = [];

    const mockFetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      capturedRequests.push({
        url: String(url),
        body,
        headers: init?.headers as Record<string, string>,
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Summary of the video." } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const parts: PromptPart[] = [
      { kind: "text", text: "Summarize this video." },
      { kind: "video_url", url: "https://www.youtube.com/watch?v=abc123" },
      { kind: "image", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
      { kind: "text", text: "[slide:1] [0:00–0:30]" },
    ];

    const result = await completeOpenAiTextWithVideo({
      modelId: "google/gemini-3-flash-preview",
      openaiConfig: makeConfig(),
      system: "You are a summarizer.",
      interleavedParts: parts,
      temperature: 0,
      maxOutputTokens: 65536,
      timeoutMs: 30000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.text).toBe("Summary of the video.");
    expect(capturedRequests).toHaveLength(1);

    const body = capturedRequests[0]!.body as {
      model: string;
      messages: Array<{
        role: string;
        content:
          | string
          | Array<{
              type: string;
              text?: string;
              video_url?: { url: string };
              image_url?: { url: string };
            }>;
      }>;
      max_tokens?: number;
      temperature?: number;
    };

    // Check model
    expect(body.model).toBe("google/gemini-3-flash-preview");

    // Check system message
    expect(body.messages[0]!.role).toBe("system");
    expect(body.messages[0]!.content).toBe("You are a summarizer.");

    // Check user message content parts
    const userContent = body.messages[1]!.content;
    expect(Array.isArray(userContent)).toBe(true);
    const contentParts = userContent as Array<Record<string, unknown>>;

    // Text part
    expect(contentParts[0]).toEqual({ type: "text", text: "Summarize this video." });

    // Video URL part
    expect(contentParts[1]).toEqual({
      type: "video_url",
      video_url: { url: "https://www.youtube.com/watch?v=abc123" },
    });

    // Image part (base64 data URL)
    expect(contentParts[2]!.type).toBe("image_url");
    expect((contentParts[2]!.image_url as { url: string }).url).toMatch(/^data:image\/png;base64,/);

    // Second text part
    expect(contentParts[3]).toEqual({ type: "text", text: "[slide:1] [0:00–0:30]" });

    // Check optional params
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(65536);
  });

  it("sends request to correct chat/completions URL", async () => {
    let capturedUrl = "";
    const mockFetch = vi.fn().mockImplementation(async (url: string | URL) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: 200,
      });
    });

    await completeOpenAiTextWithVideo({
      modelId: "test-model",
      openaiConfig: makeConfig({ baseURL: "https://openrouter.ai/api/v1" }),
      interleavedParts: [{ kind: "text", text: "Hello" }],
      timeoutMs: 5000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(capturedUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("includes authorization header with API key", async () => {
    let capturedHeaders: Record<string, string> | null = null;
    const mockFetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: 200,
      });
    });

    await completeOpenAiTextWithVideo({
      modelId: "test-model",
      openaiConfig: makeConfig(),
      interleavedParts: [{ kind: "text", text: "Hello" }],
      timeoutMs: 5000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(capturedHeaders!.authorization).toBe("Bearer test-key");
    expect(capturedHeaders!["content-type"]).toBe("application/json");
  });

  it("throws on empty response", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }),
      );

    await expect(
      completeOpenAiTextWithVideo({
        modelId: "test-model",
        openaiConfig: makeConfig(),
        interleavedParts: [{ kind: "text", text: "Hello" }],
        timeoutMs: 5000,
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow("empty summary");
  });

  it("throws on non-OK response", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("Rate limit exceeded", { status: 429 }));

    await expect(
      completeOpenAiTextWithVideo({
        modelId: "test-model",
        openaiConfig: makeConfig(),
        interleavedParts: [{ kind: "text", text: "Hello" }],
        timeoutMs: 5000,
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow("429");
  });

  it("omits system message when system is undefined", async () => {
    let capturedBody: unknown = null;
    const mockFetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: 200,
      });
    });

    await completeOpenAiTextWithVideo({
      modelId: "test-model",
      openaiConfig: makeConfig(),
      interleavedParts: [{ kind: "text", text: "Hello" }],
      timeoutMs: 5000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const body = capturedBody as { messages: Array<{ role: string }> };
    // Only user message, no system message
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.role).toBe("user");
  });

  it("omits temperature and max_tokens when not provided", async () => {
    let capturedBody: unknown = null;
    const mockFetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: 200,
      });
    });

    await completeOpenAiTextWithVideo({
      modelId: "test-model",
      openaiConfig: makeConfig(),
      interleavedParts: [{ kind: "text", text: "Hello" }],
      timeoutMs: 5000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const body = capturedBody as Record<string, unknown>;
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("includes provider routing for Google AI Studio when isOpenRouter is true", async () => {
    let capturedBody: unknown = null;
    const mockFetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: 200,
      });
    });

    await completeOpenAiTextWithVideo({
      modelId: "google/gemini-3-flash-preview",
      openaiConfig: makeConfig({ isOpenRouter: true }),
      interleavedParts: [
        { kind: "text", text: "Hello" },
        { kind: "video_url", url: "https://youtube.com/watch?v=abc" },
      ],
      timeoutMs: 5000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const body = capturedBody as Record<string, unknown>;
    expect(body.provider).toEqual({
      order: ["google-ai-studio"],
      allow_fallbacks: true,
    });
  });

  it("omits provider routing when isOpenRouter is false", async () => {
    let capturedBody: unknown = null;
    const mockFetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: 200,
      });
    });

    await completeOpenAiTextWithVideo({
      modelId: "test-model",
      openaiConfig: makeConfig({ isOpenRouter: false }),
      interleavedParts: [{ kind: "text", text: "Hello" }],
      timeoutMs: 5000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const body = capturedBody as Record<string, unknown>;
    expect(body).not.toHaveProperty("provider");
  });
});

describe("streamOpenAiTextWithVideo provider routing", () => {
  const makeConfig = (overrides?: { baseURL?: string; isOpenRouter?: boolean }) => ({
    apiKey: "test-key",
    baseURL: overrides?.baseURL ?? "https://openrouter.ai/api/v1",
    useChatCompletions: true,
    isOpenRouter: overrides?.isOpenRouter ?? true,
  });

  it("includes provider routing for Google AI Studio when isOpenRouter is true", async () => {
    let capturedBody: unknown = null;
    const mockFetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      // Return a streaming response with a single chunk.
      const encoder = new TextEncoder();
      const body = encoder.encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}\n\ndata: [DONE]\n\n`,
      );
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(body);
            controller.close();
          },
        }),
        { status: 200 },
      );
    });

    const result = streamOpenAiTextWithVideo({
      modelId: "google/gemini-3-flash-preview",
      openaiConfig: makeConfig({ isOpenRouter: true }),
      interleavedParts: [
        { kind: "text", text: "Hello" },
        { kind: "video_url", url: "https://youtube.com/watch?v=abc" },
      ],
      timeoutMs: 5000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    // Consume the stream to trigger the fetch.
    const chunks: string[] = [];
    for await (const chunk of result.textStream) {
      chunks.push(chunk);
    }

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as Record<string, unknown>;
    expect(body.provider).toEqual({
      order: ["google-ai-studio"],
      allow_fallbacks: true,
    });
  });

  it("omits provider routing when isOpenRouter is false", async () => {
    let capturedBody: unknown = null;
    const mockFetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      const encoder = new TextEncoder();
      const body = encoder.encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}\n\ndata: [DONE]\n\n`,
      );
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(body);
            controller.close();
          },
        }),
        { status: 200 },
      );
    });

    const result = streamOpenAiTextWithVideo({
      modelId: "test-model",
      openaiConfig: makeConfig({ isOpenRouter: false }),
      interleavedParts: [{ kind: "text", text: "Hello" }],
      timeoutMs: 5000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const chunks: string[] = [];
    for await (const chunk of result.textStream) {
      chunks.push(chunk);
    }

    const body = capturedBody as Record<string, unknown>;
    expect(body).not.toHaveProperty("provider");
  });
});
