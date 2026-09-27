import { listProgressSliceForParts } from "@/lib/db/queries/userPartProgress";
import {
  adaptiveOrderingDecisionInputs,
  DEFAULT_ADAPTIVE_SELECTION_CONFIG,
  sortAdaptiveParts,
  type AdaptivePartInput,
  type AdaptiveSelectionConfig,
  type PartProgress,
} from "@/lib/learning/adaptiveClipOrdering";
import {
  buildGuestSkillResult,
  resolveSkillForAdaptiveOrdering,
} from "@/lib/skill/computeOverallSkill";
import { getBootstrapSkillFromEnglishLevel } from "@/lib/skill/onboardingSkill";
import { assertSkillResult, type SkillResult } from "@/lib/skill/skillTypes";
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

/** Emergency fallback when mapping integrity fails or sort throws. */
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

function resolveOrderingSkill(
  skill: SkillResult,
  englishLevel: EnglishLevel | null | undefined,
): { overallSkill: number; bootstrap: boolean } {
  if (skill.stage === "new_user") {
    return {
      overallSkill: getBootstrapSkillFromEnglishLevel(englishLevel),
      bootstrap: true,
    };
  }

  return { overallSkill: skill.skill, bootstrap: false };
}

async function runGlobalAdaptiveSort<T extends EpisodePartForAdaptiveOrder>(
  episodeParts: T[],
  user: AdaptiveOrderUser | null,
  userSkill: number,
  selectionConfig: AdaptiveSelectionConfig,
  skill: SkillResult,
  context?: AdaptiveEpisodeOrderContext,
): Promise<T[]> {
  const progressMap = new Map<string, PartProgress>();
  if (user && episodeParts.length > 0) {
    const slices = await listProgressSliceForParts(
      user.id,
      episodeParts.map((p) => p.id),
    );
    for (const slice of slices) {
      progressMap.set(slice.partId, {
        bestScore: slice.bestScore,
        completedAt: slice.completedAt,
        attempts: slice.attempts,
        wrongMoves: slice.wrongMoves,
      });
    }
  }

  const adaptiveInputs: AdaptivePartInput[] = episodeParts.map((part) => ({
    id: part.id,
    order: part.order,
    difficultyScore: part.difficultyScore,
    progress: progressMap.get(part.id) ?? null,
    dueToday: false,
  }));

  const orderedInputs = sortAdaptiveParts({
    parts: adaptiveInputs,
    userSkill,
    config: selectionConfig,
  });

  const partById = new Map(episodeParts.map((p) => [p.id, p]));
  const orderedParts = orderedInputs.map((input) => partById.get(input.id)!);

  const outputIds = orderedParts.map((p) => p.id);
  const outputUnique = new Set(outputIds).size === outputIds.length;

  if (
    !outputUnique ||
    orderedParts.length !== episodeParts.length ||
    orderedInputs.length !== episodeParts.length
  ) {
    console.error(
      "[adaptive-order] global sort did not preserve unique 1:1 mapping; using canonical order",
      {
        inputLength: episodeParts.length,
        outputLength: orderedParts.length,
        sortedLength: orderedInputs.length,
        skillSource: skill.source,
        stage: skill.stage,
      },
    );
    return canonicalEpisodeOrder(episodeParts);
  }

  console.assert(
    new Set(orderedParts.map((p) => p.id)).size === orderedParts.length,
    "Duplicate parts in global adaptive order",
  );

  return orderedParts;
}

/**
 * Applies adaptive ordering across the full episode curriculum pool.
 * Section slicing must happen afterward via `sliceSectionFromGlobalOrder` (index window only).
 */
export async function getAdaptiveEpisodeOrder<
  T extends EpisodePartForAdaptiveOrder,
>({
  episodeParts,
  user,
  context,
  selectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
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

  const { dashTime } = await import("@/lib/debug/dashboardTiming");
  const skill: SkillResult = user
    ? await dashTime("resolveSkillForAdaptiveOrdering", () =>
        resolveSkillForAdaptiveOrdering(user.id),
      )
    : buildGuestSkillResult();
  assertSkillResult(skill);

  if (skill.mode === "canonical") {
    return canonicalEpisodeOrder(episodeParts);
  }

  const englishLevel = user?.englishLevel ?? null;
  const { overallSkill: userSkill } = resolveOrderingSkill(
    skill,
    englishLevel,
  );

  try {
    return await dashTime("runGlobalAdaptiveSort", () =>
      runGlobalAdaptiveSort(
        episodeParts,
        user,
        userSkill,
        selectionConfig,
        skill,
        context,
      ),
    );
  } catch (err) {
    console.warn("[adaptive-order] global sort failed, using canonical order", {
      err,
      skillSource: skill.source,
      stage: skill.stage,
      lockState: skill.lockState,
    });
    return canonicalEpisodeOrder(episodeParts);
  }
}
