import type { GrammarForPartsResult } from "@/lib/learning/grammarForParts";

export type GrammarLoadStatus = "idle" | "loading" | "ready" | "error";

/**
 * True when the unit response contains at least one real occurrence
 * (grouped concepts only exist when occurrences were found).
 */
export function unitHasGrammar(
  data: GrammarForPartsResult | null | undefined,
): boolean {
  if (!data) return false;
  return data.grammar.some((g) => g.occurrenceCount > 0);
}

/**
 * Trigger is shown only after the learner has responded to / solved the puzzle
 * for this unit, and a successful load confirms grammar for the active parts.
 * Hidden during watch/answer, and while unknown, loading, empty, or error.
 */
export function shouldShowGrammarTrigger(args: {
  status: GrammarLoadStatus;
  data?: GrammarForPartsResult | null;
  /** True after puzzle result is completed or timeout (not during watch/answer). */
  puzzleResolved: boolean;
}): boolean {
  if (!args.puzzleResolved) return false;
  if (args.status !== "ready") return false;
  return unitHasGrammar(args.data);
}

/**
 * Close the drawer when the current unit is confirmed to have no grammar
 * (or failed), or when the puzzle is no longer resolved (new unit / retry),
 * so learners never keep a panel for empty/stale lessons.
 */
export function shouldCloseGrammarDrawer(args: {
  drawerOpen: boolean;
  status: GrammarLoadStatus;
  data?: GrammarForPartsResult | null;
  puzzleResolved?: boolean;
}): boolean {
  if (!args.drawerOpen) return false;
  if (args.puzzleResolved === false) return true;
  if (args.status === "idle" || args.status === "loading") return false;
  if (args.status === "error") return true;
  return !unitHasGrammar(args.data);
}

/**
 * When opening the Grammar drawer: if the unit has exactly one concept,
 * jump straight to that concept's detail. Otherwise stay on the list.
 */
export function autoOpenGrammarDetailId(
  data: GrammarForPartsResult | null | undefined,
): string | null {
  if (!data) return null;
  const concepts = data.grammar.filter((g) => g.occurrenceCount > 0);
  if (concepts.length !== 1) return null;
  return concepts[0]!.id;
}

/**
 * While a new unit's grammar is loading, never render the previous unit's
 * concept list — return null so the UI shows loading / nothing stale.
 */
export function grammarDataForDisplay(args: {
  status: GrammarLoadStatus;
  data?: GrammarForPartsResult | null;
  partKey: string;
  dataPartKey: string | null;
}): GrammarForPartsResult | null {
  if (args.status !== "ready") return null;
  if (!args.data) return null;
  if (args.dataPartKey !== args.partKey) return null;
  return args.data;
}
