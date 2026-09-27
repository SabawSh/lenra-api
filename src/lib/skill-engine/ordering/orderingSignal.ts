import type { PartProgress } from "@/lib/skill-engine/domain/types";
import { attemptsOf, wrongMovesOf } from "@/lib/skill-engine/domain/progressAccessors";
import { partialStruggleOrderingSignal } from "@/lib/skill-engine/mastery/partMastery";
import {
  masteryScoreOfProgress,
  resolvePartState,
} from "@/lib/skill-engine/state/resolvePartState";

export type OrderingSignalContext = Record<string, never>;

/** Canonical ordering signal — not used by sectionSkill / EMA. */
export function getOrderingSignal(
  progress: PartProgress | null | undefined,
  _context?: OrderingSignalContext,
): number | null {
  const state = resolvePartState(progress);

  if (state === "unknown") return null;

  if (state === "struggle") {
    return partialStruggleOrderingSignal(
      attemptsOf(progress),
      wrongMovesOf(progress),
    );
  }

  return masteryScoreOfProgress(progress);
}
