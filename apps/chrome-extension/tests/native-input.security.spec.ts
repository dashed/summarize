import type { BrowserContext, Page, Worker } from "@playwright/test";
import { chromium, expect, test } from "@playwright/test";
import { createServer as createHttpServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLocalChromiumSupportIssue } from "./browser-support";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localChromiumSupportIssue = getLocalChromiumSupportIssue();

type ExtensionHarness = {
  context: BrowserContext;
  extensionId: string;
  pageErrors: Error[];
  consoleErrors: string[];
  userDataDir: string;
};

function getExtensionPath(): string {
  return path.resolve(__dirname, "..", ".output", "chrome-mv3");
}

async function launchExtension(): Promise<ExtensionHarness> {
  const extensionPath = getExtensionPath();
  if (!fs.existsSync(extensionPath)) {
    throw new Error("Missing built extension. Run: pnpm -C apps/chrome-extension build");
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "summarize-ext-security-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      "--start-minimized",
      "--window-position=-10000,-10000",
      "--window-size=10,10",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  await context.route("**/favicon.ico", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });

  const background =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  const extensionId = new URL(background.url()).host;

  return {
    context,
    extensionId,
    pageErrors: [],
    consoleErrors: [],
    userDataDir,
  };
}

async function closeExtension(context: BrowserContext, userDataDir: string) {
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

async function getBackground(harness: ExtensionHarness): Promise<Worker> {
  return (
    harness.context.serviceWorkers()[0] ??
    (await harness.context.waitForEvent("serviceworker", { timeout: 15_000 }))
  );
}

function trackErrors(page: Page, pageErrors: Error[], consoleErrors: string[]) {
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    consoleErrors.push(message.text());
  });
}

function assertNoErrors(harness: ExtensionHarness) {
  expect(harness.pageErrors.map((error) => error.message)).toEqual([]);
  expect(harness.consoleErrors).toEqual([]);
}

async function injectContentScript(harness: ExtensionHarness, file: string, urlPrefix: string) {
  const background = await getBackground(harness);
  await background.evaluate(
    async ({ scriptFile, prefix }) => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find((tab) => tab.url?.startsWith(prefix));
      if (!target?.id) throw new Error("missing tab");
      await chrome.scripting.executeScript({
        target: { tabId: target.id },
        files: [scriptFile],
      });
    },
    { scriptFile: file, prefix: urlPrefix },
  );
}

test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only extension security test");
test.skip(
  localChromiumSupportIssue !== null,
  localChromiumSupportIssue ?? "Chromium E2E host support check passed.",
);

test("page scripts cannot spoof the deleted summarize-native-input bridge", async () => {
  const harness = await launchExtension();
  const server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
      <html>
        <body>
          <button
            id="target"
            onclick="window.__clicks = (window.__clicks || 0) + 1; document.getElementById('count').textContent = String(window.__clicks);"
          >
            Target
          </button>
          <div id="count">0</div>
        </body>
      </html>`);
  });

  let serverUrl = "";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve local server port"));
        return;
      }
      serverUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });

  try {
    const page = await harness.context.newPage();
    trackErrors(page, harness.pageErrors, harness.consoleErrors);
    await page.goto(serverUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#target");

    await injectContentScript(harness, "content-scripts/automation.js", serverUrl);

    const result = await page.evaluate(async () => {
      const button = document.getElementById("target");
      const count = document.getElementById("count");
      if (!(button instanceof HTMLElement) || !(count instanceof HTMLElement)) {
        throw new Error("Missing target elements");
      }

      let reply: unknown = null;
      const requestId = "attack-1";
      const rect = button.getBoundingClientRect();
      const handler = (event: MessageEvent) => {
        const data = event.data as { source?: string; requestId?: string } | null;
        if (!data || data.source !== "summarize-native-input" || data.requestId !== requestId) {
          return;
        }
        reply = data;
      };

      window.addEventListener("message", handler);
      window.postMessage(
        {
          source: "summarize-native-input",
          requestId,
          payload: {
            action: "click",
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          },
        },
        "*",
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      window.removeEventListener("message", handler);

      return {
        gotReply: reply !== null,
        count: count.textContent,
      };
    });

    expect(result).toEqual({
      gotReply: false,
      count: "0",
    });
    assertNoErrors(harness);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeExtension(harness.context, harness.userDataDir);
  }
});
