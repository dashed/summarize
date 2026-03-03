import { describe, expect, it } from "vitest";
import type { PromptPart } from "../src/llm/prompt.js";
import { userInterleavedMessage } from "../src/llm/prompt.js";

describe("userInterleavedMessage", () => {
  it("creates a message with interleaved text and image parts", () => {
    const parts: PromptPart[] = [
      { kind: "text", text: "Here is slide 1:" },
      { kind: "image", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
      { kind: "text", text: "Here is slide 2:" },
      { kind: "image", bytes: new Uint8Array([4, 5, 6]), mimeType: "image/png" },
    ];

    const message = userInterleavedMessage({ parts });

    expect(message.role).toBe("user");
    expect(Array.isArray(message.content)).toBe(true);
    const content = message.content as Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    expect(content.length).toBe(4);

    expect(content[0]!.type).toBe("text");
    expect(content[0]!.text).toBe("Here is slide 1:");

    expect(content[1]!.type).toBe("image");
    expect(content[1]!.mimeType).toBe("image/png");
    expect(typeof content[1]!.data).toBe("string"); // base64

    expect(content[2]!.type).toBe("text");
    expect(content[2]!.text).toBe("Here is slide 2:");

    expect(content[3]!.type).toBe("image");
    expect(content[3]!.mimeType).toBe("image/png");
  });

  it("handles text-only parts", () => {
    const parts: PromptPart[] = [{ kind: "text", text: "Just text." }];

    const message = userInterleavedMessage({ parts });
    const content = message.content as Array<{ type: string; text?: string }>;
    expect(content.length).toBe(1);
    expect(content[0]!.type).toBe("text");
    expect(content[0]!.text).toBe("Just text.");
  });

  it("handles image-only parts", () => {
    const parts: PromptPart[] = [
      { kind: "image", bytes: new Uint8Array([10, 20]), mimeType: "image/jpeg" },
    ];

    const message = userInterleavedMessage({ parts });
    const content = message.content as Array<{ type: string; mimeType?: string }>;
    expect(content.length).toBe(1);
    expect(content[0]!.type).toBe("image");
    expect(content[0]!.mimeType).toBe("image/jpeg");
  });

  it("handles empty parts array", () => {
    const message = userInterleavedMessage({ parts: [] });
    const content = message.content as Array<unknown>;
    expect(content.length).toBe(0);
  });
});
