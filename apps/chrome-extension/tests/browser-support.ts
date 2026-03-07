import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";

function runningInCi() {
  return process.env.CI === "1" || process.env.CI === "true";
}

// Local dev hosts sometimes have Playwright Chromium downloaded but missing
// the shared libraries it needs to start. Skip Chromium E2E there instead of
// failing every test at browser launch.
export function getLocalChromiumSupportIssue(): string | null {
  if (runningInCi()) return null;

  let executablePath = "";
  try {
    executablePath = chromium.executablePath();
  } catch {
    return null;
  }

  const result = spawnSync(executablePath, ["--version"], { encoding: "utf8" });
  const stderr = `${result.stderr ?? ""}`.trim();

  if (result.error?.code === "ENOENT") {
    return [
      "Playwright Chromium is not installed locally.",
      "Run: pnpm -C apps/chrome-extension exec playwright install chromium",
    ].join(" ");
  }

  if (/error while loading shared libraries:|cannot open shared object file/i.test(stderr)) {
    const detail = stderr.split("\n").at(-1) ?? stderr;
    return [
      "Playwright Chromium cannot start on this host.",
      detail,
      "Install the missing system libraries or run the extension E2E suite in a supported environment.",
    ].join(" ");
  }

  return null;
}
