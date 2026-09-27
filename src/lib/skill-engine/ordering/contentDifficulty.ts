import type { AdaptivePartInput } from "@/lib/skill-engine/domain/types";
import type { AdaptiveSelectionConfig } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";
import {
  clampScore,
  DEFAULT_ADAPTIVE_SELECTION_CONFIG,
} from "@/lib/skill-engine/policy/adaptiveSelectionConfig";

/**
 * Resolve a part's difficulty on the 0–100 score scale.
 * The adaptive engine never reads `easy` / `medium` / `hard` labels.
 */
export function contentDifficulty(
  part: Pick<AdaptivePartInput, "difficultyScore">,
  config: AdaptiveSelectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
): number {
  if (part.difficultyScore != null && Number.isFinite(part.difficultyScore)) {
    return clampScore(part.difficultyScore);
  }
  return config.defaultDifficultyScore;
}
