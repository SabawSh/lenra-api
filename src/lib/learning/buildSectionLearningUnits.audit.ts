/**
 * Audit buildSectionLearningUnits for a fixed section slice.
 * Run: npx tsx lib/learning/buildSectionLearningUnits.audit.ts
 *
 * Compares beginner (skill 25) vs advanced (skill 75) on the same parts.
 * Verifies that results are recomputed per skill (no cross-skill cache).
 */
import {
  buildLearningUnits,
  DEFAULT_LEARNING_UNIT_BUILDER_CONFIG,
  resolveMemoryBudget,
  type AtomicPartInput,
  type LearningUnit,
} from "@/lib/skill-engine/learning-units";
import { zoneBounds } from "@/lib/skill-engine/ordering/difficultyZones";
import { getOnboardingSkill } from "@/lib/skill/onboardingSkill";

const CONFIG = DEFAULT_LEARNING_UNIT_BUILDER_CONFIG;

/**
 * Global ranks 120–124 from video 9f139b0d (movie, 1508 parts).
 * Queried: SELECT ... ROW_NUMBER() ... WHERE rn BETWEEN 120 AND 124
 */
const SECTION_SLICE: Array<{
  globalRank: number;
  id: string;
  order: number;
  difficultyScore: number;
  wordCount: number;
  speechDurationMs: number;
}> = [
  { globalRank: 120, id: "ed71960b-d75f-4cec-861f-e67c30f4fe1d", order: 120, difficultyScore: 30, wordCount: 12, speechDurationMs: 3378 },
  { globalRank: 121, id: "947963ec-1049-4305-af8a-9628885b8b49", order: 121, difficultyScore: 10, wordCount: 3, speechDurationMs: 2711 },
  { globalRank: 122, id: "79cc9e3f-ebb1-43d8-a160-74c540349845", order: 122, difficultyScore: 22, wordCount: 5, speechDurationMs: 2419 },
  { globalRank: 123, id: "0e499157-0453-441b-a337-c77f259ac976", order: 123, difficultyScore: 48, wordCount: 10, speechDurationMs: 1980 },
  { globalRank: 124, id: "b4d4a813-cde7-4476-a712-58bb7e7bec2c", order: 124, difficultyScore: 64, wordCount: 17, speechDurationMs: 4089 },
];

const SKILL_CASES = [
  { label: "Beginner", userSkill: getOnboardingSkill("beginner") },
  { label: "Advanced", userSkill: getOnboardingSkill("advanced") },
] as const;

type AuditUnit = {
  partIds: string[];
  globalRanks: number[];
  mergedPartCount: number;
  unitDifficulty: number;
  wordCount: number;
  speechDurationMs: number;
  targetZone: string;
};

function toAtomic(
  row: (typeof SECTION_SLICE)[number],
): AtomicPartInput & { globalRank: number } {
  return {
    id: row.id,
    order: row.order,
    difficultyScore: row.difficultyScore,
    wordCount: row.wordCount,
    speechDurationMs: row.speechDurationMs,
    progress: null,
    dueToday: false,
    globalRank: row.globalRank,
  };
}

function formatUnits(units: LearningUnit<AtomicPartInput>[]): AuditUnit[] {
  return units.map((unit) => ({
    partIds: unit.parts.map((p) => p.id),
    globalRanks: unit.parts.map(
      (p) => (p as AtomicPartInput & { globalRank?: number }).globalRank ?? p.order,
    ),
    mergedPartCount: unit.parts.length,
    unitDifficulty: unit.metrics.difficulty,
    wordCount: unit.metrics.wordCount,
    speechDurationMs: unit.metrics.speechDurationMs,
    targetZone: unit.targetZone,
  }));
}

function unitSignature(units: AuditUnit[]): string {
  return units.map((u) => `[${u.globalRanks.join(",")}]`).join(" | ");
}

function auditSkillCase(
  label: string,
  userSkill: number,
  atomicInputs: AtomicPartInput[],
): { units: AuditUnit[]; signature: string } {
  const budget = resolveMemoryBudget(userSkill, CONFIG.memoryBudget);
  const targetDifficultyRange = zoneBounds("near", userSkill, CONFIG);

  const units = buildLearningUnits(atomicInputs, userSkill, CONFIG);
  const auditUnits = formatUnits(units);

  for (const u of auditUnits) {
  }

  const sig = unitSignature(auditUnits);
  return { units: auditUnits, signature: sig };
}

function verifyNoCrossSkillCache(
  beginnerSig: string,
  advancedSig: string,
): void {

  const beginnerUnits = buildLearningUnits(
    SECTION_SLICE.map(toAtomic),
    getOnboardingSkill("beginner"),
    CONFIG,
  );
  const advancedUnits = buildLearningUnits(
    SECTION_SLICE.map(toAtomic),
    getOnboardingSkill("advanced"),
    CONFIG,
  );
  const sig1 = unitSignature(formatUnits(beginnerUnits));
  const sig2 = unitSignature(formatUnits(advancedUnits));

  if (beginnerSig === advancedSig) {
  } else {
  }
}

function checkExpected(
  beginnerSig: string,
  advancedSig: string,
): void {
  const expectedBeginner = "[120] | [121] | [122] | [123] | [124]";
  const expectedAdvanced = "[120,121,122] | [123,124]";

  const beginnerFirst3 =
    beginnerSig.startsWith("[120] | [121] | [122]") ||
    beginnerSig.includes("[120] | [121] | [122]");
  const advancedOk =
    advancedSig.includes("[120,121,122]") && advancedSig.includes("[123,124]");

  if (beginnerFirst3 && advancedOk) {
  } else {
    if (!advancedOk && advancedSig.includes("[120,121,122]")) {
    }
  }
}

function main(): void {

  for (const row of SECTION_SLICE) {
  }

  const atomicInputs = SECTION_SLICE.map(toAtomic);

  const results = SKILL_CASES.map(({ label, userSkill }) =>
    auditSkillCase(label, userSkill, atomicInputs),
  );

  const [beginner, advanced] = results;
  verifyNoCrossSkillCache(beginner.signature, advanced.signature);
  checkExpected(beginner.signature, advanced.signature);
}

main();
