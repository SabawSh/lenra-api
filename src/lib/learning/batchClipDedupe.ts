/**
 * Deduplicate learning candidates by canonical part/clip id.
 * Reminder + new-content collisions must resolve to one item.
 */

export function dedupeByPartId<T extends { partId: string }>(
  items: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = item.partId?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

/** Same as dedupeByPartId but keeps review display state when ids collide. */
export function dedupeClipCardsByPartId<
  T extends { partId: string; state: "new" | "review" | "completed" },
>(items: readonly T[]): T[] {
  const order: string[] = [];
  const byId = new Map<string, T>();
  for (const item of items) {
    const id = item.partId?.trim();
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, item);
      order.push(id);
      continue;
    }
    const state =
      existing.state === "review" || item.state === "review"
        ? ("review" as const)
        : existing.state === "completed" || item.state === "completed"
          ? ("completed" as const)
          : ("new" as const);
    byId.set(id, { ...existing, ...item, state });
  }
  return order.map((id) => byId.get(id)!);
}

/**
 * Continue priority inside a batch:
 * 1. first incomplete non-review (new progress)
 * 2. first incomplete (any)
 * 3. first due-review item
 * Never prefer a completed non-review over unfinished work.
 */
export function resolveBatchContinueClipIndex(
  clips: ReadonlyArray<{
    clipIndex: number;
    completed: boolean;
    state: "new" | "review" | "completed";
  }>,
  fallback: number,
): number {
  if (clips.length === 0) return fallback;

  const firstFreshIncomplete = clips.find(
    (c) => !c.completed && c.state !== "review",
  )?.clipIndex;
  if (firstFreshIncomplete != null) return firstFreshIncomplete;

  const firstIncomplete = clips.find((c) => !c.completed)?.clipIndex;
  if (firstIncomplete != null) return firstIncomplete;

  const firstReview = clips.find((c) => c.state === "review")?.clipIndex;
  if (firstReview != null) return firstReview;

  return fallback;
}
