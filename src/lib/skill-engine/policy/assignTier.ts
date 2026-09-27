import type { AdaptivePartInput } from "@/lib/skill-engine/domain/types";
import { contentDifficulty } from "@/lib/skill-engine/ordering/contentDifficulty";
import { difficultyMatchDistance } from "@/lib/skill-engine/ordering/difficultyZones";
import { computeEffectiveDifficulty } from "@/lib/skill-engine/ordering/effectiveDifficulty";
import { getOrderingSignal } from "@/lib/skill-engine/ordering/orderingSignal";
import {
  isWithinPreferredRange,
  type AdaptiveSelectionConfig,
} from "@/lib/skill-engine/policy/adaptiveSelectionConfig";
import { DEFAULT_ADAPTIVE_SELECTION_CONFIG } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";
import { MASTERY_MASTERED_THRESHOLD } from "@/lib/skill-engine/policy/masteryThreshold";
import { isQualifiedComplete } from "@/lib/skill-engine/domain/progressAccessors";
import { masteryScoreOfProgress } from "@/lib/skill-engine/state/resolvePartState";

function effectiveScore(
  part: AdaptivePartInput,
  config: AdaptiveSelectionConfig,
): number {
  const base = contentDifficulty(part, config);
  return computeEffectiveDifficulty(base, getOrderingSignal(part.progress));
}

/**
 * Tier for diagnostics / logging (lower = surfaced earlier within a window).
 * Uses difficultyScore tolerance — not enum labels or practice modes.
 */
export function assignTier(
  part: AdaptivePartInput,
  userSkill: number,
  config: AdaptiveSelectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
): number {
  const mastery = masteryScoreOfProgress(part.progress);
  const qualified = isQualifiedComplete(part.progress);

  if (part.dueToday) return 0;

  const effective = effectiveScore(part, config);
  const inPreferred = isWithinPreferredRange(effective, userSkill, config);
  const matchDistance = difficultyMatchDistance(effective, userSkill, config);

  if (!qualified) {
    if (inPreferred) return 1;
    if (matchDistance <= config.toleranceHalfWidth * 2) return 2;
    return 3;
  }

  if (mastery != null && mastery >= MASTERY_MASTERED_THRESHOLD) {
    return 5;
  }

  return 4;
}
