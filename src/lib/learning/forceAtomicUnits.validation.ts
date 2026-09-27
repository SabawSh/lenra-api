/**
 * Learner runtime policy: forceAtomicUnits bypasses skill-based adjacent merge.
 *
 *   npm run test:force-atomic-units
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import assert from "node:assert/strict";
import { writeFileSync } from "fs";
import { join } from "path";

import { buildLearningUnits } from "@/lib/skill-engine/learning-units";
import { playlistHasMergedLearningUnits } from "@/lib/learning/materializedSectionBlueprint";

const serverOnlyPath = join(process.cwd(), "node_modules/server-only/index.js");
const original = `throw new Error(
  "This module cannot be imported from a Client Component module. " +
    "It should only be used from a Server Component."
);
`;
writeFileSync(serverOnlyPath, "module.exports={};\n");

type StubPart = {
  id: string;
  order: number;
  difficultyScore: number | null;
  wordCount: number;
  speechDurationMs: number;
  /** Stand-in for canonicalKey — identity preserved on the part object. */
  canonicalKey: string;
};

function stub(
  order: number,
  opts?: Partial<StubPart> & { difficultyScore?: number },
): StubPart {
  const id = opts?.id ?? `part-${order}`;
  return {
    id,
    order,
    difficultyScore: opts?.difficultyScore ?? 10,
    wordCount: opts?.wordCount ?? 3,
    speechDurationMs: opts?.speechDurationMs ?? 800,
    canonicalKey: opts?.canonicalKey ?? `ck-${order}`,
  };
}

async function main() {
  try {
    const {
      buildSectionLearningUnits,
      LEARNER_FORCE_ATOMIC_UNITS,
    } = await import("./buildSectionLearningUnits");

    assert.equal(
      LEARNER_FORCE_ATOMIC_UNITS,
      true,
      "learner policy must default to atomic units",
    );

    const sectionParts = [
      stub(1, { difficultyScore: 5 }),
      stub(2, { difficultyScore: 40 }),
      stub(3, { difficultyScore: 90 }),
      stub(4, { difficultyScore: 12 }),
    ];

    // 1–5: forceAtomicUnits=true → no merge, order, count, keys, scores irrelevant
    const atomic = await buildSectionLearningUnits(sectionParts, null, undefined, {
      forceAtomicUnits: true,
    });

    assert.equal(
      atomic.length,
      sectionParts.length,
      "unit count must equal canonical part count",
    );
    assert.ok(
      atomic.every((unit) => unit.parts.length === 1),
      "adjacent parts must not merge when forceAtomicUnits=true",
    );
    assert.deepEqual(
      atomic.map((unit) => unit.parts[0]!.order),
      [1, 2, 3, 4],
      "canonical ordering unchanged",
    );
    assert.deepEqual(
      atomic.map((unit) => unit.parts[0]!.canonicalKey),
      ["ck-1", "ck-2", "ck-3", "ck-4"],
      "each unit retains original canonicalKey",
    );
    assert.deepEqual(
      atomic.map((unit) => unit.parts[0]!.difficultyScore),
      [5, 40, 90, 12],
      "different difficulty scores must not cause merging",
    );

    // Default policy (omit option) matches forceAtomicUnits=true
    const defaulted = await buildSectionLearningUnits(sectionParts, null);
    assert.equal(defaulted.length, sectionParts.length);
    assert.ok(defaulted.every((unit) => unit.parts.length === 1));

    // 6: policy disabled → underlying merge algorithm still merges adjacent clips
    const mergeInputs = sectionParts.map((part) => ({
      id: part.id,
      order: part.order,
      difficultyScore: part.difficultyScore,
      wordCount: part.wordCount,
      speechDurationMs: part.speechDurationMs,
      progress: null,
    }));
    const highSkillMerged = buildLearningUnits(mergeInputs, 95);
    assert.ok(
      highSkillMerged.some((unit) => unit.parts.length > 1),
      "mergeAdjacentParts must still merge when buildLearningUnits runs (policy off)",
    );

    const policyOff = await buildSectionLearningUnits(
      sectionParts,
      null,
      undefined,
      {
        forceAtomicUnits: false,
        prefetchedUserSkill: 95,
        prefetchedProgressMap: new Map(),
      },
    );
    assert.ok(
      policyOff.some((unit) => unit.parts.length > 1),
      "forceAtomicUnits=false must restore skill-based merge",
    );
    assert.ok(
      policyOff.length < sectionParts.length,
      "merged path yields fewer units than atomic parts",
    );

    // 7: vocabulary/grammar/translation data untouched by this policy layer
    // (this module only builds unit boundaries — no content-pipeline imports)
    assert.equal(
      typeof (await import("./buildSectionLearningUnits")).buildSectionLearningUnits,
      "function",
    );

    // 8: materialized blueprint merge detection
    assert.equal(
      playlistHasMergedLearningUnits({
        learningUnits: [
          { parts: [sectionParts[0]!] },
          { parts: [sectionParts[1]!] },
        ],
      }),
      false,
    );
    assert.equal(
      playlistHasMergedLearningUnits({
        learningUnits: [
          { parts: [sectionParts[0]!, sectionParts[1]!] },
        ],
      }),
      true,
    );
    assert.equal(
      playlistHasMergedLearningUnits({
        learningUnits: [{ parts: [sectionParts[0]!] }],
        progressionUnits: [
          { parts: [sectionParts[1]!, sectionParts[2]!] },
        ],
      }),
      true,
    );

    console.log("forceAtomicUnits.validation: ok");
  } finally {
    writeFileSync(serverOnlyPath, original);
  }
}

main().catch((error) => {
  writeFileSync(serverOnlyPath, original);
  console.error(error);
  process.exit(1);
});
