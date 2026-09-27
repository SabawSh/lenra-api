import { contentDifficulty } from "@/lib/skill-engine/ordering/contentDifficulty";
import type {
  AtomicPartInput,
  LearningUnitMetrics,
  MemoryBudget,
} from "@/lib/skill-engine/learning-units/types";
import { logMergeAttempt } from "@/lib/skill-engine/learning-units/mergeDebug";
import type { LearningUnitBuilderConfig } from "@/lib/skill-engine/learning-units/types";

export function computeUnitMetrics(
  parts: readonly AtomicPartInput[],
  config: LearningUnitBuilderConfig,
): LearningUnitMetrics {
  return {
    difficulty: parts.reduce(
      (sum, part) => sum + contentDifficulty(part, config),
      0,
    ),
    wordCount: parts.reduce((sum, part) => sum + Math.max(0, part.wordCount), 0),
    speechDurationMs: parts.reduce(
      (sum, part) => sum + Math.max(0, part.speechDurationMs),
      0,
    ),
  };
}

function projectedMetrics(
  current: LearningUnitMetrics,
  next: AtomicPartInput,
  config: LearningUnitBuilderConfig,
): LearningUnitMetrics {
  const partDiff = contentDifficulty(next, config);
  return {
    difficulty: current.difficulty + partDiff,
    wordCount: current.wordCount + Math.max(0, next.wordCount),
    speechDurationMs:
      current.speechDurationMs + Math.max(0, next.speechDurationMs),
  };
}

/**
 * True when adding `next` would stay strictly inside merge ceilings.
 * At least one part is always kept — callers only invoke this for optional merges.
 */
export function canMergePart(
  current: LearningUnitMetrics,
  next: AtomicPartInput,
  targetDifficultyCeiling: number,
  budget: MemoryBudget,
  currentPartCount: number,
  config: LearningUnitBuilderConfig,
): boolean {
  if (currentPartCount >= config.maxMergeUnitCount) return false;

  const projected = projectedMetrics(current, next, config);
  if (projected.difficulty >= targetDifficultyCeiling) return false;
  if (projected.wordCount >= budget.maxWords) return false;
  if (projected.speechDurationMs >= budget.maxDurationMs) return false;
  return true;
}

function mergeRejectionReason(
  current: LearningUnitMetrics,
  next: AtomicPartInput,
  targetDifficultyCeiling: number,
  budget: MemoryBudget,
  currentPartCount: number,
  config: LearningUnitBuilderConfig,
): string | undefined {
  if (currentPartCount >= config.maxMergeUnitCount) {
    return "maxMergeUnitCount";
  }

  const projected = projectedMetrics(current, next, config);
  if (projected.difficulty >= targetDifficultyCeiling) {
    return "difficultyCeiling";
  }
  if (projected.wordCount >= budget.maxWords) {
    return "maxWords";
  }
  if (projected.speechDurationMs >= budget.maxDurationMs) {
    return "maxDurationMs";
  }
  return undefined;
}

/**
 * Greedily merge adjacent parts starting at `startIndex`.
 * Story order is preserved; no skipping or reordering.
 */
export function mergeAdjacentParts(
  parts: readonly AtomicPartInput[],
  startIndex: number,
  targetDifficultyCeiling: number,
  budget: MemoryBudget,
  config: LearningUnitBuilderConfig,
): { merged: AtomicPartInput[]; nextIndex: number } {
  if (startIndex < 0 || startIndex >= parts.length) {
    return { merged: [], nextIndex: startIndex };
  }

  const merged: AtomicPartInput[] = [parts[startIndex]!];
  let metrics = computeUnitMetrics(merged, config);
  let index = startIndex + 1;

  while (index < parts.length) {
    const candidate = parts[index]!;
    const projected = projectedMetrics(metrics, candidate, config);
    const rejectionReason = mergeRejectionReason(
      metrics,
      candidate,
      targetDifficultyCeiling,
      budget,
      merged.length,
      config,
    );

    logMergeAttempt({
      currentOrder: merged[merged.length - 1]!.order,
      nextOrder: candidate.order,
      projectedDifficulty: projected.difficulty,
      projectedWords: projected.wordCount,
      projectedSpeechDuration: projected.speechDurationMs,
      targetDifficultyCeiling,
      decision: rejectionReason ? "reject" : "merge",
      rejectionReason,
    });

    if (rejectionReason) {
      break;
    }
    merged.push(candidate);
    metrics = computeUnitMetrics(merged, config);
    index++;
  }

  return { merged, nextIndex: index };
}
