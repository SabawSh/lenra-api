/**
 * Temporal (tense/time) Grammar visual assets only.
 * Files live at public/grammar/<grammarId>.png.
 * Non-temporal concepts intentionally have no visual.
 */

/** Policy: only these grammar IDs may have visuals. */
export const TEMPORAL_GRAMMAR_VISUAL_IDS = [
  "present_simple",
  "present_continuous",
  "present_perfect",
  "present_perfect_continuous",
  "past_simple",
  "past_continuous",
  "past_perfect",
  "future_will",
  "future_going_to",
  "future_continuous",
  "future_perfect",
] as const;

export type TemporalGrammarVisualId =
  (typeof TEMPORAL_GRAMMAR_VISUAL_IDS)[number];

/**
 * IDs that currently have a shipped `.png` under public/grammar/.
 * Approved temporal IDs without a file yet must not invent paths.
 */
const GRAMMAR_VISUALS_ON_DISK: ReadonlySet<string> = new Set([
  "present_simple",
  "present_continuous",
  "present_perfect",
  "present_perfect_continuous",
  "past_simple",
  "past_continuous",
  "past_perfect",
  "future_will",
  "future_perfect",
]);

/**
 * Deterministic Grammar visual URL, or `null` when no approved asset exists
 * (non-temporal IDs, or approved temporal IDs without a file yet).
 */
export function grammarVisualUrl(grammarId: string): string | null {
  if (!GRAMMAR_VISUALS_ON_DISK.has(grammarId)) return null;
  return `/grammar/${grammarId}.png`;
}

/**
 * Props for the Grammar detail visual, or `null` when nothing should render
 * (no empty container / placeholder).
 */
export function grammarDetailVisual(args: {
  grammarId: string;
  title?: string | null;
}): { src: string; alt: string } | null {
  const src = grammarVisualUrl(args.grammarId);
  if (!src) return null;
  const alt = args.title?.trim() || args.grammarId.replaceAll("_", " ");
  return { src, alt };
}
