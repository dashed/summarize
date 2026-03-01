import { describe, expect, it } from "vitest";
import { buildYtDlpCookiesArgs } from "../src/slides/index.js";

describe("buildYtDlpCookiesArgs", () => {
  it("returns --cookies when cookiesFile is set", () => {
    expect(buildYtDlpCookiesArgs({ cookiesFile: "/tmp/cookies.txt" })).toEqual([
      "--cookies",
      "/tmp/cookies.txt",
    ]);
  });

  it("returns --cookies-from-browser when only cookiesFromBrowser is set", () => {
    expect(buildYtDlpCookiesArgs({ cookiesFromBrowser: "chrome" })).toEqual([
      "--cookies-from-browser",
      "chrome",
    ]);
  });

  it("prefers cookiesFile over cookiesFromBrowser when both are set", () => {
    expect(
      buildYtDlpCookiesArgs({ cookiesFile: "/tmp/cookies.txt", cookiesFromBrowser: "edge" }),
    ).toEqual(["--cookies", "/tmp/cookies.txt"]);
  });

  it("returns empty array when neither is set", () => {
    expect(buildYtDlpCookiesArgs({})).toEqual([]);
  });

  it("returns empty array when both are null", () => {
    expect(buildYtDlpCookiesArgs({ cookiesFile: null, cookiesFromBrowser: null })).toEqual([]);
  });

  it("returns empty array when both are undefined", () => {
    expect(
      buildYtDlpCookiesArgs({ cookiesFile: undefined, cookiesFromBrowser: undefined }),
    ).toEqual([]);
  });

  it("ignores empty string cookiesFile and falls back to cookiesFromBrowser", () => {
    expect(buildYtDlpCookiesArgs({ cookiesFile: "", cookiesFromBrowser: "firefox" })).toEqual([
      "--cookies-from-browser",
      "firefox",
    ]);
  });

  it("ignores whitespace-only cookiesFile and falls back to cookiesFromBrowser", () => {
    expect(buildYtDlpCookiesArgs({ cookiesFile: "   ", cookiesFromBrowser: "chrome" })).toEqual([
      "--cookies-from-browser",
      "chrome",
    ]);
  });

  it("ignores empty string cookiesFromBrowser", () => {
    expect(buildYtDlpCookiesArgs({ cookiesFromBrowser: "" })).toEqual([]);
  });

  it("ignores whitespace-only cookiesFromBrowser", () => {
    expect(buildYtDlpCookiesArgs({ cookiesFromBrowser: "   " })).toEqual([]);
  });

  it("trims cookiesFile path", () => {
    expect(buildYtDlpCookiesArgs({ cookiesFile: "  /tmp/cookies.txt  " })).toEqual([
      "--cookies",
      "/tmp/cookies.txt",
    ]);
  });

  it("trims cookiesFromBrowser value", () => {
    expect(buildYtDlpCookiesArgs({ cookiesFromBrowser: "  edge  " })).toEqual([
      "--cookies-from-browser",
      "edge",
    ]);
  });
});
