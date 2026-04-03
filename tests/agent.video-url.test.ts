import { describe, it, expect } from "vitest";
import { isYouTubeUrl } from "../src/daemon/agent.js";

describe("isYouTubeUrl", () => {
  it("matches standard youtube.com/watch URLs", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("http://www.youtube.com/watch?v=abc123")).toBe(true);
    expect(isYouTubeUrl("https://youtube.com/watch?v=abc123")).toBe(true);
  });

  it("matches youtu.be short links", () => {
    expect(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("http://youtu.be/abc123")).toBe(true);
  });

  it("matches youtube.com/live URLs", () => {
    expect(isYouTubeUrl("https://www.youtube.com/live/abc123")).toBe(true);
    expect(isYouTubeUrl("https://youtube.com/live/abc123")).toBe(true);
  });

  it("matches mobile youtube URLs", () => {
    expect(isYouTubeUrl("https://m.youtube.com/watch?v=abc123")).toBe(true);
  });

  it("rejects non-YouTube URLs", () => {
    expect(isYouTubeUrl("https://www.google.com")).toBe(false);
    expect(isYouTubeUrl("https://vimeo.com/12345")).toBe(false);
    expect(isYouTubeUrl("https://example.com/youtube.com/watch")).toBe(false);
    expect(isYouTubeUrl("")).toBe(false);
  });

  it("rejects YouTube URLs that are not video pages", () => {
    expect(isYouTubeUrl("https://www.youtube.com/channel/UC123")).toBe(false);
    expect(isYouTubeUrl("https://www.youtube.com/playlist?list=PL123")).toBe(false);
    expect(isYouTubeUrl("https://www.youtube.com/@username")).toBe(false);
  });
});
