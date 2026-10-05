/**
 * Phase 1 Adaptive Teacher: Learn playlist preserves movie story order.
 *
 * Difficulty adapts how the user practices a scene, not which scene they watch.
 *
 * Run: npx tsx src/lib/learning/learnPlaylistStoryOrder.validation.ts
 */
import assert from "node:assert/strict";

import { sortAdaptiveParts } from "@/lib/skill-engine/ordering/sortAdaptiveParts";
import type { AdaptivePartInput } from "@/lib/skill-engine/domain/types";
import { DEFAULT_ADAPTIVE_SELECTION_CONFIG } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";
import { getAdaptiveEpisodeOrder } from "@/lib/learning/adaptiveEpisodeOrdering";
import { sliceSectionFromGlobalOrder } from "@/lib/learning/sections";

function part(
  order: number,
  difficultyScore: number,
  opts?: Partial<AdaptivePartInput>,
): AdaptivePartInput {
  return {
    id: `clip-${order}`,
    order,
    difficultyScore,
    progress: null,
    dueToday: false,
    ...opts,
  };
}

/** Shuffled pool where difficulty ranking would previously swap clips by ability. */
function extremeDifficultyPool(): AdaptivePartInput[] {
  return [
    part(3, 72),
    part(1, 40),
    part(4, 90),
    part(2, 28),
    part(5, 55),
    part(6, 15),
    part(8, 80),
    part(7, 60),
  ];
}

async function main() {
  const pool = extremeDifficultyPool();
  const storyOrderIds = [...pool]
    .sort((a, b) => a.order - b.order)
    .map((p) => p.id);

  const beginner = sortAdaptiveParts({
    parts: pool,
    userSkill: 25,
    config: DEFAULT_ADAPTIVE_SELECTION_CONFIG,
  });
  const advanced = sortAdaptiveParts({
    parts: pool,
    userSkill: 75,
    config: DEFAULT_ADAPTIVE_SELECTION_CONFIG,
  });

  assert.deepEqual(
    beginner.map((p) => p.id),
    storyOrderIds,
    "Beginner Learn playlist must exactly match parts.order",
  );
  assert.deepEqual(
    advanced.map((p) => p.id),
    storyOrderIds,
    "Advanced Learn playlist must exactly match parts.order",
  );
  assert.deepEqual(
    beginner.map((p) => p.id),
    advanced.map((p) => p.id),
    "Beginner (25) and Advanced (75) must receive identical Learn playlist order",
  );

  const episodeParts = pool.map((p) => ({
    id: p.id,
    order: p.order,
    difficulty: "medium" as const,
    difficultyScore: p.difficultyScore,
  }));

  const apiBeginner = await getAdaptiveEpisodeOrder({
    episodeParts,
    user: null,
  });
  const apiAdvanced = await getAdaptiveEpisodeOrder({
    episodeParts: [...episodeParts].reverse(),
    user: null,
  });

  assert.deepEqual(
    apiBeginner.map((p) => p.id),
    storyOrderIds,
    "getAdaptiveEpisodeOrder must return parts.order",
  );
  assert.deepEqual(
    apiAdvanced.map((p) => p.id),
    storyOrderIds,
    "getAdaptiveEpisodeOrder must ignore input shuffle",
  );

  const section1 = sliceSectionFromGlobalOrder(apiBeginner, 1, 4);
  assert.deepEqual(
    section1.map((p) => p.id),
    ["clip-1", "clip-2", "clip-3", "clip-4"],
  );

  console.log("learnPlaylistStoryOrder.validation: ok", {
    beginnerOrder: beginner.map((p) => p.order),
    advancedOrder: advanced.map((p) => p.order),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
