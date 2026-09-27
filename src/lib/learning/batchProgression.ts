import { isQualifiedComplete } from "@/lib/skill-engine/domain/progressAccessors";

export type ProgressSliceLike = {
  bestScore: number | null;
  completedAt: Date | null;
  attempts: number;
  wrongMoves: number;
};

/**
 * 1-based step of the first incomplete unit in canonical batch order.
 * Returns null when every unit in `partIds` is qualified-complete.
 */
export function firstIncompleteCanonicalStep(
  partIds: readonly string[],
  progressByPartId: ReadonlyMap<string, ProgressSliceLike>,
): number | null {
  for (let i = 0; i < partIds.length; i++) {
    const id = partIds[i]?.trim();
    if (!id) continue;
    const row = progressByPartId.get(id) ?? null;
    if (
      !isQualifiedComplete(
        row
          ? {
              bestScore: row.bestScore,
              completedAt: row.completedAt,
              attempts: row.attempts,
              wrongMoves: row.wrongMoves,
            }
          : null,
      )
    ) {
      return i + 1;
    }
  }
  return null;
}

export function firstIncompleteIndex<T extends { completed: boolean }>(
  items: readonly T[],
): number {
  return items.findIndex((item) => !item.completed);
}

/** Resume step for a batch row when only per-slot completion flags exist. */
export function firstIncompleteClipIndexFromCards(
  clips: ReadonlyArray<{ clipIndex: number; completed: boolean }>,
  fallback: number,
): number {
  const idx = firstIncompleteIndex(clips.map((c) => ({ completed: c.completed })));
  if (idx < 0) return fallback;
  return clips[idx]!.clipIndex;
}
