// @vitest-environment jsdom

/**
 * Accessibility tests for sidepanel and options HTML using axe-core.
 *
 * Loads each HTML file into jsdom with its CSS inlined, then runs axe-core
 * to catch WCAG 2.1 AA violations. This is a lightweight static check —
 * it tests the initial DOM structure, not dynamic JS-driven states.
 */
import axe from "axe-core";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const EXT = resolve(root, "apps/chrome-extension/src/entrypoints");

interface HtmlPage {
  name: string;
  htmlPath: string;
  cssPath: string;
}

const pages: HtmlPage[] = [
  {
    name: "sidepanel",
    htmlPath: resolve(EXT, "sidepanel/index.html"),
    cssPath: resolve(EXT, "sidepanel/style.css"),
  },
  {
    name: "options",
    htmlPath: resolve(EXT, "options/index.html"),
    cssPath: resolve(EXT, "options/style.css"),
  },
];

/**
 * Prepare an HTML string for axe-core testing:
 * - Inline the CSS (jsdom doesn't load external stylesheets)
 * - Strip <script> tags (avoid execution errors in jsdom)
 * - Strip <link rel="stylesheet"> (replaced by inlined style)
 */
function prepareHtml(htmlSource: string, cssSource: string): string {
  let html = htmlSource;
  // Remove script tags
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  // Remove stylesheet links
  html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*\/?>/gi, "");
  // Inject CSS as inline <style> in <head>
  html = html.replace("</head>", `<style>${cssSource}</style></head>`);
  return html;
}

/** Format axe violations into a readable string for test output. */
function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 3)
        .map((n) => `    ${n.html.slice(0, 120)}`)
        .join("\n");
      const more = v.nodes.length > 3 ? `\n    ... and ${v.nodes.length - 3} more` : "";
      return `  [${v.impact}] ${v.id}: ${v.help} (${v.helpUrl})\n${nodes}${more}`;
    })
    .join("\n\n");
}

// Rules to skip — these are either false positives in jsdom or
// inapplicable to an extension sidepanel context.
const SKIPPED_RULES = [
  // jsdom doesn't render CSS, so color contrast checks are unreliable
  "color-contrast",
  // Extension sidepanel isn't a full page — no <main> landmark needed
  // (it has <main> but axe may flag header/footer landmark issues)
  "landmark-one-main",
  // The sidepanel HTML has regions that are toggled by JS; static
  // analysis sees all of them at once and may flag landmark structure
  "region",
  // Page-level rules that don't apply to an extension panel
  "page-has-heading-one",
  // jsdom doesn't load external resources; skip image alt checks for
  // SVG icons that have aria-hidden="true" on their parent buttons
  "svg-img-alt",
];

// Cache file reads — each page's HTML/CSS is read once, not per test.
const fileCache = new Map<string, string>();
function cachedRead(filePath: string): string {
  let content = fileCache.get(filePath);
  if (content === undefined) {
    content = readFileSync(filePath, "utf-8");
    fileCache.set(filePath, content);
  }
  return content;
}

function loadPageIntoDocument(page: HtmlPage): void {
  const prepared = prepareHtml(cachedRead(page.htmlPath), cachedRead(page.cssPath));
  document.documentElement.innerHTML = "";
  document.open();
  document.write(prepared);
  document.close();
}

const defaultAxeOptions: axe.RunOptions = {
  rules: Object.fromEntries(SKIPPED_RULES.map((id) => [id, { enabled: false }])),
  resultTypes: ["violations"],
};

describe("accessibility (axe-core)", () => {
  for (const page of pages) {
    describe(page.name, () => {
      it("has no critical or serious WCAG 2.1 AA violations", async () => {
        loadPageIntoDocument(page);
        const results = await axe.run(document.documentElement, defaultAxeOptions);
        const serious = results.violations.filter(
          (v) => v.impact === "critical" || v.impact === "serious",
        );
        if (serious.length > 0) {
          expect.fail(
            `Found ${serious.length} critical/serious accessibility violation(s):\n\n${formatViolations(serious)}`,
          );
        }
      });

      it("has no moderate accessibility violations", async () => {
        loadPageIntoDocument(page);
        const results = await axe.run(document.documentElement, defaultAxeOptions);
        const moderate = results.violations.filter((v) => v.impact === "moderate");
        if (moderate.length > 0) {
          expect.fail(
            `Found ${moderate.length} moderate accessibility violation(s):\n\n${formatViolations(moderate)}`,
          );
        }
      });

      it("all interactive elements have accessible names", async () => {
        loadPageIntoDocument(page);

        const buttons = document.querySelectorAll("button");
        const unlabeled: string[] = [];
        for (const btn of buttons) {
          const text = btn.textContent?.trim();
          const ariaLabel = btn.getAttribute("aria-label");
          const ariaLabelledBy = btn.getAttribute("aria-labelledby");
          const title = btn.getAttribute("title");
          if (!text && !ariaLabel && !ariaLabelledBy && !title) {
            unlabeled.push(btn.outerHTML.slice(0, 100));
          }
        }
        expect(
          unlabeled,
          `Buttons without accessible names:\n${unlabeled.join("\n")}`,
        ).toEqual([]);

        const inputs = document.querySelectorAll("input, textarea, select");
        const unlabeledInputs: string[] = [];
        for (const input of inputs) {
          const el = input as HTMLElement;
          const id = el.id;
          const ariaLabel = el.getAttribute("aria-label");
          const ariaLabelledBy = el.getAttribute("aria-labelledby");
          const placeholder = el.getAttribute("placeholder");
          const hasLabel = id && document.querySelector(`label[for="${id}"]`);
          const parentLabel = el.closest("label");
          if ((input as HTMLInputElement).type === "hidden") continue;
          if (el.hasAttribute("hidden")) continue;
          if (!ariaLabel && !ariaLabelledBy && !hasLabel && !parentLabel && !placeholder) {
            unlabeledInputs.push(el.outerHTML.slice(0, 100));
          }
        }
        expect(
          unlabeledInputs,
          `Inputs without accessible names:\n${unlabeledInputs.join("\n")}`,
        ).toEqual([]);
      });

      it("ARIA attributes are valid", async () => {
        loadPageIntoDocument(page);
        const results = await axe.run(document.documentElement, {
          runOnly: {
            type: "rule",
            values: [
              "aria-allowed-attr",
              "aria-hidden-body",
              "aria-hidden-focus",
              "aria-required-attr",
              "aria-required-children",
              "aria-required-parent",
              "aria-roles",
              "aria-valid-attr",
              "aria-valid-attr-value",
            ],
          },
          resultTypes: ["violations"],
        });
        if (results.violations.length > 0) {
          expect.fail(
            `Found ${results.violations.length} ARIA violation(s):\n\n${formatViolations(results.violations)}`,
          );
        }
      });
    });
  }
});
