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
