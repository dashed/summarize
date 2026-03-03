import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractVideoId,
  shortModelName,
  buildCurlCommand,
  redactApiKey,
  dumpVideoRequest,
} from "../src/debug/request-dump.js";

describe("extractVideoId", () => {
  it("extracts ID from youtube.com/watch?v=...", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Summarize this" },
          {
            type: "video_url",
            video_url: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
          },
        ],
      },
    ];
    expect(extractVideoId(messages)).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from youtu.be/...", () => {
    const messages = [
      {
        role: "user",
        content: [
          {
            type: "video_url",
            video_url: { url: "https://youtu.be/9Kn75xtLPDY" },
          },
        ],
      },
    ];
    expect(extractVideoId(messages)).toBe("9Kn75xtLPDY");
  });

  it("extracts ID from youtube.com with extra params", () => {
    const messages = [
      {
        role: "user",
        content: [
          {
            type: "video_url",
            video_url: {
              url: "https://www.youtube.com/watch?v=abc123&t=632s&list=PLxyz",
            },
          },
        ],
      },
    ];
    expect(extractVideoId(messages)).toBe("abc123");
  });

  it("returns undefined when no video_url parts", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "Hello" }] }];
    expect(extractVideoId(messages)).toBeUndefined();
  });

  it("returns undefined for non-YouTube URLs", () => {
    const messages = [
      {
        role: "user",
        content: [
          {
            type: "video_url",
            video_url: { url: "https://vimeo.com/12345" },
          },
        ],
      },
    ];
    expect(extractVideoId(messages)).toBeUndefined();
  });

  it("returns undefined for non-array content", () => {
    const messages = [{ role: "system", content: "You are a helpful assistant" }];
    expect(extractVideoId(messages)).toBeUndefined();
  });

  it("handles youtube.com without www", () => {
    const messages = [
      {
        role: "user",
        content: [
          {
            type: "video_url",
            video_url: { url: "https://youtube.com/watch?v=xyz789" },
          },
        ],
      },
    ];
    expect(extractVideoId(messages)).toBe("xyz789");
  });
});

describe("shortModelName", () => {
  it("strips provider prefix", () => {
    expect(shortModelName("google/gemini-3-flash-preview")).toBe("gemini-3-flash-preview");
  });

  it("strips nested provider prefix", () => {
    expect(shortModelName("openrouter/google/gemini-3-flash-preview")).toBe(
      "gemini-3-flash-preview",
    );
  });

  it("keeps model without prefix unchanged", () => {
    expect(shortModelName("gpt-4o")).toBe("gpt-4o");
  });

  it("replaces filesystem-unsafe characters", () => {
    expect(shortModelName("provider/model:latest")).toBe("model-latest");
  });
});

describe("buildCurlCommand", () => {
  it("generates a valid curl command", () => {
    const cmd = buildCurlCommand("https://openrouter.ai/api/v1/chat/completions", {
      model: "gemini-3-flash",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(cmd).toContain("curl -X POST https://openrouter.ai/api/v1/chat/completions");
    expect(cmd).toContain("$OPENROUTER_API_KEY");
    expect(cmd).toContain('"model":"gemini-3-flash"');
  });

  it("strips stream:true from the payload", () => {
    const cmd = buildCurlCommand("https://api.example.com", {
      model: "test",
      stream: true,
    });
    expect(cmd).not.toContain('"stream"');
  });

  it("preserves other payload fields when stripping stream", () => {
    const cmd = buildCurlCommand("https://api.example.com", {
      model: "test",
      stream: true,
      reasoning: { effort: "high" },
    });
    expect(cmd).toContain('"reasoning"');
    expect(cmd).toContain('"effort":"high"');
  });
});

describe("redactApiKey", () => {
  it("replaces API key with placeholder", () => {
    const payload = {
      model: "test",
      apiKey: "sk-secret-key-12345",
    };
    const redacted = redactApiKey(payload, "sk-secret-key-12345");
    expect(JSON.stringify(redacted)).not.toContain("sk-secret-key-12345");
    expect(JSON.stringify(redacted)).toContain("$OPENROUTER_API_KEY");
  });

  it("replaces API key in nested objects", () => {
    const payload = {
      headers: { authorization: "Bearer sk-secret" },
      nested: { deep: { key: "sk-secret" } },
    };
    const redacted = redactApiKey(payload, "sk-secret");
    const json = JSON.stringify(redacted);
    expect(json).not.toContain("sk-secret");
    expect(json.match(/\$OPENROUTER_API_KEY/g)?.length).toBe(2);
  });

  it("returns unchanged payload when key not present", () => {
    const payload = { model: "test", data: "safe" };
    const redacted = redactApiKey(payload, "not-in-payload");
    expect(redacted).toEqual(payload);
  });
});

describe("dumpVideoRequest", () => {
  const originalEnv = process.env.SUMMARIZE_DEBUG_DUMP;

  beforeEach(() => {
    delete process.env.SUMMARIZE_DEBUG_DUMP;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SUMMARIZE_DEBUG_DUMP = originalEnv;
    } else {
      delete process.env.SUMMARIZE_DEBUG_DUMP;
    }
  });

  it("is a no-op when SUMMARIZE_DEBUG_DUMP is not set", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    dumpVideoRequest({
      url: "https://openrouter.ai/api/v1/chat/completions",
      payload: { model: "test", messages: [] },
      apiKey: "sk-test",
      modelId: "test-model",
      usage: null,
      elapsedMs: 1000,
    });
    // Should not log anything since it's disabled
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("[summarize:debug]"));
    spy.mockRestore();
  });

  it("is a no-op when SUMMARIZE_DEBUG_DUMP is not 'true'", () => {
    process.env.SUMMARIZE_DEBUG_DUMP = "false";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    dumpVideoRequest({
      url: "https://openrouter.ai/api/v1/chat/completions",
      payload: { model: "test", messages: [] },
      apiKey: "sk-test",
      modelId: "test-model",
      usage: null,
      elapsedMs: 1000,
    });
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("[summarize:debug]"));
    spy.mockRestore();
  });
});
