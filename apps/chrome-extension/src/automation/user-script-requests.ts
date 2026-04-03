import {
  deleteArtifact,
  getArtifactRecord,
  listArtifacts,
  parseArtifact,
  upsertArtifact,
} from "./artifacts-store";

export type NativeInputPayload = {
  action: "click" | "type" | "press" | "keydown" | "keyup";
  x?: number;
  y?: number;
  text?: string;
  key?: string;
};

export type NativeInputRequest = {
  type: "automation:native-input";
  payload: NativeInputPayload;
};

export type NativeInputResponse = { ok: true } | { ok: false; error: string };

export type ArtifactsRequest = {
  type: "automation:artifacts";
  action?: string;
  payload?: unknown;
};

export type ArtifactsResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export function isNativeInputRequest(raw: unknown): raw is NativeInputRequest {
  return (
    Boolean(raw) &&
    typeof raw === "object" &&
    (raw as { type?: unknown }).type === "automation:native-input" &&
    typeof (raw as { payload?: unknown }).payload === "object"
  );
}

export function isArtifactsRequest(raw: unknown): raw is ArtifactsRequest {
  return (
    Boolean(raw) &&
    typeof raw === "object" &&
    (raw as { type?: unknown }).type === "automation:artifacts"
  );
}

export async function handleNativeInputRequest({
  request,
  tabId,
  dispatchNativeInput,
}: {
  request: NativeInputRequest;
  tabId: number | null | undefined;
  dispatchNativeInput: (tabId: number, payload: NativeInputPayload) => Promise<NativeInputResponse>;
}): Promise<NativeInputResponse> {
  if (!tabId) {
    return {
      ok: false,
      error: "Missing sender tab",
    };
  }
  return await dispatchNativeInput(tabId, request.payload);
}

export async function handleArtifactsRequest({
  request,
  tabId,
  listArtifactsFn = listArtifacts,
  getArtifactRecordFn = getArtifactRecord,
  parseArtifactFn = parseArtifact,
  upsertArtifactFn = upsertArtifact,
  deleteArtifactFn = deleteArtifact,
}: {
  request: ArtifactsRequest;
  tabId: number | null | undefined;
  listArtifactsFn?: typeof listArtifacts;
  getArtifactRecordFn?: typeof getArtifactRecord;
  parseArtifactFn?: typeof parseArtifact;
  upsertArtifactFn?: typeof upsertArtifact;
  deleteArtifactFn?: typeof deleteArtifact;
}): Promise<ArtifactsResponse> {
  if (!tabId) {
    return {
      ok: false,
      error: "Missing sender tab",
    };
  }

  const payload = (request.payload ?? {}) as {
    fileName?: string;
    content?: unknown;
    mimeType?: string;
    asBase64?: boolean;
  };

  try {
    if (request.action === "listArtifacts") {
      const records = await listArtifactsFn(tabId);
      return {
        ok: true,
        result: records.map(({ fileName, mimeType, size, updatedAt }) => ({
          fileName,
          mimeType,
          size,
          updatedAt,
        })),
      };
    }

    if (request.action === "getArtifact") {
      if (!payload.fileName) throw new Error("Missing fileName");
      const record = await getArtifactRecordFn(tabId, payload.fileName);
      if (!record) throw new Error(`Artifact not found: ${payload.fileName}`);
      const isText =
        record.mimeType.startsWith("text/") ||
        record.mimeType === "application/json" ||
        record.fileName.endsWith(".json");
      const value = payload.asBase64 ? record : isText ? parseArtifactFn(record) : record;
      return { ok: true, result: value };
    }

    if (request.action === "createOrUpdateArtifact") {
      if (!payload.fileName) throw new Error("Missing fileName");
      const record = await upsertArtifactFn(tabId, {
        fileName: payload.fileName,
        content: payload.content,
        mimeType: payload.mimeType,
        contentBase64:
          typeof payload.content === "object" &&
          payload.content &&
          "contentBase64" in payload.content
            ? (payload.content as { contentBase64?: string }).contentBase64
            : undefined,
      });
      return {
        ok: true,
        result: {
          fileName: record.fileName,
          mimeType: record.mimeType,
          size: record.size,
          updatedAt: record.updatedAt,
        },
      };
    }

    if (request.action === "deleteArtifact") {
      if (!payload.fileName) throw new Error("Missing fileName");
      const deleted = await deleteArtifactFn(tabId, payload.fileName);
      return { ok: true, result: { ok: deleted } };
    }

    throw new Error(`Unknown artifact action: ${request.action ?? "unknown"}`);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
