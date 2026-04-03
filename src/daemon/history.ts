import { hashString, normalizeContentForHash } from "../cache.js";
import { buildHistoryUrlMetadata } from "../shared/history.js";

export function buildChatHistoryContentFingerprint({
  cacheContent,
  pageContent,
}: {
  cacheContent?: string | null;
  pageContent?: string | null;
}): string | null {
  const source =
    typeof cacheContent === "string" && cacheContent.trim().length > 0
      ? cacheContent
      : typeof pageContent === "string" && pageContent.trim().length > 0
        ? pageContent
        : null;
  if (!source) return null;
  return hashString(normalizeContentForHash(source));
}

export function buildChatHistoryKey({
  url,
  automationEnabled,
  cacheContent,
  pageContent,
}: {
  url: string;
  automationEnabled: boolean;
  cacheContent?: string | null;
  pageContent?: string | null;
}): string {
  return hashString(
    JSON.stringify({
      url: buildHistoryUrlMetadata(url) ?? url,
      automationEnabled: !!automationEnabled,
      contentFingerprint: buildChatHistoryContentFingerprint({
        cacheContent,
        pageContent,
      }),
    }),
  );
}
