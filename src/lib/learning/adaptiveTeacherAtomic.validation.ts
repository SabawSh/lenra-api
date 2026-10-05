/**
 * Adaptive Teacher + atomic units: zones, selection inputs, no section lock.
 *
 *   npm run test:adaptive-teacher-atomic
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import assert from "node:assert/strict";
import { writeFileSync } from "fs";
import { join } from "path";

import {
  classifyDifficultyZone,
  zoneBounds,
} from "@/lib/skill-engine/ordering/difficultyZones";
import { sortAdaptiveParts } from "@/lib/skill-engine/ordering/sortAdaptiveParts";
import type { AdaptivePartInput } from "@/lib/skill-engine/domain/types";
import { DEFAULT_ADAPTIVE_SELECTION_CONFIG } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";
import {
  isSectionContentAccessible,
  SECTION_CONTENT_ACCESS_UNRESTRICTED,
} from "@/lib/learning/sectionAccessPolicy";
import {
  partMatchesContentDifficultyFilter,
  recommendContentDifficultyFromEnglishLevel,
} from "@/lib/learning/videoDifficultyMix";

const serverOnlyPath = join(process.cwd(), "node_modules/server-only/index.js");
const original = `throw new Error(
  "This module cannot be imported from a Client Component module. " +
    "It should only be used from a Server Component."
);
`;
writeFileSync(serverOnlyPath, "module.exports={};\n");

function part(
  order: number,
  difficultyScore: number,
  opts?: Partial<AdaptivePartInput>,
): AdaptivePartInput {
  return {
    id: `p-${order}`,
    order,
    difficultyScore,
    progress: null,
    dueToday: false,
    ...opts,
  };
}

async function main() {
  try {
    const { LEARNER_FORCE_ATOMIC_UNITS, buildSectionLearningUnits } =
      await import("./buildSectionLearningUnits");

    assert.equal(LEARNER_FORCE_ATOMIC_UNITS, true);

    // ── 70/20/10 bands relative to learner skill (not movie Easy/Medium/Advanced)
    const skill = 55;
    const cfg = DEFAULT_ADAPTIVE_SELECTION_CONFIG;
    assert.deepEqual(cfg.distributionTargets, {
      near: 0.7,
      easier: 0.2,
      stretch: 0.1,
    });
    assert.deepEqual(zoneBounds("near", skill, cfg), { min: 50, max: 60 });
    assert.deepEqual(zoneBounds("easier", skill, cfg), { min: 45, max: 50 });
    assert.deepEqual(zoneBounds("stretch", skill, cfg), { min: 60, max: 65 });

    assert.equal(classifyDifficultyZone(40, skill, cfg), "outside");
    assert.equal(classifyDifficultyZone(50, skill, cfg), "near");
    assert.equal(classifyDifficultyZone(56, skill, cfg), "near");
    // Boundary 60 is inclusive on near max and stretch min — near wins (checked first)
    assert.equal(classifyDifficultyZone(60, skill, cfg), "near");
    assert.equal(classifyDifficultyZone(61, skill, cfg), "stretch");
    assert.equal(classifyDifficultyZone(64, skill, cfg), "stretch");
    assert.equal(classifyDifficultyZone(75, skill, cfg), "outside");
    assert.equal(classifyDifficultyZone(95, skill, cfg), "outside");

    // Movie difficulty filter is independent of Adaptive Teacher skill bands
    assert.equal(
      recommendContentDifficultyFromEnglishLevel("advanced", {
        easy: 10,
        medium: 20,
        advanced: 70,
        total: 100,
      }),
      "advanced",
    );
    assert.equal(partMatchesContentDifficultyFilter("hard", "advanced"), true);
    // Skill 55 ≠ movie "advanced" bucket — separate systems
    assert.equal(classifyDifficultyZone(55, skill, cfg), "near");

    // Adaptive Teacher orders atomic parts (never merges them)
    const sectionParts = [
      {
        id: "a",
        order: 1,
        difficultyScore: 40,
        wordCount: 3,
        speechDurationMs: 800,
      },
      {
        id: "b",
        order: 2,
        difficultyScore: 56,
        wordCount: 3,
        speechDurationMs: 800,
      },
      {
        id: "c",
        order: 3,
        difficultyScore: 95,
        wordCount: 3,
        speechDurationMs: 800,
      },
      {
        id: "d",
        order: 4,
        difficultyScore: 60,
        wordCount: 3,
        speechDurationMs: 800,
      },
    ];
    const units = await buildSectionLearningUnits(sectionParts, null, undefined, {
      forceAtomicUnits: true,
      prefetchedUserSkill: skill,
    });
    assert.equal(units.length, 4);
    assert.ok(units.every((u) => u.parts.length === 1));
    assert.deepEqual(
      units.map((u) => u.parts[0]!.id),
      ["a", "b", "c", "d"],
      "atomic path preserves part identity; Adaptive Teacher does not merge",
    );

    // Learn playlist = parts.order only — difficulty never reorders clips.
    // Difficulty adapts how the user practices a scene, not which scene they watch.
    const shuffled = [part(12, 60), part(10, 56), part(13, 50), part(11, 95)];
    const ordered = sortAdaptiveParts({
      parts: shuffled,
      userSkill: skill,
      config: cfg,
    });
    assert.deepEqual(
      ordered.map((p) => p.id),
      ["p-10", "p-11", "p-12", "p-13"],
      "Learn order must exactly match parts.order",
    );
    assert.ok(ordered.some((p) => p.difficultyScore === 95));

    // Adaptive Teacher must not lock sections
    assert.equal(SECTION_CONTENT_ACCESS_UNRESTRICTED, true);
    assert.equal(isSectionContentAccessible(1), true);
    assert.equal(isSectionContentAccessible(32), true);
    assert.equal(isSectionContentAccessible(99), true);

    console.log("adaptiveTeacherAtomic.validation: ok");
  } finally {
    writeFileSync(serverOnlyPath, original);
  }
}

main().catch((error) => {
  writeFileSync(serverOnlyPath, original);
  console.error(error);
  process.exit(1);
});
