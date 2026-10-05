import type { AdaptivePartInput } from "@/lib/skill-engine/domain/types";
import {
  classifyDifficultyZone,
  createDistributionCounter,
  difficultyMatchDistance,
  recordZone,
  type DifficultyZone,
} from "@/lib/skill-engine/ordering/difficultyZones";
import { contentDifficulty } from "@/lib/skill-engine/ordering/contentDifficulty";
import { computeEffectiveDifficulty } from "@/lib/skill-engine/ordering/effectiveDifficulty";
import { getOrderingSignal } from "@/lib/skill-engine/ordering/orderingSignal";
import type { AdaptiveSelectionConfig } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";
import { DEFAULT_ADAPTIVE_SELECTION_CONFIG } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";
import { isQualifiedComplete } from "@/lib/skill-engine/domain/progressAccessors";
import { resolvePartState } from "@/lib/skill-engine/state/resolvePartState";

function effectiveScore(
  part: AdaptivePartInput,
  config: AdaptiveSelectionConfig,
): number {
  const base = contentDifficulty(part, config);
  return computeEffectiveDifficulty(base, getOrderingSignal(part.progress));
}

/** Review / reminder nudge — lowest priority, never overrides continuity. */
function reviewReminderBonus(part: AdaptivePartInput): number {
  let bonus = 0;
  if (part.dueToday) bonus += 1.5;
  const state = resolvePartState(part.progress);
  if (state === "struggle") bonus += 0.75;
  if (state === "review") bonus += 0.35;
  return bonus;
}

function zoneAdjust(
  zone: DifficultyZone | "outside",
  neededZone: DifficultyZone,
): number {
  if (zone === neededZone) return -12;
  if (zone === "near") return -4;
  if (zone === "easier") return 0;
  if (zone === "stretch") return 2;
  return 8;
}

/** First incomplete story unit — adaptive mixing applies from here forward. */
export function findStoryAnchor(parts: AdaptivePartInput[]): number {
  const incomplete = parts.filter((p) => !isQualifiedComplete(p.progress));
  if (incomplete.length === 0) {
    return parts.reduce((max, p) => Math.max(max, p.order), 1);
  }
  return Math.min(...incomplete.map((p) => p.order));
}

/**
 * Composite rank: story order dominates; difficulty / distribution / review
 * can only nudge a unit by ~1 adjacent slot (continuityPenaltyPerStep × order).
 */
function adaptiveRankKey(
  part: AdaptivePartInput,
  userSkill: number,
  neededZone: DifficultyZone,
  config: AdaptiveSelectionConfig,
): number {
  const effective = effectiveScore(part, config);
  const zone = classifyDifficultyZone(effective, userSkill, config);
  const match = difficultyMatchDistance(effective, userSkill, config);
  const continuity = part.order * config.continuityPenaltyPerStep;
  const difficultyNudge =
    match * 0.35 + zoneAdjust(zone, neededZone) - reviewReminderBonus(part);
  return continuity + difficultyNudge;
}

function orderSegment(
  segment: AdaptivePartInput[],
  userSkill: number,
  config: AdaptiveSelectionConfig,
  distributionCounter: ReturnType<typeof createDistributionCounter>,
): AdaptivePartInput[] {
  if (segment.length <= 1) return [...segment];

  const neededZone = pickNeededZone(distributionCounter, config);
  const ranked = [...segment].sort(
    (a, b) =>
      adaptiveRankKey(a, userSkill, neededZone, config) -
      adaptiveRankKey(b, userSkill, neededZone, config),
  );

  for (const part of ranked) {
    const zone = classifyDifficultyZone(
      effectiveScore(part, config),
      userSkill,
      config,
    );
    recordZone(
      distributionCounter,
      zone === "outside" ? "near" : zone,
    );
  }

  return ranked;
}

function pickNeededZone(
  counter: ReturnType<typeof createDistributionCounter>,
  config: AdaptiveSelectionConfig,
): DifficultyZone {
  const targets = config.distributionTargets;
  let best: DifficultyZone = "near";
  let bestDeficit = -Infinity;

  for (const zone of ["near", "easier", "stretch"] as const) {
    const expected =
      counter.total > 0 ? targets[zone] * (counter.total + 1) : targets[zone];
    const deficit = expected - counter.counts[zone];
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = zone;
    }
  }
  return best;
}

/**
 * Legacy difficulty-window reorderer.
 *
 * **Not used for the main Learn playlist.** Learn order is `parts.order` only
 * via `sortAdaptiveParts` / `getAdaptiveEpisodeOrder`.
 * Difficulty adapts how the user practices a scene, not which scene they watch.
 * Kept for diagnostics / experiments; do not wire back into Learn.
 */
export function windowedAdaptiveOrder(
  parts: AdaptivePartInput[],
  userSkill: number,
  config: AdaptiveSelectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
): AdaptivePartInput[] {
  if (parts.length <= 1) return [...parts];

  const canonical = [...parts].sort((a, b) => a.order - b.order);
  const anchor = findStoryAnchor(canonical);
  const distributionCounter = createDistributionCounter();

  const beforeAnchor = canonical.filter((p) => p.order < anchor);
  const fromAnchor = canonical.filter((p) => p.order >= anchor);

  const result: AdaptivePartInput[] = [...beforeAnchor];

  const windowSize = Math.max(1, config.reorderWindowSize);
  let start = 0;
  while (start < fromAnchor.length) {
    const end = Math.min(start + windowSize, fromAnchor.length);
    const slice = fromAnchor.slice(start, end);
    result.push(...orderSegment(slice, userSkill, config, distributionCounter));
    start = end;
  }

  return result;
}

/**
 * Compare two parts for diagnostics.
 * Priority: story order → difficulty match → zone → review.
 */
export function compareAdaptiveParts(
  a: AdaptivePartInput,
  b: AdaptivePartInput,
  userSkill: number,
  config: AdaptiveSelectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
): number {
  if (a.order !== b.order) return a.order - b.order;

  const effA = effectiveScore(a, config);
  const effB = effectiveScore(b, config);
  const matchA = difficultyMatchDistance(effA, userSkill, config);
  const matchB = difficultyMatchDistance(effB, userSkill, config);
  if (matchA !== matchB) return matchA - matchB;

  const zoneA = classifyDifficultyZone(effA, userSkill, config);
  const zoneB = classifyDifficultyZone(effB, userSkill, config);
  const zoneRank = (z: typeof zoneA) =>
    z === "near" ? 0 : z === "easier" ? 1 : z === "stretch" ? 2 : 3;
  const zr = zoneRank(zoneA) - zoneRank(zoneB);
  if (zr !== 0) return zr;

  return reviewReminderBonus(b) - reviewReminderBonus(a);
}
