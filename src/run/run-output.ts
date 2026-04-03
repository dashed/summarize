import type { LengthArg } from "../flags.js";
import { SUMMARY_LENGTH_MAX_CHARACTERS, SUMMARY_LENGTH_TO_TOKENS } from "../prompts/index.js";
import { resolveTargetCharacters } from "./format.js";

export function resolveDesiredOutputTokens({
  lengthArg,
  maxOutputTokensArg,
}: {
  lengthArg: LengthArg;
  maxOutputTokensArg: number | null;
}): number | null {
  if (typeof maxOutputTokensArg === "number") return maxOutputTokensArg;
  // For named presets, use the curated token budget from SUMMARY_LENGTH_SPECS
  // instead of the chars/4 heuristic which severely undercounts (e.g. xxl: 5,500 vs 12,288).
  if (lengthArg.kind === "preset") {
    return SUMMARY_LENGTH_TO_TOKENS[lengthArg.preset];
  }
  // Custom character targets: fall back to heuristic.
  const targetChars = resolveTargetCharacters(lengthArg, SUMMARY_LENGTH_MAX_CHARACTERS);
  if (
    !Number.isFinite(targetChars) ||
    targetChars <= 0 ||
    targetChars === Number.POSITIVE_INFINITY
  ) {
    return null;
  }
  return Math.max(16, Math.ceil(targetChars / 4));
}
