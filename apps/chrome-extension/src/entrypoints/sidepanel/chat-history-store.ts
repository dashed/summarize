import { canonicalizeUrlForHistory } from "../../lib/history";

export function buildChatHistoryStorageKey(tabId: number, url: string): string {
  const canonicalUrl = canonicalizeUrlForHistory(url) || url;
  return `chat:tab:${tabId}:${encodeURIComponent(canonicalUrl)}`;
}
