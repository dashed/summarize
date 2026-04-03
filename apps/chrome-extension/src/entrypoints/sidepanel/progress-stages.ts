// Pipeline stages for summarization progress

export type PipelineStage =
  | "connecting"
  | "fetching"
  | "extracting"
  | "processing"
  | "summarizing"
  | "complete"
  | "error";

export interface StageInfo {
  stage: PipelineStage;
  label: string;
  /** Estimated overall progress 0-100 */
  progress: number;
}

// Stage definitions with progress ranges
const STAGES: Record<PipelineStage, { label: string; min: number; max: number }> = {
  connecting: { label: "Connecting\u2026", min: 0, max: 5 },
  fetching: { label: "Fetching page\u2026", min: 5, max: 20 },
  extracting: { label: "Extracting slides\u2026", min: 20, max: 35 },
  processing: { label: "Processing content\u2026", min: 35, max: 55 },
  summarizing: { label: "Summarizing\u2026", min: 55, max: 90 },
  complete: { label: "Complete", min: 100, max: 100 },
  error: { label: "Error", min: 100, max: 100 },
};

const PERCENT_RE = /(\d{1,3})%/;

function matchStage(text: string): PipelineStage {
  const lower = text.toLowerCase();

  if (
    lower.startsWith("connecting") ||
    lower.startsWith("starting") ||
    lower.startsWith("scanning") ||
    lower.startsWith("refreshing")
  )
    return "connecting";

  if (lower.includes("fetch") || lower.includes("fetching")) return "fetching";

  if (
    lower.startsWith("extracting") ||
    lower.startsWith("slides:") ||
    lower.startsWith("downloading")
  )
    return "extracting";

  if (
    lower.startsWith("transcribing") ||
    lower.includes("transcript") ||
    lower.includes("caption") ||
    lower.includes("whisper") ||
    lower.startsWith("processing") ||
    lower.includes("ocr") ||
    lower.includes("gemini")
  )
    return "processing";

  if (lower.includes("summarizing") || lower.startsWith("sending")) return "summarizing";

  return "connecting";
}

/**
 * Calculate overall progress for a stage, optionally interpolating with a sub-progress value (0-1).
 */
export function estimateProgress(stage: PipelineStage, subProgress?: number): number {
  const s = STAGES[stage];
  if (subProgress != null && Number.isFinite(subProgress)) {
    const clamped = Math.max(0, Math.min(1, subProgress));
    return Math.round(s.min + (s.max - s.min) * clamped);
  }
  return Math.round((s.min + s.max) / 2);
}

/**
 * Ensure progress never goes backwards.
 */
export function clampProgress(prev: number, next: number): number {
  return Math.max(prev, next);
}

/**
 * Map a status text string (from SSE status events) to a pipeline stage and estimated progress.
 */
export function resolveStage(statusText: string): StageInfo {
  const trimmed = statusText.trim();
  if (!trimmed) {
    const s = STAGES.connecting;
    return { stage: "connecting", label: s.label, progress: s.min };
  }

  const stage = matchStage(trimmed);
  const info = STAGES[stage];

  const m = trimmed.match(PERCENT_RE);
  let progress: number;
  if (m) {
    const pct = Number.parseInt(m[1], 10);
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
      progress = estimateProgress(stage, pct / 100);
    } else {
      progress = estimateProgress(stage);
    }
  } else {
    progress = estimateProgress(stage);
  }

  return { stage, label: info.label, progress };
}
