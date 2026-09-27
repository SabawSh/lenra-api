import type { AdaptivePartInput } from "@/lib/skill-engine/domain/types";
import { windowedAdaptiveOrder } from "@/lib/skill-engine/ordering/windowedAdaptiveOrder";
import type { AdaptiveSelectionConfig } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";
import { DEFAULT_ADAPTIVE_SELECTION_CONFIG } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";

export { compareAdaptiveParts } from "@/lib/skill-engine/ordering/windowedAdaptiveOrder";

/**
 * Build a continuity-preserving adaptive episode order.
 * Story position is preserved across windows; difficultyScore drives local reordering.
 */
export function sortAdaptiveParts({
  parts,
  userSkill,
  overallSkill,
  config = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
}: {
  parts: AdaptivePartInput[];
  /** @deprecated Alias for `userSkill` — kept for transitional call sites. */
  overallSkill?: number;
  userSkill?: number;
  config?: AdaptiveSelectionConfig;
}): AdaptivePartInput[] {
  const skill =
    userSkill ?? overallSkill ?? config.defaultDifficultyScore;
  return windowedAdaptiveOrder(parts, skill, config);
}
