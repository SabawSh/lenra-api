import type {
  AdaptiveEpisodeOrderContext,
  AdaptiveOrderUser,
  EpisodePartForAdaptiveOrder,
} from "@/lib/learning/adaptiveEpisodeOrdering";
import { sliceSectionFromGlobalOrder } from "@/lib/learning/sections";

export type SectionPartForAdaptiveOrder = EpisodePartForAdaptiveOrder;

export type AdaptiveSectionOrderContext = AdaptiveEpisodeOrderContext & {
  sectionIndex: number;
  totalParts: number;
};

export type { AdaptiveOrderUser };

/** 1-based rank in the precomputed global curriculum order. */
function buildGlobalRankMap(
  globallyOrderedParts: readonly { id: string }[],
): Map<string, number> {
  return new Map(globallyOrderedParts.map((p, i) => [p.id, i + 1]));
}

function partSliceLogFields<T extends SectionPartForAdaptiveOrder>(
  parts: T[],
  globalRanks: Map<string, number>,
) {
  return parts.map((p, sessionStep) => ({
    sessionStep: sessionStep + 1,
    globalRank: globalRanks.get(p.id) ?? null,
    id: p.id,
    order: p.order,
    difficulty: p.difficulty,
    difficultyScore: p.difficultyScore,
  }));
}

/**
 * Builds the section session playlist from **precomputed global order** (index slice only).
 *
 * Sorting happens only in `getAdaptiveEpisodeOrder` on the full curriculum pool.
 * This function never calls `sortAdaptiveParts` / `compareAdaptiveParts`.
 */
export function applyAdaptiveSectionPartOrder<
  T extends SectionPartForAdaptiveOrder,
>(
  globallyOrderedParts: readonly T[],
  user: AdaptiveOrderUser | null,
  context: AdaptiveSectionOrderContext,
): T[] {
  const globalRanks = buildGlobalRankMap(globallyOrderedParts);

  const sectionParts = sliceSectionFromGlobalOrder(
    globallyOrderedParts,
    context.sectionIndex,
  );

  return sectionParts;
}
