/**
 * Immutable materialized section blueprint regression checks.
 *
 * Run:
 *   npx tsx lib/learning/materializedSections.validation.ts
 */
import type { MaterializedSectionBlueprint } from "@/lib/db/queries/userMaterializedSections";
import {
  playlistHasMergedLearningUnits,
  reconstructPlaylistFromBlueprint,
  unitPartIdsFromLearningUnits,
} from "@/lib/learning/materializedSectionBlueprint";
import type { LearningUnit } from "@/lib/skill-engine/learning-units";

type StubPart = {
  id: string;
  order: number;
  difficultyScore: number | null;
  wordCount: number;
  speechDurationMs: number;
};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function part(id: string, order: number): StubPart {
  return { id, order, difficultyScore: 50, wordCount: 1, speechDurationMs: 1000 };
}

function ids(units: ReadonlyArray<LearningUnit<StubPart>>): string[][] {
  return unitPartIdsFromLearningUnits(units);
}

const orderedParts = [
  part("A", 1),
  part("B", 2),
  part("C", 3),
  part("D", 4),
  part("E", 5),
  part("F", 6),
];

const blueprint: MaterializedSectionBlueprint = {
  header: {
    id: 1,
    userId: "u1",
    videoId: "v1",
    episodeId: "e1",
    scopeKey: "episode:e1",
    sectionIndex: 22,
    curriculumVersion: "v",
    globalStartIndex: null,
    globalEndIndexExclusive: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  atomicParts: orderedParts.map((p, order) => ({
    sectionId: 1,
    partId: p.id,
    order,
  })),
  learningUnitParts: [
    { sectionId: 1, unitIndex: 1, partOrderInUnit: 0, partId: "A" },
    { sectionId: 1, unitIndex: 1, partOrderInUnit: 1, partId: "B" },
    { sectionId: 1, unitIndex: 2, partOrderInUnit: 0, partId: "C" },
    { sectionId: 1, unitIndex: 3, partOrderInUnit: 0, partId: "D" },
    { sectionId: 1, unitIndex: 3, partOrderInUnit: 1, partId: "E" },
    { sectionId: 1, unitIndex: 4, partOrderInUnit: 0, partId: "F" },
  ],
  progressionUnitParts: [
    { sectionId: 1, unitIndex: 1, partOrderInUnit: 0, partId: "A" },
    { sectionId: 1, unitIndex: 1, partOrderInUnit: 1, partId: "B" },
    { sectionId: 1, unitIndex: 1, partOrderInUnit: 2, partId: "C" },
    { sectionId: 1, unitIndex: 2, partOrderInUnit: 0, partId: "D" },
    { sectionId: 1, unitIndex: 2, partOrderInUnit: 1, partId: "E" },
    { sectionId: 1, unitIndex: 3, partOrderInUnit: 0, partId: "F" },
  ],
};

{
  const reconstructed = reconstructPlaylistFromBlueprint(blueprint, orderedParts);
  assert(
    reconstructed.atomicParts.map((p) => p.id).join(",") === "A,B,C,D,E,F",
    "atomic part membership/order must round-trip",
  );
  assert(
    JSON.stringify(ids(reconstructed.learningUnits)) ===
      JSON.stringify([["A", "B"], ["C"], ["D", "E"], ["F"]]),
    "playback learningUnits must round-trip exactly",
  );
  assert(
    JSON.stringify(ids(reconstructed.progressionUnits)) ===
      JSON.stringify([["A", "B", "C"], ["D", "E"], ["F"]]),
    "progressionUnits must round-trip exactly",
  );
}

{
  const reopenedWithNewSkillCandidate = [
    ["A", "B", "C"],
    ["D", "E"],
    ["F"],
  ];
  const reconstructed = reconstructPlaylistFromBlueprint(blueprint, orderedParts);
  assert(
    JSON.stringify(ids(reconstructed.learningUnits)) !==
      JSON.stringify(reopenedWithNewSkillCandidate),
    "reopen must use persisted playback blueprint, not current regrouping",
  );
}

{
  const reconstructed = reconstructPlaylistFromBlueprint(blueprint, orderedParts);
  const visibleUnitStep = 3;
  const unit = reconstructed.learningUnits[visibleUnitStep - 1];
  assert(
    unit.parts.map((p) => p.id).join(",") === "D,E",
    "visibleUnitStep must keep pointing to the same playback unit",
  );
  const progressPartId = unit.parts[unit.parts.length - 1]?.id;
  const companionPartIds = unit.parts.slice(0, -1).map((p) => p.id);
  assert(progressPartId === "E", "progressPartId must remain stable");
  assert(
    companionPartIds.join(",") === "D",
    "companionPartIds must remain stable",
  );
}

{
  assert(
    playlistHasMergedLearningUnits(
      reconstructPlaylistFromBlueprint(blueprint, orderedParts),
    ),
    "legacy merged blueprints must be detectable for atomic-policy rematerialize",
  );
  assert(
    !playlistHasMergedLearningUnits({
      learningUnits: orderedParts.map((p) => ({
        parts: [p],
        metrics: { difficulty: 0, wordCount: 1, speechDurationMs: 1 },
        targetZone: "near",
      })),
      progressionUnits: orderedParts.map((p) => ({
        parts: [p],
        metrics: { difficulty: 0, wordCount: 1, speechDurationMs: 1 },
        targetZone: "near",
      })),
    }),
    "atomic blueprints must not be flagged as merged",
  );
}

console.log("materializedSections.validation: all passed");
