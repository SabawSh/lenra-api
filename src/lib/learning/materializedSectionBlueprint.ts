import type {
  MaterializedSectionBlueprint,
  MaterializedSectionPartRow,
  MaterializedSectionUnitPartRow,
} from "@/lib/db/queries/userMaterializedSections";
import { computeUnitMetrics } from "@/lib/skill-engine/learning-units/mergeAlgorithm";
import {
  DEFAULT_LEARNING_UNIT_BUILDER_CONFIG,
  type LearningUnit,
} from "@/lib/skill-engine/learning-units";
import type { DifficultyZone } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";
import { createHash } from "crypto";

export function curriculumVersionFromPartOrder(
  orderedParts: readonly { id: string; order: number }[],
): string {
  const body = orderedParts.map((part) => `${part.id}:${part.order}`).join("|");
  return createHash("sha1").update(body).digest("hex");
}

export function unitPartIdsFromLearningUnits(
  units: ReadonlyArray<{ parts: ReadonlyArray<{ id: string }> }>,
): string[][] {
  return units.map((unit) => unit.parts.map((part) => part.id));
}

/**
 * True when a playlist (or blueprint reconstruction) still groups multiple
 * canonical parts into one learning/progression unit — incompatible with
 * {@link LEARNER_FORCE_ATOMIC_UNITS}.
 */
export function playlistHasMergedLearningUnits(playlist: {
  learningUnits?: ReadonlyArray<{ parts: readonly unknown[] }>;
  progressionUnits?: ReadonlyArray<{ parts: readonly unknown[] }>;
}): boolean {
  const units = [
    ...(playlist.learningUnits ?? []),
    ...(playlist.progressionUnits ?? []),
  ];
  return units.some((unit) => unit.parts.length > 1);
}

/**
 * True when persisted atomic part sequence is not movie story order
 * (`parts.order` ascending). Legacy windowed adaptive blueprints can freeze
 * adjacent swaps (e.g. clips 4↔5); those must rematerialize.
 */
export function playlistViolatesStoryOrder(playlist: {
  atomicParts?: ReadonlyArray<{ order: number }>;
}): boolean {
  const parts = playlist.atomicParts ?? [];
  for (let i = 1; i < parts.length; i++) {
    if (parts[i]!.order < parts[i - 1]!.order) return true;
  }
  return false;
}

type PartLike = {
  id: string;
  order: number;
  difficultyScore: number | null;
  wordCount: number;
  speechDurationMs: number;
};

function groupBlueprintRows(
  rows: readonly MaterializedSectionUnitPartRow[],
): string[][] {
  const byUnit = new Map<number, string[]>();
  for (const row of rows) {
    const unit = byUnit.get(row.unitIndex) ?? [];
    unit[row.partOrderInUnit] = row.partId;
    byUnit.set(row.unitIndex, unit);
  }
  return [...byUnit.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, partIds]) => partIds.filter(Boolean));
}

export function blueprintAtomicPartIds(
  rows: readonly MaterializedSectionPartRow[],
): string[] {
  return [...rows]
    .sort((a, b) => a.order - b.order)
    .map((row) => row.partId);
}

export function reconstructLearningUnitsFromBlueprint<T extends PartLike>(
  partIdsByUnit: readonly string[][],
  orderedParts: readonly T[],
  targetZone: DifficultyZone = "near",
): LearningUnit<T>[] {
  const byId = new Map(orderedParts.map((part) => [part.id, part]));
  return partIdsByUnit.map((partIds) => {
    const parts = partIds.map((partId) => {
      const part = byId.get(partId);
      if (!part) {
        throw new Error(
          `[materialized-section] missing hydrated part ${partId} for persisted unit`,
        );
      }
      return part;
    });
    return {
      parts,
      metrics: computeUnitMetrics(parts, DEFAULT_LEARNING_UNIT_BUILDER_CONFIG),
      targetZone,
    };
  });
}

export function reconstructPlaylistFromBlueprint<T extends PartLike>(
  blueprint: MaterializedSectionBlueprint,
  orderedParts: readonly T[],
): {
  atomicParts: T[];
  learningUnits: LearningUnit<T>[];
  progressionUnits: LearningUnit<T>[];
} {
  const atomicIds = blueprintAtomicPartIds(blueprint.atomicParts);
  const byId = new Map(orderedParts.map((part) => [part.id, part]));
  const atomicParts = atomicIds.map((partId) => {
    const part = byId.get(partId);
    if (!part) {
      throw new Error(
        `[materialized-section] missing hydrated part ${partId} for persisted atomic list`,
      );
    }
    return part;
  });
  return {
    atomicParts,
    learningUnits: reconstructLearningUnitsFromBlueprint(
      groupBlueprintRows(blueprint.learningUnitParts),
      atomicParts,
    ),
    progressionUnits: reconstructLearningUnitsFromBlueprint(
      groupBlueprintRows(blueprint.progressionUnitParts),
      atomicParts,
    ),
  };
}
