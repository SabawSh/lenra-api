import type { ConsumedSpan } from "./types";
import {
  candidateIdFor,
  isHardEvidenceTier,
  type VoiceCandidate,
} from "./candidateTypes";

export type ConflictGraphNode = {
  candidateId: string;
  candidate: VoiceCandidate;
};

export type ConflictGraphEdge = {
  leftCandidateId: string;
  rightCandidateId: string;
  overlappingTokenPositions: number[];
};

export type ConflictGraph = {
  nodes: ConflictGraphNode[];
  overlapEdges: ConflictGraphEdge[];
  /** Token positions reserved by sticky prior commits. */
  lockedTokenPositions: ReadonlySet<number>;
  /** Token position → hard-owner candidate id (T1/T2). */
  hardOwnership: ReadonlyMap<number, string>;
};

function spanTokenPositions(span: { start: number; end: number }): number[] {
  const positions: number[] = [];
  for (let index = span.start; index <= span.end; index++) {
    positions.push(index);
  }
  return positions;
}

function spansOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function overlappingPositions(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number[] {
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  if (start > end) return [];
  const positions: number[] = [];
  for (let index = start; index <= end; index++) {
    positions.push(index);
  }
  return positions;
}

function lockedPositionsFromConsumedSpans(
  consumedSpans: readonly ConsumedSpan[],
): Set<number> {
  const locked = new Set<number>();
  for (const span of consumedSpans) {
    for (const index of spanTokenPositions(span)) {
      locked.add(index);
    }
  }
  return locked;
}

function buildHardOwnership(
  candidates: readonly VoiceCandidate[],
): Map<number, string> {
  const ownership = new Map<number, string>();

  for (const candidate of candidates) {
    if (!isHardEvidenceTier(candidate.evidenceTier)) continue;
    for (const position of spanTokenPositions(candidate.span)) {
      const existing = ownership.get(position);
      if (!existing) {
        ownership.set(position, candidate.candidateId);
        continue;
      }
      const existingNode = candidates.find(
        (row) => row.candidateId === existing,
      );
      if (!existingNode) {
        ownership.set(position, candidate.candidateId);
        continue;
      }
      if (candidate.evidenceTier < existingNode.evidenceTier) {
        ownership.set(position, candidate.candidateId);
        continue;
      }
      if (
        candidate.evidenceTier === existingNode.evidenceTier &&
        candidate.score > existingNode.score
      ) {
        ownership.set(position, candidate.candidateId);
      }
    }
  }

  return ownership;
}

export function buildConflictGraph(input: {
  candidates: readonly VoiceCandidate[];
  consumedSpans?: readonly ConsumedSpan[];
}): ConflictGraph {
  const nodes = input.candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    candidate,
  }));

  const overlapEdges: ConflictGraphEdge[] = [];
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex++) {
      const left = nodes[leftIndex]!;
      const right = nodes[rightIndex]!;
      if (!spansOverlap(left.candidate.span, right.candidate.span)) continue;
      const overlappingTokenPositions = overlappingPositions(
        left.candidate.span,
        right.candidate.span,
      );
      if (overlappingTokenPositions.length === 0) continue;
      overlapEdges.push({
        leftCandidateId: left.candidateId,
        rightCandidateId: right.candidateId,
        overlappingTokenPositions,
      });
    }
  }

  const lockedTokenPositions = lockedPositionsFromConsumedSpans(
    input.consumedSpans ?? [],
  );
  const hardOwnership = buildHardOwnership(input.candidates);

  return {
    nodes,
    overlapEdges,
    lockedTokenPositions,
    hardOwnership,
  };
}

export function isCandidateEligibleOnGraph(
  graph: ConflictGraph,
  candidate: VoiceCandidate,
): { eligible: boolean; reason?: "STICKY_LOCK_BLOCKED" | "HARD_OWNERSHIP_BLOCKED" } {
  for (const position of spanTokenPositions(candidate.span)) {
    if (graph.lockedTokenPositions.has(position)) {
      return { eligible: false, reason: "STICKY_LOCK_BLOCKED" };
    }
    const hardOwner = graph.hardOwnership.get(position);
    if (
      hardOwner &&
      hardOwner !== candidate.candidateId &&
      !isHardEvidenceTier(candidate.evidenceTier)
    ) {
      return { eligible: false, reason: "HARD_OWNERSHIP_BLOCKED" };
    }
  }
  return { eligible: true };
}

export function competingTokenPositions(
  graph: ConflictGraph,
  candidate: VoiceCandidate,
  otherCandidateId: string,
): number[] {
  const edge = graph.overlapEdges.find(
    (row) =>
      (row.leftCandidateId === candidate.candidateId &&
        row.rightCandidateId === otherCandidateId) ||
      (row.rightCandidateId === candidate.candidateId &&
        row.leftCandidateId === otherCandidateId),
  );
  return edge?.overlappingTokenPositions ?? [];
}

export function makeCandidateId(tileId: string, span: { start: number; end: number }): string {
  return candidateIdFor(tileId, span);
}
