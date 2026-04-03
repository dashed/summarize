/**
 * Resolves the status label shown in the sidepanel during chat extraction
 * based on whether the URL is a video/audio page and whether slides are requested.
 */
export function resolveChatExtractStatusLabel(preferUrl: boolean, wantsSlides: boolean): string {
  if (wantsSlides) return "Extracting video + thumbnails…";
  if (preferUrl) return "Extracting video transcript…";
  return "Extracting page content…";
}
