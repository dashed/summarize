export function buildIdleSubtitle({
  inputSummary,
  modelLabel,
  model,
}: {
  inputSummary?: string | null;
  modelLabel?: string | null;
  model?: string | null;
}): string {
  const input = typeof inputSummary === "string" ? inputSummary.trim() : "";
  void modelLabel;
  void model;
  return input;
}

/**
 * Format a model identifier for compact display in the header badge.
 * Strips provider prefixes (e.g. "google/gemini-3-flash" → "gemini-3-flash")
 * and capitalizes built-in presets.
 */
export function formatModelBadge(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "auto") return "Auto";
  if (trimmed === "free") return "Free";
  // Strip provider prefix (e.g. "google/gemini-3-flash-preview" → "gemini-3-flash-preview")
  const slashIndex = trimmed.indexOf("/");
  return slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
}
