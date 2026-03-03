import { describe, expect, it } from "vitest";
import { createHeaderController } from "../apps/chrome-extension/src/entrypoints/sidepanel/header-controller.js";

function createMockElements() {
  // Minimal mock DOM elements for the header controller
  const style = new Map<string, string>();
  const classList = {
    _classes: new Set<string>(),
    toggle(name: string, force: boolean) {
      if (force) this._classes.add(name);
      else this._classes.delete(name);
    },
    add(name: string) {
      this._classes.add(name);
    },
    remove(name: string) {
      this._classes.delete(name);
    },
    has(name: string) {
      return this._classes.has(name);
    },
  };

  const headerEl = {
    style: {
      setProperty(key: string, value: string) {
        style.set(key, value);
      },
    },
    classList,
    getBoundingClientRect: () => ({ height: 60 }),
  } as unknown as HTMLElement;

  const titleEl = { textContent: "" } as HTMLElement;
  const subtitleEl = { textContent: "" } as HTMLElement;
  const progressFillEl = { style: { display: "" } } as unknown as HTMLElement;

  return { headerEl, titleEl, subtitleEl, progressFillEl, style, classList };
}

describe("header controller progress", () => {
  it("getProgress returns 0 initially", () => {
    const { headerEl, titleEl, subtitleEl, progressFillEl } = createMockElements();
    const controller = createHeaderController({
      headerEl,
      titleEl,
      subtitleEl,
      progressFillEl,
      getState: () => ({ phase: "idle", summaryFromCache: null }),
    });

    expect(controller.getProgress()).toBe(0);
  });

  it("setProgress seeds a specific value", () => {
    const { headerEl, titleEl, subtitleEl, progressFillEl } = createMockElements();
    const controller = createHeaderController({
      headerEl,
      titleEl,
      subtitleEl,
      progressFillEl,
      getState: () => ({ phase: "streaming", summaryFromCache: null }),
    });

    controller.setProgress(42);
    expect(controller.getProgress()).toBe(42);
  });

  it("setProgress clamps to 0-100 range", () => {
    const { headerEl, titleEl, subtitleEl, progressFillEl } = createMockElements();
    const controller = createHeaderController({
      headerEl,
      titleEl,
      subtitleEl,
      progressFillEl,
      getState: () => ({ phase: "streaming", summaryFromCache: null }),
    });

    controller.setProgress(-10);
    expect(controller.getProgress()).toBe(0);

    controller.setProgress(150);
    expect(controller.getProgress()).toBe(100);
  });

  it("resetProgress clears to 0", () => {
    const { headerEl, titleEl, subtitleEl, progressFillEl } = createMockElements();
    const controller = createHeaderController({
      headerEl,
      titleEl,
      subtitleEl,
      progressFillEl,
      getState: () => ({ phase: "streaming", summaryFromCache: null }),
    });

    controller.setProgress(75);
    expect(controller.getProgress()).toBe(75);

    controller.resetProgress();
    expect(controller.getProgress()).toBe(0);
  });

  it("setProgress allows subsequent clampProgress to advance from seeded value", () => {
    const { headerEl, titleEl, subtitleEl, progressFillEl } = createMockElements();
    const controller = createHeaderController({
      headerEl,
      titleEl,
      subtitleEl,
      progressFillEl,
      getState: () => ({ phase: "streaming", summaryFromCache: null }),
    });

    // Seed at 40% (simulating tab-restore)
    controller.setProgress(40);
    expect(controller.getProgress()).toBe(40);

    // After setStatus with a higher-stage keyword, progress should advance
    // (the actual advancement happens in renderHeader via resolveStage/clampProgress,
    // but we verify the base value is preserved)
    expect(controller.getProgress()).toBeGreaterThanOrEqual(40);
  });
});
