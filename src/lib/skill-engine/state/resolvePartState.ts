import type {
  MasteryResult,
  PartProgress,
  PartState,
} from "@/lib/skill-engine/domain/types";
import {
  attemptsOf,
  bestScoreOf,
  hasAttempts,
  hasWrongMoves,
  isQualifiedComplete,
  wrongMovesOf,
} from "@/lib/skill-engine/domain/progressAccessors";
import { computePartMasteryScore } from "@/lib/skill-engine/mastery/partMastery";
import { MASTERY_MASTERED_THRESHOLD } from "@/lib/skill-engine/policy/masteryThreshold";

function isUnknownProgress(
  progress: PartProgress | null | undefined,
): boolean {
  if (progress == null) return true;
  return (
    !hasAttempts(progress) &&
    !hasWrongMoves(progress) &&
    bestScoreOf(progress) <= 0 &&
    progress.completedAt == null
  );
}

function hasStruggleEvidence(
  progress: PartProgress | null | undefined,
): boolean {
  if (progress == null) return false;
  return hasAttempts(progress) || hasWrongMoves(progress);
}

function masteryScoreOf(progress: PartProgress | null | undefined): MasteryResult {
  if (!isQualifiedComplete(progress)) return null;
  return computePartMasteryScore({
    bestScore: bestScoreOf(progress),
    attempts: attemptsOf(progress),
    wrongMoves: wrongMovesOf(progress),
  });
}

export function resolvePartState(
  progress: PartProgress | null | undefined,
): PartState {
  if (isUnknownProgress(progress)) return "unknown";

  const mastery = masteryScoreOf(progress);
  if (isQualifiedComplete(progress) && mastery != null) {
    return mastery >= MASTERY_MASTERED_THRESHOLD ? "mastered" : "review";
  }

  if (hasStruggleEvidence(progress)) return "struggle";

  return "unknown";
}

/** Qualified completed parts only — skill / tier 3–4 mastery. */
export function masteryScoreOfProgress(
  progress: PartProgress | null | undefined,
): MasteryResult {
  return masteryScoreOf(progress);
}
