import { describe, expect, it, vi } from "vitest";
import {
  handleArtifactsRequest,
  handleNativeInputRequest,
} from "../apps/chrome-extension/src/automation/user-script-requests.js";

describe("chrome/user-script-requests", () => {
  it("rejects native input when the sender tab is missing", async () => {
    const dispatchNativeInput = vi.fn();

    const response = await handleNativeInputRequest({
      request: {
        type: "automation:native-input",
        payload: { action: "click", x: 12, y: 34 },
      },
      tabId: null,
      dispatchNativeInput,
    });

    expect(response).toEqual({ ok: false, error: "Missing sender tab" });
    expect(dispatchNativeInput).not.toHaveBeenCalled();
  });

  it("dispatches native input through the provided dispatcher", async () => {
    const dispatchNativeInput = vi.fn().mockResolvedValue({ ok: true });
    const payload = { action: "type" as const, text: "hello" };

    const response = await handleNativeInputRequest({
      request: {
        type: "automation:native-input",
        payload,
      },
      tabId: 7,
      dispatchNativeInput,
    });

    expect(response).toEqual({ ok: true });
    expect(dispatchNativeInput).toHaveBeenCalledWith(7, payload);
  });

  it("lists artifacts without relying on a bridge request id", async () => {
    const listArtifactsFn = vi.fn().mockResolvedValue([
      {
        fileName: "notes.txt",
        mimeType: "text/plain",
        size: 5,
        updatedAt: "2026-03-07T10:00:00.000Z",
      },
    ]);

    const response = await handleArtifactsRequest({
      request: {
        type: "automation:artifacts",
        action: "listArtifacts",
      },
      tabId: 11,
      listArtifactsFn,
    });

    expect(response).toEqual({
      ok: true,
      result: [
        {
          fileName: "notes.txt",
          mimeType: "text/plain",
          size: 5,
          updatedAt: "2026-03-07T10:00:00.000Z",
        },
      ],
    });
    expect(listArtifactsFn).toHaveBeenCalledWith(11);
  });

  it("parses text artifacts before returning them", async () => {
    const getArtifactRecordFn = vi.fn().mockResolvedValue({
      fileName: "notes.json",
      mimeType: "application/json",
      size: 16,
      updatedAt: "2026-03-07T10:05:00.000Z",
      contentBase64: "eyJvayI6dHJ1ZX0=",
    });
    const parseArtifactFn = vi.fn().mockReturnValue({ ok: true });

    const response = await handleArtifactsRequest({
      request: {
        type: "automation:artifacts",
        action: "getArtifact",
        payload: { fileName: "notes.json" },
      },
      tabId: 5,
      getArtifactRecordFn,
      parseArtifactFn,
    });

    expect(parseArtifactFn).toHaveBeenCalledWith({
      fileName: "notes.json",
      mimeType: "application/json",
      size: 16,
      updatedAt: "2026-03-07T10:05:00.000Z",
      contentBase64: "eyJvayI6dHJ1ZX0=",
    });
    expect(response).toEqual({
      ok: true,
      result: { ok: true },
    });
  });
});
