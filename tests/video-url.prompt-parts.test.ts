import { describe, expect, it } from "vitest";
import type { PromptPart } from "../src/llm/prompt.js";
import {
  hasVideoUrlParts,
  stripVideoUrlParts,
  userInterleavedMessage,
} from "../src/llm/prompt.js";
import type { Prompt } from "../src/llm/prompt.js";

describe("PromptPart video_url support", () => {
  describe("hasVideoUrlParts", () => {
    it("returns true when interleavedParts contain a video_url part", () => {
      const prompt: Prompt = {
        userText: "Summarize",
        interleavedParts: [
          { kind: "text", text: "Summarize this video." },
          { kind: "video_url", url: "https://www.youtube.com/watch?v=abc" },
        ],
      };
      expect(hasVideoUrlParts(prompt)).toBe(true);
    });

    it("returns false when interleavedParts contain no video_url part", () => {
      const prompt: Prompt = {
        userText: "Summarize",
        interleavedParts: [
          { kind: "text", text: "Hello" },
          { kind: "image", bytes: new Uint8Array([1, 2]), mimeType: "image/png" },
        ],
      };
      expect(hasVideoUrlParts(prompt)).toBe(false);
    });

    it("returns false when interleavedParts is undefined", () => {
      const prompt: Prompt = { userText: "Hello" };
      expect(hasVideoUrlParts(prompt)).toBe(false);
    });

    it("returns false when interleavedParts is empty", () => {
      const prompt: Prompt = { userText: "Hello", interleavedParts: [] };
      expect(hasVideoUrlParts(prompt)).toBe(false);
    });
  });

  describe("stripVideoUrlParts", () => {
    it("removes video_url parts while keeping text and image", () => {
      const parts: PromptPart[] = [
        { kind: "text", text: "Summarize" },
        { kind: "video_url", url: "https://youtube.com/watch?v=abc" },
        { kind: "image", bytes: new Uint8Array([1]), mimeType: "image/png" },
        { kind: "text", text: "Slide 1" },
      ];
      const stripped = stripVideoUrlParts(parts);
      expect(stripped).toHaveLength(3);
      expect(stripped.every((p) => p.kind !== "video_url")).toBe(true);
      expect(stripped[0]).toEqual({ kind: "text", text: "Summarize" });
      expect(stripped[1]!.kind).toBe("image");
      expect(stripped[2]).toEqual({ kind: "text", text: "Slide 1" });
    });

    it("returns all parts unchanged when there are no video_url parts", () => {
      const parts: PromptPart[] = [
        { kind: "text", text: "Hello" },
        { kind: "image", bytes: new Uint8Array([1, 2]), mimeType: "image/png" },
      ];
      const stripped = stripVideoUrlParts(parts);
      expect(stripped).toHaveLength(2);
    });

    it("returns empty array when all parts are video_url", () => {
      const parts: PromptPart[] = [
        { kind: "video_url", url: "https://youtube.com/watch?v=a" },
        { kind: "video_url", url: "https://youtube.com/watch?v=b" },
      ];
      const stripped = stripVideoUrlParts(parts);
      expect(stripped).toHaveLength(0);
    });
  });

  describe("userInterleavedMessage with video_url parts", () => {
    it("skips video_url parts and only produces text + image content", () => {
      const parts: PromptPart[] = [
        { kind: "text", text: "Summarize this video." },
        { kind: "video_url", url: "https://www.youtube.com/watch?v=abc" },
        { kind: "image", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
        { kind: "text", text: "Slide label" },
      ];

      const message = userInterleavedMessage({ parts });

      expect(message.role).toBe("user");
      const content = message.content as Array<{ type: string; text?: string }>;
      // video_url part is skipped, so 3 content items instead of 4
      expect(content).toHaveLength(3);
      expect(content[0]!.type).toBe("text");
      expect(content[0]!.text).toBe("Summarize this video.");
      expect(content[1]!.type).toBe("image");
      expect(content[2]!.type).toBe("text");
      expect(content[2]!.text).toBe("Slide label");
    });

    it("produces empty content when only video_url parts exist", () => {
      const parts: PromptPart[] = [
        { kind: "video_url", url: "https://youtube.com/watch?v=abc" },
      ];
      const message = userInterleavedMessage({ parts });
      const content = message.content as Array<unknown>;
      expect(content).toHaveLength(0);
    });
  });
});
