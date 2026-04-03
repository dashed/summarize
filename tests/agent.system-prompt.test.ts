import { describe, expect, it } from "vitest";
import { getAgentBaseSystemPrompt } from "../src/daemon/agent.js";

describe("getAgentBaseSystemPrompt", () => {
  it("returns chat-only prompt when automation is disabled", () => {
    const prompt = getAgentBaseSystemPrompt(false, false);
    expect(prompt).toContain("Summarize Chat");
    expect(prompt).not.toContain("Summarize Automation");
  });

  it("returns automation prompt when automation is enabled", () => {
    const prompt = getAgentBaseSystemPrompt(true, false);
    expect(prompt).toContain("Summarize Automation");
    expect(prompt).not.toContain("Summarize Chat");
  });

  it("includes timestamp instructions when hasTimestamps is true", () => {
    const prompt = getAgentBaseSystemPrompt(false, true);
    expect(prompt).toContain("Timestamps");
    expect(prompt).toContain("[mm:ss]");
  });

  it("excludes timestamp instructions when hasTimestamps is false", () => {
    const prompt = getAgentBaseSystemPrompt(false, false);
    expect(prompt).not.toContain("# Timestamps");
  });

  it("includes both automation and timestamps when both enabled", () => {
    const prompt = getAgentBaseSystemPrompt(true, true);
    expect(prompt).toContain("Summarize Automation");
    expect(prompt).toContain("Timestamps");
  });

  it("does not include page content or page URL", () => {
    const prompt = getAgentBaseSystemPrompt(false, false);
    expect(prompt).not.toContain("Page URL:");
    expect(prompt).not.toContain("<page_content>");
  });

  it("returns a non-empty trimmed string", () => {
    const prompt = getAgentBaseSystemPrompt(false, false);
    expect(prompt.length).toBeGreaterThan(50);
    expect(prompt).toBe(prompt.trim());
  });

  it("includes KaTeX math instruction", () => {
    const prompt = getAgentBaseSystemPrompt(false, false);
    expect(prompt).toContain("KaTeX");
  });
});
