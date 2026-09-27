import { SECTION_DISPLAY_CAPACITY } from "@/lib/learning/sectionDisplayComposition";

/** Reviews replace incomplete batch slots only — never completed slots. */
export function resolveBatchIncompleteComposition(params: {
  batchCapacity?: number;
  completedCount: number;
  pendingReviewCount: number;
}): {
  incompleteSlots: number;
  reviewsForBatch: number;
  newForBatch: number;
} {
  const cap = params.batchCapacity ?? SECTION_DISPLAY_CAPACITY;
  const incompleteSlots = Math.max(
    0,
    cap - Math.max(0, params.completedCount),
  );
  const reviewsForBatch = Math.min(
    Math.max(0, params.pendingReviewCount),
    incompleteSlots,
  );
  const newForBatch = incompleteSlots - reviewsForBatch;
  return { incompleteSlots, reviewsForBatch, newForBatch };
}
