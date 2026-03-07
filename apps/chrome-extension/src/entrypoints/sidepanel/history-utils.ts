/**
 * Pure utility functions for the history panel.
 * Extracted from main.ts for testability.
 */

/**
 * Determines the "current key" to highlight in the history list.
 *
 * - In "summaries" mode, returns the key of the history entry that was
 *   explicitly loaded (loadedHistoryKey) or null.
 * - In "chats" mode, returns the key of the loaded chat history entry or null.
 */
export function resolveCurrentKey(
  historyMode: "summaries" | "chats",
  loadedHistoryKey: string | null,
  loadedChatKey?: string | null,
): string | null {
  return historyMode === "summaries" ? (loadedHistoryKey ?? null) : (loadedChatKey ?? null);
}

/**
 * Determines whether the first entry in the history list should be
 * marked as "current" (i.e. the live/most recent item).
 *
 * - In "summaries" mode: mark first as current when a summary is
 *   displayed AND no explicit history entry was loaded (meaning the
 *   displayed summary is the live one, not from history).
 * - In "chats" mode: mark first as current when a chat session is active
 *   AND no explicit chat history entry was loaded.
 */
export function shouldMarkFirstAsCurrent(
  historyMode: "summaries" | "chats",
  hasSummaryDisplayed: boolean,
  loadedHistoryKey: string | null,
  hasChatActive: boolean,
  loadedChatKey?: string | null,
): boolean {
  return historyMode === "summaries"
    ? hasSummaryDisplayed && !loadedHistoryKey
    : hasChatActive && !loadedChatKey;
}

/**
 * Determines whether a specific history entry is the "current" one.
 */
export function isCurrentEntry(
  entryKey: string,
  index: number,
  currentKey: string | null,
  markFirstAsCurrent: boolean,
): boolean {
  return entryKey === currentKey || (markFirstAsCurrent && index === 0);
}

/**
 * Determines whether the history panel should be refreshed after a
 * navigation event (tab switch or same-tab URL change).
 *
 * Returns true when the history panel is currently visible AND either
 * the active tab changed or the URL within the same tab changed.
 */
export function shouldRefreshHistoryOnNavigation(
  tabChanged: boolean,
  urlChanged: boolean,
  historyOpen: boolean,
): boolean {
  return (tabChanged || urlChanged) && historyOpen;
}

/**
 * Formats the size/count label for a history entry.
 *
 * - In "summaries" mode: shows character count (e.g. "1.2k chars")
 * - In "chats" mode: shows message count from metadata (e.g. "3 messages")
 */
export function formatHistoryEntrySize(
  mode: "summaries" | "chats",
  meta: Record<string, unknown>,
  sizeBytes: number,
): string {
  if (mode === "chats") {
    const count = typeof meta.messageCount === "number" ? meta.messageCount : 0;
    if (!count) return "";
    return count === 1 ? "1 message" : `${count} messages`;
  }
  const chars = (meta.summaryChars as number) || sizeBytes;
  if (!chars) return "";
  if (chars >= 1000) return `${(chars / 1000).toFixed(1)}k chars`;
  return `${chars} chars`;
}

/**
 * Returns the content type label for a URL.
 * Used to customize the chat input placeholder.
 */
export function detectContentTypeLabel(url: string | null | undefined): string {
  if (!url) return "page";
  try {
    const u = new URL(url);
    if (u.hostname === "www.youtube.com" || u.hostname === "youtube.com" || u.hostname === "youtu.be")
      return "video";
    if (u.pathname.endsWith(".pdf")) return "PDF";
  } catch {
    // ignore invalid URLs
  }
  return "page";
}

/**
 * Generates a short preview snippet from text content.
 * Strips markdown formatting and truncates to the specified length.
 */
export function generatePreview(text: string, maxLength = 120): string {
  const stripped = text
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1") // italic
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/^\s*[-*+]\s+/gm, "") // list markers
    .replace(/^\s*\d+\.\s+/gm, "") // numbered list markers
    .replace(/\n+/g, " ") // collapse newlines
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
  if (stripped.length <= maxLength) return stripped;
  return stripped.slice(0, maxLength).trimEnd() + "\u2026";
}

/**
 * Extracts the domain from a URL for display purposes.
 */
export function extractDomain(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
