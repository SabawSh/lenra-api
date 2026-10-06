import { listProgressSliceForParts } from "@/lib/db/queries/userPartProgress";
import type { AdaptiveOrderUser } from "@/lib/learning/adaptiveEpisodeOrdering";
import { resolveSpeechDurationMs } from "@/lib/learning/partTiming";
import {
  buildLearningUnits,
  DEFAULT_LEARNING_UNIT_BUILDER_CONFIG,
  type AtomicPartInput,
  type LearningUnit,
  type LearningUnitBuilderConfig,
} from "@/lib/skill-engine/learning-units";
import {
  logReplayMergeMode,
  type LearningUnitSummary,
} from "@/lib/skill-engine/learning-units/mergeDebug";
import { contentDifficulty } from "@/lib/skill-engine/ordering/contentDifficulty";
import { isSectionVisuallyComplete } from "@/lib/learning/visibleUnitProgress";
import {
  buildGuestSkillResult,
  resolveOverallSkill,
} from "@/lib/skill/computeOverallSkill";
import { assertSkillResult } from "@/lib/skill/skillTypes";
import type { Part } from "@/types/video";

export type SectionPartForLearningUnits = Pick<
  Part,
  "id" | "order" | "difficultyScore" | "wordCount" | "speechDurationMs"
>;

function toAtomicPartInput(
  part: SectionPartForLearningUnits,
  progress: AtomicPartInput["progress"],
): AtomicPartInput {
  return {
    id: part.id,
    order: part.order,
    difficultyScore: part.difficultyScore,
    wordCount: part.wordCount,
    speechDurationMs: resolveSpeechDurationMs(part),
    progress,
    dueToday: false,
  };
}

async function resolveUserSkillForUnits(
  user: AdaptiveOrderUser | null,
): Promise<number> {
  const skill = user
    ? await resolveOverallSkill(user.id)
    : buildGuestSkillResult();
  assertSkillResult(skill);
  // Always Adaptive Teacher state (seeded once from onboarding if needed).
  return skill.skill;
}

/**
 * Runtime learner policy: each canonical clip/part is its own learning unit.
 * Bypass mergeAdjacentParts / skill ceilings without rewriting the merge algorithm.
 * Pass `forceAtomicUnits: false` to restore skill-based merging.
 */
export const LEARNER_FORCE_ATOMIC_UNITS = true;

/**
 * Runtime learning-unit builder for a section playlist.
 * Uses `difficultyScore` + user skill only — never enum difficulty labels.
 */
export type BuildSectionLearningUnitsOptions = {
  /**
   * Skip adjacent-clip merging. Defaults to {@link LEARNER_FORCE_ATOMIC_UNITS}.
   * Set `false` to restore skill / difficultyScore merge behavior.
   */
  forceAtomicUnits?: boolean;
  /** Section index for merge diagnostics (`NEXT_PUBLIC_MERGE_DEBUG=1`). */
  sectionIndex?: number;
  /** Stable section key for replay-merge diagnostics. */
  sectionId?: string;
  /** Reuse resolved skill across repeated builds in one catalog walk. */
  prefetchedUserSkill?: number;
  /** Reuse progress rows across repeated builds in one catalog walk.
   *  `null` means "queried, no row" — must be stored so we never re-fetch. */
  prefetchedProgressMap?: Map<string, AtomicPartInput["progress"]>;
  /**
   * Section-level replay decision from the playlist builder.
   * When set, overrides visible-unit completion for replay eligibility.
   */
  replayMergeEligible?: boolean;
  /** Lazy catalog walks — load progress for parts right before unit builds. */
  beforeUnitsBuild?: (partIds: readonly string[]) => Promise<void>;
  /** Sizing / probe builds — skip replay-merge console noise. */
  suppressMergeDebug?: boolean;
};

function summarizeLearningUnits(
  units: ReadonlyArray<{ parts: ReadonlyArray<{ order: number }> }>,
): LearningUnitSummary[] {
  return units.map((unit) => ({
    partOrders: unit.parts.map((p) => p.order),
    mergedPartCount: unit.parts.length,
  }));
}

export async function buildSectionLearningUnits<
  T extends SectionPartForLearningUnits,
>(
  sectionParts: readonly T[],
  user: AdaptiveOrderUser | null,
  config: LearningUnitBuilderConfig = DEFAULT_LEARNING_UNIT_BUILDER_CONFIG,
  options?: BuildSectionLearningUnitsOptions,
): Promise<LearningUnit<T>[]> {
  if (sectionParts.length === 0) return [];

  const forceAtomicUnits =
    options?.forceAtomicUnits ?? LEARNER_FORCE_ATOMIC_UNITS;

  if (forceAtomicUnits) {
    return sectionParts.map((part) => {
      const atomic = toAtomicPartInput(part, null);
      return {
        parts: [part],
        metrics: {
          difficulty: contentDifficulty(atomic, config),
          wordCount: part.wordCount,
          speechDurationMs: resolveSpeechDurationMs(part),
        },
        targetZone: "near" as const,
      };
    });
  }

  const progressMap =
    options?.prefetchedProgressMap ??
    new Map<string, AtomicPartInput["progress"]>();
  if (!options?.prefetchedProgressMap && user && sectionParts.length > 0) {
    const partIds = sectionParts.map((p) => p.id);
    const slices = await listProgressSliceForParts(user.id, partIds);
    for (const slice of slices) {
      progressMap.set(slice.partId, {
        bestScore: slice.bestScore,
        completedAt: slice.completedAt,
        attempts: slice.attempts,
        wrongMoves: slice.wrongMoves,
      });
    }
    for (const id of partIds) {
      if (!progressMap.has(id)) {
        progressMap.set(id, null);
      }
    }
  }

  const atomicInputs = sectionParts.map((part) =>
    toAtomicPartInput(part, progressMap.get(part.id) ?? null),
  );

  const userSkill =
    options?.prefetchedUserSkill ?? (await resolveUserSkillForUnits(user));

  const buildOpts = {
    debugContext: { sectionIndex: options?.sectionIndex },
  };

  const standardUnits = buildLearningUnits(
    atomicInputs,
    userSkill,
    config,
    buildOpts,
  );

  const standardSectionUnits = standardUnits.map((unit) => ({
    ...unit,
    parts: unit.parts.map((atomic) => {
      const part = sectionParts.find((p) => p.id === atomic.id)!;
      return {
        ...part,
        progress: progressMap.get(part.id) ?? null,
      };
    }),
  }));

  const visuallyComplete = isSectionVisuallyComplete(standardSectionUnits);
  const effectiveReplayEligibility =
    options?.replayMergeEligible ?? visuallyComplete;
  const replayMergeEnabled =
    effectiveReplayEligibility &&
    !forceAtomicUnits &&
    atomicInputs.length > 0;

  const learningUnitsBefore = replayMergeEnabled
    ? summarizeLearningUnits(standardUnits)
    : undefined;

  const units = replayMergeEnabled
    ? buildLearningUnits(atomicInputs, userSkill, config, {
        ...buildOpts,
        replayMerge: true,
      })
    : standardUnits;

  if (!options?.suppressMergeDebug) {
    logReplayMergeMode({
      sectionId: options?.sectionId,
      sectionIndex: options?.sectionIndex,
      replayMergeEnabled,
      learningUnitsBefore,
      learningUnitsAfter: replayMergeEnabled
        ? summarizeLearningUnits(units)
        : undefined,
    });
  }

  return units.map((unit) => ({
    ...unit,
    parts: unit.parts.map(
      (atomic) => sectionParts.find((p) => p.id === atomic.id)!,
    ),
  }));
}
