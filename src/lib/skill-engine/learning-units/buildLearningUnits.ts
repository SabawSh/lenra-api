import { isQualifiedComplete } from "@/lib/skill-engine/domain/progressAccessors";
import {
  createDistributionCounter,
  mostNeededZone,
  recordZone,
  zoneBounds,
} from "@/lib/skill-engine/ordering/difficultyZones";
import { findStoryAnchor } from "@/lib/skill-engine/ordering/windowedAdaptiveOrder";
import {
  computeUnitMetrics,
  mergeAdjacentParts,
} from "@/lib/skill-engine/learning-units/mergeAlgorithm";
import {
  DEFAULT_LEARNING_UNIT_BUILDER_CONFIG,
  resolveMemoryBudget,
} from "@/lib/skill-engine/learning-units/memoryBudget";
import type {
  AtomicPartInput,
  LearningUnit,
  LearningUnitBuilderConfig,
} from "@/lib/skill-engine/learning-units/types";
import {
  logMergeDebug,
  logPartState,
} from "@/lib/skill-engine/learning-units/mergeDebug";
import type { DifficultyZone } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";

function singlePartUnit<T extends AtomicPartInput>(
  part: T,
  targetZone: DifficultyZone,
  config: LearningUnitBuilderConfig,
): LearningUnit<T> {
  return {
    parts: [part],
    metrics: computeUnitMetrics([part], config),
    targetZone,
  };
}

export type BuildLearningUnitsOptions = {
  /** 1-based story order to start adaptive merging (defaults to first incomplete). */
  anchorOrder?: number;
  /**
   * Fully qualified section replay — merge by skill/budget across all parts.
   * Skips completed / pre-anchor atomic guards (frontier progression only).
   */
  replayMerge?: boolean;
  /** Optional context for merge diagnostics (`NEXT_PUBLIC_MERGE_DEBUG=1`). */
  debugContext?: { sectionIndex?: number };
};

/**
 * Build runtime learning units by merging adjacent atomic clips.
 * Story order is never changed; completed / pre-anchor clips stay single-part units.
 */
export function buildLearningUnits<T extends AtomicPartInput>(
  parts: readonly T[],
  userSkill: number,
  config: LearningUnitBuilderConfig = DEFAULT_LEARNING_UNIT_BUILDER_CONFIG,
  options?: BuildLearningUnitsOptions,
): LearningUnit<T>[] {
  if (parts.length === 0) return [];

  const canonical = [...parts].sort((a, b) => a.order - b.order);
  const replayMerge = options?.replayMerge === true;
  const anchor = replayMerge
    ? (canonical[0]?.order ?? 1)
    : (options?.anchorOrder ??
      findStoryAnchor(canonical as AtomicPartInput[]));
  const budget = resolveMemoryBudget(userSkill, config.memoryBudget);
  const distributionCounter = createDistributionCounter();
  const units: LearningUnit<T>[] = [];

  logMergeDebug({
    sectionIndex: options?.debugContext?.sectionIndex,
    userSkill,
    anchorOrder: anchor,
    completedPartIds: canonical
      .filter((part) => isQualifiedComplete(part.progress))
      .map((part) => part.id),
    partOrders: canonical.map((part) => part.order),
  });

  let index = 0;
  while (index < canonical.length) {
    const part = canonical[index]!;
    const beforeAnchor = !replayMerge && part.order < anchor;
    const completed = !replayMerge && isQualifiedComplete(part.progress);

    if (beforeAnchor || completed) {
      logPartState({
        order: part.order,
        difficulty: part.difficultyScore,
        speechDurationMs: part.speechDurationMs,
        completed,
        beforeAnchor,
        atomicReason: completed
          ? "completed"
          : beforeAnchor
            ? "beforeAnchor"
            : undefined,
      });
      const zone = mostNeededZone(distributionCounter, config);
      units.push(singlePartUnit(part, zone, config));
      recordZone(distributionCounter, zone);
      index++;
      continue;
    }

    const targetZone = mostNeededZone(distributionCounter, config);
    const { max: targetDifficultyCeiling } = zoneBounds(
      targetZone,
      userSkill,
      config,
    );

    const { merged, nextIndex } = mergeAdjacentParts(
      canonical,
      index,
      targetDifficultyCeiling,
      budget,
      config,
    );

    units.push({
      parts: merged as T[],
      metrics: computeUnitMetrics(merged, config),
      targetZone,
    });
    recordZone(distributionCounter, targetZone);
    index = nextIndex;
  }

  return units;
}

/** Flatten units back to atomic parts in story order (virtual merge only). */
export function flattenLearningUnits<T extends AtomicPartInput>(
  units: readonly LearningUnit<T>[],
): T[] {
  return units.flatMap((unit) => unit.parts);
}

/** Map a 1-based session step to the learning unit at that position. */
export function learningUnitAtStep<T extends AtomicPartInput>(
  units: readonly LearningUnit<T>[],
  step: number,
): LearningUnit<T> | null {
  if (step < 1 || step > units.length) return null;
  return units[step - 1] ?? null;
}

/** Find the 1-based session step containing a canonical story `order`. */
export function sessionStepForStoryOrder(
  units: ReadonlyArray<{ parts: ReadonlyArray<{ order: number }> }>,
  storyOrder: number,
): number {
  const idx = units.findIndex((unit) =>
    unit.parts.some((part: { order: number }) => part.order === storyOrder),
  );
  return idx >= 0 ? idx + 1 : 1;
}
