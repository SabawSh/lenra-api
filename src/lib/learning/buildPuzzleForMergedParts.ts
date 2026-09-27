import { buildPuzzleFromTokens } from "@/helper/puzzel/buildPuzzleFromTokens";
import { seededShuffle } from "@/helper/puzzel/seededShuffle";
import { scopePuzzlePartId } from "@/lib/learning/scopeMergedPartIds";
import type { PuzzlePart } from "@/types/puzzle";
import type { Part } from "@/types/video";

function scopePuzzleParts(partId: string, parts: PuzzlePart[]): PuzzlePart[] {
  return parts.map((p) => ({
    ...p,
    id: scopePuzzlePartId(partId, p.id),
  }));
}

/**
 * Build a puzzle for a virtually merged learning unit.
 * Each atomic clip keeps its own chunk boundaries — tokens are never
 * re-partitioned across clip edges.
 */
export function buildPuzzleForMergedParts(
  parts: readonly Part[],
  shuffleSeed: string,
): { parts: PuzzlePart[]; shuffled: PuzzlePart[] } {
  if (parts.length === 0) {
    return { parts: [], shuffled: [] };
  }
  if (parts.length === 1) {
    const part = parts[0]!;
    const tokens = part.tokens ?? [];
    if (tokens.length === 0) {
      return { parts: [], shuffled: [] };
    }
    return buildPuzzleFromTokens(
      tokens,
      part.difficulty,
      part.difficultyScore ?? 50,
      shuffleSeed,
    );
  }

  const mergedParts: PuzzlePart[] = [];
  for (const part of parts) {
    const tokens = part.tokens ?? [];
    if (tokens.length === 0) continue;
    const clipPuzzle = buildPuzzleFromTokens(
      tokens,
      part.difficulty,
      part.difficultyScore ?? 50,
      `${shuffleSeed}:${part.id}`,
    );
    mergedParts.push(...scopePuzzleParts(part.id, clipPuzzle.parts));
  }

  return {
    parts: mergedParts,
    shuffled: seededShuffle(mergedParts, shuffleSeed),
  };
}
