import type {
  AdaptiveSelectionConfig,
  DifficultyZone,
} from "@/lib/skill-engine/policy/adaptiveSelectionConfig";
import {
  clampScore,
  DEFAULT_ADAPTIVE_SELECTION_CONFIG,
} from "@/lib/skill-engine/policy/adaptiveSelectionConfig";

export type ZoneBounds = { min: number; max: number };

export function zoneBounds(
  zone: DifficultyZone,
  userSkill: number,
  config: AdaptiveSelectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
): ZoneBounds {
  switch (zone) {
    case "near": {
      const half = config.toleranceHalfWidth;
      return {
        min: clampScore(userSkill - half),
        max: clampScore(userSkill + half),
      };
    }
    case "easier":
      return {
        min: clampScore(userSkill + config.easierBand.minOffset),
        max: clampScore(userSkill + config.easierBand.maxOffset),
      };
    case "stretch":
      return {
        min: clampScore(userSkill + config.stretchBand.minOffset),
        max: clampScore(userSkill + config.stretchBand.maxOffset),
      };
  }
}

/** Classify a content score into near / easier / stretch / outside. */
export function classifyDifficultyZone(
  difficultyScore: number,
  userSkill: number,
  config: AdaptiveSelectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
): DifficultyZone | "outside" {
  const zones: DifficultyZone[] = ["near", "easier", "stretch"];
  for (const zone of zones) {
    const { min, max } = zoneBounds(zone, userSkill, config);
    if (difficultyScore >= min && difficultyScore <= max) return zone;
  }
  return "outside";
}

/** Distance from the centre of a zone (0 = perfect centre match). */
export function zoneCentreDistance(
  difficultyScore: number,
  zone: DifficultyZone,
  userSkill: number,
  config: AdaptiveSelectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
): number {
  const { min, max } = zoneBounds(zone, userSkill, config);
  const centre = (min + max) / 2;
  return Math.abs(difficultyScore - centre);
}

/** Lower = better difficulty match to user skill (0 inside preferred band). */
export function difficultyMatchDistance(
  difficultyScore: number,
  userSkill: number,
  config: AdaptiveSelectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
): number {
  const { min, max } = zoneBounds("near", userSkill, config);
  if (difficultyScore >= min && difficultyScore <= max) return 0;
  if (difficultyScore < min) return min - difficultyScore;
  return difficultyScore - max;
}

export type DistributionCounter = {
  counts: Record<DifficultyZone, number>;
  total: number;
};

export function createDistributionCounter(): DistributionCounter {
  return { counts: { near: 0, easier: 0, stretch: 0 }, total: 0 };
}

/** Pick the zone most under-represented vs target distribution. */
export function mostNeededZone(
  counter: DistributionCounter,
  config: AdaptiveSelectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
): DifficultyZone {
  const targets = config.distributionTargets;
  let best: DifficultyZone = "near";
  let bestDeficit = -Infinity;

  for (const zone of ["near", "easier", "stretch"] as const) {
    const expected =
      counter.total > 0 ? targets[zone] * counter.total : targets[zone];
    const deficit = expected - counter.counts[zone];
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = zone;
    }
  }
  return best;
}

export function recordZone(
  counter: DistributionCounter,
  zone: DifficultyZone,
): void {
  counter.counts[zone] += 1;
  counter.total += 1;
}

/** Build slot targets for a window (e.g. 8 parts → ~6 near, ~2 easier, ~1 stretch). */
export function buildZoneSlots(
  windowSize: number,
  config: AdaptiveSelectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
): DifficultyZone[] {
  if (windowSize <= 0) return [];

  const targets = config.distributionTargets;
  const raw = (["near", "easier", "stretch"] as const).map((zone) => ({
    zone,
    count: targets[zone] * windowSize,
  }));

  const slots: DifficultyZone[] = [];
  const remainders: { zone: DifficultyZone; rem: number }[] = [];

  for (const { zone, count } of raw) {
    const base = Math.floor(count);
    for (let i = 0; i < base; i++) slots.push(zone);
    remainders.push({ zone, rem: count - base });
  }

  remainders.sort((a, b) => b.rem - a.rem);
  while (slots.length < windowSize && remainders.length > 0) {
    const pick = remainders.shift()!;
    slots.push(pick.zone);
    pick.rem -= 1;
    if (pick.rem > 0) remainders.unshift(pick);
    remainders.sort((a, b) => b.rem - a.rem);
  }

  while (slots.length < windowSize) slots.push("near");
  return slots.slice(0, windowSize);
}
