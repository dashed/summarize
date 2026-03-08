/**
 * Lightweight visual-safety tests for the sidepanel CSS + HTML.
 *
 * These tests parse the raw CSS and HTML files to catch known classes of
 * rendering bugs — e.g. `overflow: hidden` collapsing `<details>` elements,
 * missing `<summary>` children, or broken `.hidden` semantics.
 *
 * No browser or DOM library is needed; everything runs via string/regex parsing.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const CSS_PATH = resolve(root, "apps/chrome-extension/src/entrypoints/sidepanel/style.css");
const HTML_PATH = resolve(root, "apps/chrome-extension/src/entrypoints/sidepanel/index.html");

const css = readFileSync(CSS_PATH, "utf-8");
const html = readFileSync(HTML_PATH, "utf-8");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CssRule = { selector: string; body: string };

/** Lightweight CSS rule extractor (no dependency). Handles nested @media/@keyframes. */
function parseCssRules(source: string): CssRule[] {
  // Strip comments
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");

  const rules: CssRule[] = [];

  // Walk through the source tracking brace depth to handle nested blocks.
  // At depth 0: top-level rules and @-rule openers
  // At depth 1 inside @media: inner rules
  // @keyframes are skipped entirely
  let i = 0;
  const len = clean.length;

  function skipWhitespace() {
    while (i < len && /\s/.test(clean[i])) i++;
  }

  function readUntil(chars: string): string {
    const start = i;
    while (i < len && !chars.includes(clean[i])) i++;
    return clean.slice(start, i);
  }

  function skipBlock() {
    // Skip a { ... } block including nested braces
    if (clean[i] !== "{") return;
    i++; // skip opening {
    let depth = 1;
    while (i < len && depth > 0) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}") depth--;
      i++;
    }
  }

  function parseRulesAtLevel() {
    while (i < len) {
      skipWhitespace();
      if (i >= len || clean[i] === "}") break;

      const selector = readUntil("{").trim();
      if (i >= len) break;

      if (selector.startsWith("@keyframes") || selector.startsWith("@-webkit-keyframes")) {
        skipBlock(); // skip entire keyframes block
        continue;
      }

      if (selector.startsWith("@media") || selector.startsWith("@supports")) {
        i++; // skip opening {
        parseRulesAtLevel(); // recurse into inner rules
        if (i < len && clean[i] === "}") i++; // skip closing }
        continue;
      }

      if (selector.startsWith("@")) {
        // Other at-rules (e.g. @font-face) — treat like a normal rule
        i++; // skip {
        const body = readUntil("}");
        if (i < len) i++; // skip }
        rules.push({ selector, body: body.trim() });
        continue;
      }

      // Normal rule
      i++; // skip {
      const body = readUntil("}");
      if (i < len) i++; // skip }
      if (selector) {
        rules.push({ selector, body: body.trim() });
      }
    }
  }

  parseRulesAtLevel();
  return rules;
}

/** Return the CSS body for rules whose selector matches `classSelector` (e.g. ".foo"). */
function rulesForClass(rules: CssRule[], classSelector: string): CssRule[] {
  return rules.filter((r) => {
    // Split compound selectors on commas and check each part
    return r.selector.split(",").some((part) => {
      const trimmed = part.trim();
      // Match .foo, .foo[attr], .foo:pseudo, .foo > ..., .foo .bar, etc.
      return (
        trimmed === classSelector ||
        trimmed.startsWith(`${classSelector} `) ||
        trimmed.startsWith(`${classSelector}.`) ||
        trimmed.startsWith(`${classSelector}:`) ||
        trimmed.startsWith(`${classSelector}[`) ||
        trimmed.startsWith(`${classSelector}>`)
      );
    });
  });
}

/** Check if a CSS body string contains a given property:value pattern. */
function hasProperty(body: string, property: string, valuePattern?: RegExp | string): boolean {
  const re = new RegExp(
    `(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`,
    "i",
  );
  const m = re.exec(body);
  if (!m) return false;
  if (!valuePattern) return true;
  const val = m[1].trim();
  return typeof valuePattern === "string" ? val === valuePattern : valuePattern.test(val);
}

/** Extract all elements of a given tag with their id and class attributes. */
function elementsOfTag(
  htmlSource: string,
  tag: string,
): Array<{ id: string | null; classes: string[]; outerMatch: string }> {
  const re = new RegExp(`<${tag}\\b([^>]*)>`, "gi");
  const results: Array<{ id: string | null; classes: string[]; outerMatch: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlSource))) {
    const attrs = m[1];
    const idMatch = /\bid="([^"]*)"/.exec(attrs);
    const classMatch = /\bclass="([^"]*)"/.exec(attrs);
    results.push({
      id: idMatch?.[1] ?? null,
      classes: classMatch?.[1].split(/\s+/).filter(Boolean) ?? [],
      outerMatch: m[0],
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Parsed data
// ---------------------------------------------------------------------------

const rules = parseCssRules(css);
const detailsElements = elementsOfTag(html, "details");
const dialogElements = elementsOfTag(html, "dialog");
const selectElements = elementsOfTag(html, "select");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sidepanel CSS safety", () => {
  describe("overflow: hidden must not be applied to interactive elements", () => {
    // `overflow: hidden` on <details> collapses the element to zero height in Chrome
    // when the element is closed (no `open` attribute). Same risk with <dialog>.
    const interactiveElements = [
      ...detailsElements.map((e) => ({ ...e, tag: "details" })),
      ...dialogElements.map((e) => ({ ...e, tag: "dialog" })),
    ];

    for (const el of interactiveElements) {
      const label = el.id ? `<${el.tag} id="${el.id}">` : `<${el.tag} class="${el.classes.join(" ")}">`;

      it(`${label} classes must not have overflow: hidden`, () => {
        for (const cls of el.classes) {
          const matching = rulesForClass(rules, `.${cls}`);
          for (const rule of matching) {
            expect(
              hasProperty(rule.body, "overflow", "hidden"),
              `Rule "${rule.selector}" applies overflow: hidden — this collapses <${el.tag}> to zero height in Chrome. ` +
                `Use overflow: hidden on inner content elements instead.`,
            ).toBe(false);
          }
        }
      });
    }
  });

  describe("every <details> must have a <summary> child", () => {
    for (const el of detailsElements) {
      const label = el.id ? `#${el.id}` : `.${el.classes[0] ?? "unknown"}`;
      it(`${label} has a <summary> child`, () => {
        // Find the <details> opening tag and check for <summary> before the next </details>
        const idx = html.indexOf(el.outerMatch);
        const closeIdx = html.indexOf("</details>", idx);
        const inner = html.slice(idx, closeIdx);
        expect(inner).toMatch(/<summary[\s>]/);
      });
    }
  });

  describe(".hidden class semantics", () => {
    it(".hidden sets display: none", () => {
      const hiddenRules = rules.filter((r) =>
        r.selector.split(",").some((s) => s.trim() === ".hidden"),
      );
      expect(hiddenRules.length).toBeGreaterThan(0);
      const hasDisplayNone = hiddenRules.some((r) =>
        hasProperty(r.body, "display", "none"),
      );
      expect(hasDisplayNone, ".hidden must set display: none").toBe(true);
    });

    it("element-specific .hidden variants also set display: none", () => {
      // Find rules like .slideNotice.hidden, .automationNotice.hidden, etc.
      const specificHidden = rules.filter(
        (r) => r.selector.includes(".hidden") && r.selector !== ".hidden",
      );
      for (const rule of specificHidden) {
        if (!rule.selector.includes(".hidden")) continue;
        expect(
          hasProperty(rule.body, "display", "none"),
          `${rule.selector} should set display: none`,
        ).toBe(true);
      }
    });
  });

  describe("visibility anti-patterns", () => {
    it("no rules use visibility: hidden without a transition context", () => {
      // visibility: hidden is fine in transitions, but dangerous as a static style
      // because the element still takes up layout space (unlike display: none).
      const visHidden = rules.filter(
        (r) =>
          hasProperty(r.body, "visibility", "hidden") &&
          !r.body.includes("transition") &&
          !r.selector.includes(":") && // pseudo-classes often use visibility for animation
          !r.selector.includes("@"),
      );
      for (const rule of visHidden) {
        expect.soft(
          false,
          `${rule.selector} uses visibility: hidden without a transition. ` +
            `Consider display: none or the .hidden class instead.`,
        ).toBe(true);
      }
    });

    it("no rules set opacity: 0 as a static hidden mechanism", () => {
      // opacity: 0 hides content visually but keeps it interactive (clickable).
      // Exclude rules that also set pointer-events: none (intentional overlay pattern).
      const opacityZero = rules.filter(
        (r) =>
          hasProperty(r.body, "opacity", "0") &&
          !hasProperty(r.body, "pointer-events", "none") &&
          !r.body.includes("transition") &&
          !r.body.includes("animation") &&
          !r.selector.includes(":") &&
          !r.selector.includes("@") &&
          !r.selector.includes("keyframe"),
      );
      for (const rule of opacityZero) {
        expect.soft(
          false,
          `${rule.selector} uses opacity: 0 without transition/animation. ` +
            `This hides content visually but keeps it interactive.`,
        ).toBe(true);
      }
    });
  });

  describe("structural integrity", () => {
    it("all id attributes in HTML are unique", () => {
      const idRe = /\bid="([^"]+)"/g;
      const ids = new Map<string, number>();
      let m: RegExpExecArray | null;
      while ((m = idRe.exec(html))) {
        ids.set(m[1], (ids.get(m[1]) ?? 0) + 1);
      }
      const dupes = [...ids.entries()].filter(([, count]) => count > 1);
      expect(dupes, `Duplicate IDs found: ${dupes.map(([id]) => id).join(", ")}`).toEqual([]);
    });

    it("every element with a .hidden class has a corresponding non-hidden state", () => {
      // Elements born with .hidden should have JS that removes it.
      // We just verify the class exists in the stylesheet so it's styled.
      const hiddenEls = elementsOfTag(html, "[^/]\\w+").filter((e) =>
        e.classes.includes("hidden"),
      );
      // The .hidden rule should exist
      const hiddenRule = rules.some((r) =>
        r.selector.split(",").some((s) => s.trim() === ".hidden"),
      );
      expect(hiddenRule, "Generic .hidden class must be defined in CSS").toBe(true);
      expect(hiddenEls.length).toBeGreaterThan(0); // sanity: some elements start hidden
    });

    it("no <button> elements are missing a type attribute", () => {
      const buttonRe = /<button\b([^>]*)>/gi;
      let m: RegExpExecArray | null;
      const missingType: string[] = [];
      while ((m = buttonRe.exec(html))) {
        if (!/\btype=/.test(m[1])) {
          const idMatch = /\bid="([^"]*)"/.exec(m[1]);
          missingType.push(idMatch?.[1] ?? m[0].slice(0, 60));
        }
      }
      expect(
        missingType,
        `Buttons without type= default to "submit" which can trigger form submission: ${missingType.join(", ")}`,
      ).toEqual([]);
    });
  });

  describe("CSS parser sanity", () => {
    it("parses a reasonable number of rules", () => {
      expect(rules.length).toBeGreaterThan(50);
    });

    it("finds the .systemPromptSection rule", () => {
      const found = rulesForClass(rules, ".systemPromptSection");
      expect(found.length).toBeGreaterThan(0);
    });

    it("finds the .hidden rule", () => {
      const found = rules.filter((r) =>
        r.selector.split(",").some((s) => s.trim() === ".hidden"),
      );
      expect(found.length).toBeGreaterThan(0);
    });
  });
});
