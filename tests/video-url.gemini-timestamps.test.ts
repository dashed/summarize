import { describe, expect, it, vi } from "vitest";
import { getVideoTimestampsFromGemini } from "../src/llm/providers/openai.js";

describe("getVideoTimestampsFromGemini", () => {
  const makeSuccessResponse = (
    timestamps: Array<{ seconds: number; description: string }>,
  ) =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ timestamps }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  it("sends video_url to OpenRouter and returns parsed timestamps", async () => {
    const capturedRequests: { url: string; body: unknown }[] = [];

    const mockFetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      capturedRequests.push({ url: String(url), body });
      return makeSuccessResponse([
        { seconds: 10, description: "Introduction slide" },
        { seconds: 45, description: "Architecture diagram" },
        { seconds: 120, description: "Demo begins" },
      ]);
    });

    const result = await getVideoTimestampsFromGemini({
      videoUrl: "https://www.youtube.com/watch?v=abc123",
      openrouterApiKey: "test-key",
      maxSlides: 8,
      timeoutMs: 30000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.timestamps).toHaveLength(3);
    expect(result.timestamps[0]).toEqual({ seconds: 10, description: "Introduction slide" });
    expect(result.timestamps[2]).toEqual({ seconds: 120, description: "Demo begins" });

    // Verify the request was sent to OpenRouter.
    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0]!;
    expect(req.url).toBe("https://openrouter.ai/api/v1/chat/completions");

    // Verify the request body contains the video_url.
    const body = req.body as { model: string; messages: Array<{ role: string; content: unknown }> };
    expect(body.model).toBe("google/gemini-3-flash-preview");
    const userMessage = body.messages.find((m) => m.role === "user");
    expect(userMessage).toBeDefined();
    const content = userMessage!.content as Array<{ type: string; video_url?: { url: string } }>;
    const videoUrlPart = content.find((c) => c.type === "video_url");
    expect(videoUrlPart).toBeDefined();
    expect(videoUrlPart!.video_url!.url).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("uses the specified model ID", async () => {
    const capturedBodies: unknown[] = [];
    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, init?: RequestInit) => {
      capturedBodies.push(JSON.parse(init?.body as string));
      return makeSuccessResponse([{ seconds: 5, description: "Test" }]);
    });

    await getVideoTimestampsFromGemini({
      videoUrl: "https://www.youtube.com/watch?v=test",
      openrouterApiKey: "test-key",
      timeoutMs: 30000,
      fetchImpl: mockFetch as unknown as typeof fetch,
      modelId: "google/gemini-2.5-flash",
    });

    const body = capturedBodies[0] as { model: string };
    expect(body.model).toBe("google/gemini-2.5-flash");
  });

  it("includes response_format with json_schema", async () => {
    const capturedBodies: unknown[] = [];
    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, init?: RequestInit) => {
      capturedBodies.push(JSON.parse(init?.body as string));
      return makeSuccessResponse([{ seconds: 10, description: "Slide 1" }]);
    });

    await getVideoTimestampsFromGemini({
      videoUrl: "https://youtube.com/watch?v=test",
      openrouterApiKey: "test-key",
      timeoutMs: 30000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const body = capturedBodies[0] as { response_format: { type: string; json_schema: unknown } };
    expect(body.response_format).toBeDefined();
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema).toBeDefined();
  });

  it("handles markdown-wrapped JSON response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '```json\n{"timestamps": [{"seconds": 30, "description": "Chapter 1"}]}\n```',
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await getVideoTimestampsFromGemini({
      videoUrl: "https://youtube.com/watch?v=test",
      openrouterApiKey: "test-key",
      timeoutMs: 30000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.timestamps).toHaveLength(1);
    expect(result.timestamps[0]).toEqual({ seconds: 30, description: "Chapter 1" });
  });

  it("filters out invalid timestamps (non-finite, <= 0, missing description)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  timestamps: [
                    { seconds: 10, description: "Valid" },
                    { seconds: -5, description: "Negative" },
                    { seconds: 0, description: "Zero" },
                    { seconds: NaN, description: "NaN" },
                    { seconds: Infinity, description: "Infinity" },
                    { seconds: 20, description: 123 }, // non-string description
                    { seconds: 50, description: "Also valid" },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await getVideoTimestampsFromGemini({
      videoUrl: "https://youtube.com/watch?v=test",
      openrouterApiKey: "test-key",
      timeoutMs: 30000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.timestamps).toHaveLength(2);
    expect(result.timestamps[0]!.seconds).toBe(10);
    expect(result.timestamps[1]!.seconds).toBe(50);
  });

  it("sorts timestamps by seconds", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeSuccessResponse([
        { seconds: 120, description: "Third" },
        { seconds: 10, description: "First" },
        { seconds: 60, description: "Second" },
      ]),
    );

    const result = await getVideoTimestampsFromGemini({
      videoUrl: "https://youtube.com/watch?v=test",
      openrouterApiKey: "test-key",
      timeoutMs: 30000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.timestamps.map((t) => t.seconds)).toEqual([10, 60, 120]);
  });

  it("throws on non-OK response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("Rate limit exceeded", { status: 429 }),
    );

    await expect(
      getVideoTimestampsFromGemini({
        videoUrl: "https://youtube.com/watch?v=test",
        openrouterApiKey: "test-key",
        timeoutMs: 30000,
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow("OpenRouter API error (429)");
  });

  it("throws on empty content", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      getVideoTimestampsFromGemini({
        videoUrl: "https://youtube.com/watch?v=test",
        openrouterApiKey: "test-key",
        timeoutMs: 30000,
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow("LLM returned empty content");
  });

  it("throws on unparseable JSON", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "This is not JSON at all." } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      getVideoTimestampsFromGemini({
        videoUrl: "https://youtube.com/watch?v=test",
        openrouterApiKey: "test-key",
        timeoutMs: 30000,
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Failed to parse JSON");
  });

  it("defaults maxSlides to 12 when not specified", async () => {
    const capturedBodies: unknown[] = [];
    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, init?: RequestInit) => {
      capturedBodies.push(JSON.parse(init?.body as string));
      return makeSuccessResponse([{ seconds: 5, description: "Test" }]);
    });

    await getVideoTimestampsFromGemini({
      videoUrl: "https://youtube.com/watch?v=test",
      openrouterApiKey: "test-key",
      timeoutMs: 30000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const body = capturedBodies[0] as { messages: Array<{ content: unknown }> };
    const userMsg = body.messages[1] as { content: Array<{ type: string; text?: string }> };
    const textPart = userMsg.content.find((c) => c.type === "text");
    expect(textPart!.text).toContain("up to 12");
  });

  it("uses custom maxSlides when specified", async () => {
    const capturedBodies: unknown[] = [];
    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, init?: RequestInit) => {
      capturedBodies.push(JSON.parse(init?.body as string));
      return makeSuccessResponse([{ seconds: 5, description: "Test" }]);
    });

    await getVideoTimestampsFromGemini({
      videoUrl: "https://youtube.com/watch?v=test",
      openrouterApiKey: "test-key",
      maxSlides: 6,
      timeoutMs: 30000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const body = capturedBodies[0] as { messages: Array<{ content: unknown }> };
    const userMsg = body.messages[1] as { content: Array<{ type: string; text?: string }> };
    const textPart = userMsg.content.find((c) => c.type === "text");
    expect(textPart!.text).toContain("up to 6");
  });

  it("returns empty timestamps array when response has no valid entries", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeSuccessResponse([
        { seconds: -1, description: "Negative" },
        { seconds: 0, description: "Zero" },
      ]),
    );

    const result = await getVideoTimestampsFromGemini({
      videoUrl: "https://youtube.com/watch?v=test",
      openrouterApiKey: "test-key",
      timeoutMs: 30000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.timestamps).toHaveLength(0);
  });

  it("sends correct authorization header", async () => {
    const capturedHeaders: Record<string, string>[] = [];
    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, init?: RequestInit) => {
      capturedHeaders.push(init?.headers as Record<string, string>);
      return makeSuccessResponse([{ seconds: 10, description: "Test" }]);
    });

    await getVideoTimestampsFromGemini({
      videoUrl: "https://youtube.com/watch?v=test",
      openrouterApiKey: "sk-or-v1-test123",
      timeoutMs: 30000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(capturedHeaders[0]!.authorization).toBe("Bearer sk-or-v1-test123");
  });
});
