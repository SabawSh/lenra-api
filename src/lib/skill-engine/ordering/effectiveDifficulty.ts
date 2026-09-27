import { clampScore } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";

export function computeEffectiveDifficulty(
  contentDifficulty: number,
  orderingSignal: number | null,
): number {
  const scoreOffset =
    orderingSignal == null ? 0 : (50 - orderingSignal) * 0.4;
  return clampScore(contentDifficulty + scoreOffset);
}
