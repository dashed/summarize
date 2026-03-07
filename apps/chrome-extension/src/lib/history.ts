export {
  canonicalizeUrlForHistory,
  isSpecificEnoughForHistoryLookup,
} from "../../../../src/shared/history.js";

/**
 * Extract display-ready title and model from daemon history summary metadata.
 * Used when restoring summaries from history (both manual load and automatic fallback).
 */
export function parseSummaryHistoryMeta(metadata: Record<string, unknown> | null): {
  title: string;
  model: string | null;
} {
  const meta = metadata ?? {};
  return {
    title: String(meta.title || meta.url || "Summary"),
    model: typeof meta.model === "string" ? meta.model : null,
  };
}
