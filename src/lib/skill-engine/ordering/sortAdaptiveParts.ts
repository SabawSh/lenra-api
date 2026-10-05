import type { AdaptivePartInput } from "@/lib/skill-engine/domain/types";
import type { AdaptiveSelectionConfig } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";
import { DEFAULT_ADAPTIVE_SELECTION_CONFIG } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";

export { compareAdaptiveParts } from "@/lib/skill-engine/ordering/windowedAdaptiveOrder";

/**
 * Learn playlist order = `parts.order` only (movie story order).
 *
 * Difficulty adapts how the user practices a scene, not which scene they watch.
 * `userSkill` / `config` remain on the signature for call-site compatibility and for
 * practice adaptation (chunking, hints, challenge, analytics) elsewhere — they must
 * never reorder clips on the main Learn path.
 */
export function sortAdaptiveParts({
  parts,
  userSkill: _userSkill,
  overallSkill: _overallSkill,
  config: _config = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
}: {
  parts: AdaptivePartInput[];
  /** @deprecated Alias for `userSkill` — kept for transitional call sites. */
  overallSkill?: number;
  userSkill?: number;
  config?: AdaptiveSelectionConfig;
}): AdaptivePartInput[] {
  return [...parts].sort((a, b) => a.order - b.order);
}
