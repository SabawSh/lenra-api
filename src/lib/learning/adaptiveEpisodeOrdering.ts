import type { AdaptiveSelectionConfig } from "@/lib/learning/adaptiveClipOrdering";
import { DEFAULT_ADAPTIVE_SELECTION_CONFIG } from "@/lib/learning/adaptiveClipOrdering";
import type { EnglishLevel, PartDifficulty, UserId } from "@/types/schema";

export type EpisodePartForAdaptiveOrder = {
  id: string;
  order: number;
  difficulty: PartDifficulty;
  difficultyScore: number | null;
};

export type AdaptiveOrderUser = {
  id: UserId;
  englishLevel?: EnglishLevel | null;
};

export type AdaptiveEpisodeOrderContext = {
  /** e.g. episode:… or video:… — curriculum scope for logs */
  curriculumId?: string;
  sectionId?: string;
  /** Expected part count — used to reject section-scoped pools */
  totalParts?: number;
};

/** Guard against passing a section-sized pool into global ordering. */
export function assertFullCurriculumPool(
  curriculumParts: readonly unknown[],
  totalParts: number,
  label: string,
): void {
  if (totalParts < 1 || curriculumParts.length < 1) return;

  if (curriculumParts.length < totalParts) {
    throw new Error(
      `[adaptive-order] ${label}: curriculum pool incomplete (${curriculumParts.length}/${totalParts} parts)`,
    );
  }
}

/**
 * Canonical movie story order (`parts.order`).
 * Difficulty adapts how the user practices a scene, not which scene they watch.
 */
function canonicalEpisodeOrder<T extends EpisodePartForAdaptiveOrder>(
  parts: T[],
): T[] {
  return [...parts].sort((a, b) => a.order - b.order);
}

function assertUniquePartIds<T extends EpisodePartForAdaptiveOrder>(
  parts: T[],
  label: string,
): boolean {
  const ids = parts.map((p) => p.id);
  const unique = new Set(ids).size;
  if (unique === ids.length) return true;
  console.error(`[adaptive-order] duplicate part ids (${label})`, {
    length: ids.length,
    uniqueCount: unique,
    ids,
  });
  return false;
}

/**
 * Learn playlist source = `parts.order` only.
 *
 * Difficulty adapts how the user practices a scene, not which scene they watch.
 * Difficulty-based reordering (windowedAdaptiveOrder / zone mix / rank keys) is
 * disabled on this path. Section slicing still happens afterward via
 * `sliceSectionFromGlobalOrder` (index window only).
 *
 * Smart Review uses a separate queue and must not affect canonical movie playback.
 *
 * `selectionConfig` is kept for call-site compatibility; it does not reorder clips.
 */
export async function getAdaptiveEpisodeOrder<
  T extends EpisodePartForAdaptiveOrder,
>({
  episodeParts,
  user: _user,
  context,
  selectionConfig: _selectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
}: {
  episodeParts: T[];
  user: AdaptiveOrderUser | null;
  context?: AdaptiveEpisodeOrderContext;
  selectionConfig?: AdaptiveSelectionConfig;
}): Promise<T[]> {
  if (context?.totalParts != null) {
    assertFullCurriculumPool(
      episodeParts,
      context.totalParts,
      "getAdaptiveEpisodeOrder",
    );
  }

  if (!assertUniquePartIds(episodeParts, "episode-input")) {
    return canonicalEpisodeOrder(episodeParts);
  }

  return canonicalEpisodeOrder(episodeParts);
}
