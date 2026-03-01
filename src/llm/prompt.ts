import type { ImageContent, TextContent, UserMessage } from "@mariozechner/pi-ai";
import type { Attachment } from "./attachments.js";

export type PromptPart =
  | { kind: "text"; text: string }
  | { kind: "image"; bytes: Uint8Array; mimeType: string }
  | { kind: "video_url"; url: string };

export type Prompt = {
  system?: string;
  userText: string;
  attachments?: Attachment[];
  /** When set, overrides userText+attachments with interleaved text/image parts. */
  interleavedParts?: PromptPart[];
};

export function userTextMessage(text: string, timestamp = Date.now()): UserMessage {
  return { role: "user", content: text, timestamp };
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function userTextAndImageMessage({
  text,
  imageBytes,
  mimeType,
  timestamp = Date.now(),
}: {
  text: string;
  imageBytes: Uint8Array;
  mimeType: string;
  timestamp?: number;
}): UserMessage {
  const parts: Array<TextContent | ImageContent> = [
    { type: "text", text },
    { type: "image", data: bytesToBase64(imageBytes), mimeType },
  ];
  return { role: "user", content: parts, timestamp };
}

export function userTextAndImagesMessage({
  text,
  images,
  timestamp = Date.now(),
}: {
  text: string;
  images: Array<{ imageBytes: Uint8Array; mimeType: string }>;
  timestamp?: number;
}): UserMessage {
  const parts: Array<TextContent | ImageContent> = [{ type: "text", text }];
  for (const image of images) {
    parts.push({ type: "image", data: bytesToBase64(image.imageBytes), mimeType: image.mimeType });
  }
  return { role: "user", content: parts, timestamp };
}

/**
 * Returns true when the prompt contains `video_url` interleaved parts that
 * require a raw fetch path (pi-ai has no video content type).
 */
export function hasVideoUrlParts(prompt: Prompt): boolean {
  return prompt.interleavedParts?.some((p) => p.kind === "video_url") ?? false;
}

/**
 * Strip video_url parts from interleaved parts (used when the provider does
 * not support video and we need to fall back to text+image only).
 */
export function stripVideoUrlParts(parts: PromptPart[]): PromptPart[] {
  return parts.filter((p) => p.kind !== "video_url");
}

export function userInterleavedMessage({
  parts,
  timestamp = Date.now(),
}: {
  parts: PromptPart[];
  timestamp?: number;
}): UserMessage {
  const content: Array<TextContent | ImageContent> = [];
  for (const part of parts) {
    if (part.kind === "text") {
      content.push({ type: "text", text: part.text });
    } else if (part.kind === "image") {
      content.push({ type: "image", data: bytesToBase64(part.bytes), mimeType: part.mimeType });
    }
    // video_url parts are skipped — they are handled by the raw fetch path.
  }
  return { role: "user", content, timestamp };
}
