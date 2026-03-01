import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildSummarizeRequestBody } from "../apps/chrome-extension/src/lib/daemon-payload.js";
import { defaultSettings } from "../apps/chrome-extension/src/lib/settings.js";

describe("chrome/cookies", () => {
  describe("exportYouTubeCookies", () => {
    let exportYouTubeCookies: typeof import("../apps/chrome-extension/src/lib/cookies.js").exportYouTubeCookies;

    beforeEach(async () => {
      // Reset module cache so each test gets a fresh import
      vi.resetModules();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns null when chrome.cookies API is unavailable", async () => {
      vi.stubGlobal("chrome", {});
      ({ exportYouTubeCookies } = await import("../apps/chrome-extension/src/lib/cookies.js"));
      expect(await exportYouTubeCookies()).toBeNull();
    });

    it("returns null when no cookies are found", async () => {
      vi.stubGlobal("chrome", {
        cookies: { getAll: vi.fn().mockResolvedValue([]) },
      });
      ({ exportYouTubeCookies } = await import("../apps/chrome-extension/src/lib/cookies.js"));
      expect(await exportYouTubeCookies()).toBeNull();
    });

    it("returns Netscape cookie jar string for YouTube cookies", async () => {
      const mockCookies: Partial<chrome.cookies.Cookie>[] = [
        {
          domain: ".youtube.com",
          name: "SID",
          value: "abc123",
          path: "/",
          secure: true,
          expirationDate: 1735689600,
        },
        {
          domain: ".youtube.com",
          name: "HSID",
          value: "def456",
          path: "/",
          secure: false,
          expirationDate: 1735689600,
        },
      ];
      vi.stubGlobal("chrome", {
        cookies: { getAll: vi.fn().mockResolvedValue(mockCookies) },
      });
      ({ exportYouTubeCookies } = await import("../apps/chrome-extension/src/lib/cookies.js"));

      const result = await exportYouTubeCookies();
      expect(result).not.toBeNull();
      expect(result).toContain("# Netscape HTTP Cookie File");
      expect(result).toContain(".youtube.com\tTRUE\t/\tTRUE\t1735689600\tSID\tabc123");
      expect(result).toContain(".youtube.com\tTRUE\t/\tFALSE\t1735689600\tHSID\tdef456");
      expect(result!.endsWith("\n")).toBe(true);
    });

    it("marks non-dot-prefixed domains as FALSE for include_subdomains", async () => {
      const mockCookies: Partial<chrome.cookies.Cookie>[] = [
        {
          domain: "www.youtube.com",
          name: "PREF",
          value: "xyz",
          path: "/",
          secure: true,
          expirationDate: 0,
        },
      ];
      vi.stubGlobal("chrome", {
        cookies: { getAll: vi.fn().mockResolvedValue(mockCookies) },
      });
      ({ exportYouTubeCookies } = await import("../apps/chrome-extension/src/lib/cookies.js"));

      const result = await exportYouTubeCookies();
      expect(result).toContain("www.youtube.com\tFALSE\t/\tTRUE\t0\tPREF\txyz");
    });

    it("queries both .youtube.com and .google.com domains", async () => {
      const getAll = vi.fn().mockResolvedValue([]);
      vi.stubGlobal("chrome", { cookies: { getAll } });
      ({ exportYouTubeCookies } = await import("../apps/chrome-extension/src/lib/cookies.js"));

      await exportYouTubeCookies();
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(getAll).toHaveBeenCalledWith({ domain: ".youtube.com" });
      expect(getAll).toHaveBeenCalledWith({ domain: ".google.com" });
    });

    it("handles cookies without expirationDate", async () => {
      const mockCookies: Partial<chrome.cookies.Cookie>[] = [
        {
          domain: ".youtube.com",
          name: "SESSION",
          value: "sess",
          path: "/",
          secure: false,
        },
      ];
      vi.stubGlobal("chrome", {
        cookies: { getAll: vi.fn().mockResolvedValue(mockCookies) },
      });
      ({ exportYouTubeCookies } = await import("../apps/chrome-extension/src/lib/cookies.js"));

      const result = await exportYouTubeCookies();
      expect(result).toContain(".youtube.com\tTRUE\t/\tFALSE\t0\tSESSION\tsess");
    });
  });

  describe("buildSummarizeRequestBody with cookies", () => {
    const extracted = {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Video",
      text: "",
      truncated: false,
    };

    it("includes cookies field when provided", () => {
      const cookies = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n";
      const body = buildSummarizeRequestBody({
        extracted,
        settings: defaultSettings,
        slides: { enabled: true },
        cookies,
      });

      expect(body.cookies).toBe(cookies);
      expect(body.slides).toBe(true);
    });

    it("omits cookies field when null", () => {
      const body = buildSummarizeRequestBody({
        extracted,
        settings: defaultSettings,
        slides: { enabled: true },
        cookies: null,
      });

      expect(body).not.toHaveProperty("cookies");
    });

    it("omits cookies field when undefined", () => {
      const body = buildSummarizeRequestBody({
        extracted,
        settings: defaultSettings,
        slides: { enabled: true },
      });

      expect(body).not.toHaveProperty("cookies");
    });

    it("includes cookies in video mode", () => {
      const cookies = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n";
      const body = buildSummarizeRequestBody({
        extracted,
        settings: defaultSettings,
        inputMode: "video",
        slides: { enabled: true },
        cookies,
      });

      expect(body.cookies).toBe(cookies);
      expect(body.mode).toBe("url");
      expect(body.videoMode).toBe("transcript");
    });

    it("includes cookies even in page mode", () => {
      const cookies = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n";
      const body = buildSummarizeRequestBody({
        extracted,
        settings: defaultSettings,
        inputMode: "page",
        cookies,
      });

      expect(body.cookies).toBe(cookies);
      expect(body.mode).toBe("page");
    });
  });
});
