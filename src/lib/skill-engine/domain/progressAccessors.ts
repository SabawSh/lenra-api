import { localDateKey } from "@/lib/db/localDateKey";
import type { PartProgress } from "@/lib/skill-engine/domain/types";

export function attemptsOf(progress: PartProgress | null | undefined): number {
  return Math.max(0, progress?.attempts ?? 0);
}

export function wrongMovesOf(progress: PartProgress | null | undefined): number {
  return Math.max(0, progress?.wrongMoves ?? 0);
}

export function bestScoreOf(progress: PartProgress | null | undefined): number {
  return Math.max(0, progress?.bestScore ?? 0);
}

export function hasAttempts(progress: PartProgress | null | undefined): boolean {
  return attemptsOf(progress) > 0;
}

export function hasWrongMoves(progress: PartProgress | null | undefined): boolean {
  return wrongMovesOf(progress) > 0;
}

/** Scored completion — same gate as section qualification / skill EMA. */
export function isQualifiedComplete(
  progress: PartProgress | null | undefined,
): boolean {
  return (
    progress != null &&
    progress.completedAt != null &&
    bestScoreOf(progress) > 0
  );
}

/** Whether qualified completion happened on the current local calendar day. */
export function isProgressCompletedToday(
  progress: PartProgress | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!isQualifiedComplete(progress) || !progress?.completedAt) return false;
  return localDateKey(progress.completedAt) === localDateKey(now);
}

