import {
  buildConflictGraph,
  competingTokenPositions,
  isCandidateEligibleOnGraph,
} from "./conflictGraph";
import {
  candidateIdFor,
  isHardEvidenceTier,
  type ResolutionPassResult,
  type SuppressedCandidate,
  type SuppressionReason,
  type VoiceCandidate,
  type WinnerDecision,
} from "./candidateTypes";
import type { PlacementCommitmentLevel } from "./types";
import { logPlacementOrder } from "./placementOrderTrace";

export type ResolveVoiceCandidatesInput = {
  candidates: readonly VoiceCandidate[];
  consumedSpans?: readonly { start: number; end: number }[];
  commitmentLevel?: PlacementCommitmentLevel;
  passId?: string;
};

function spanLength(span: { start: number; end: number }): number {
  return span.end - span.start + 1;
}

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

/**
 * Priority without tileId — tier, score, span fit, temporal start, token count.
 * Longer spans beat shorter at equal tier/score so literal prefixes lose ties.
 */
function compareCandidatePriority(
  left: VoiceCandidate,
  right: VoiceCandidate,
): number {
  if (left.evidenceTier !== right.evidenceTier) {
    return left.evidenceTier - right.evidenceTier;
  }
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  const leftLen = spanLength(left.span);
  const rightLen = spanLength(right.span);
  if (leftLen !== rightLen) {
    return rightLen - leftLen;
  }
  if (left.span.start !== right.span.start) {
    return left.span.start - right.span.start;
  }
  return 0;
}

function isLiteralGateMatch(candidate: VoiceCandidate): boolean {
  return candidate.acceptReason === "GATE_MATCH";
}

/** True when `shorter` starts with `longer` and covers fewer tokens. */
export function isStrictSpanPrefix(
  shorter: { start: number; end: number },
  longer: { start: number; end: number },
): boolean {
  return shorter.start === longer.start && shorter.end < longer.end;
}

/**
 * Longest-literal-prefix rule: when two GATE_MATCH candidates share a start and
 * one span is a strict prefix of the other, only the longer survives.
 */
export function suppressLiteralPrefixCandidates(
  candidates: readonly VoiceCandidate[],
): {
  kept: VoiceCandidate[];
  suppressed: SuppressedCandidate[];
} {
  const suppressedById = new Map<string, SuppressedCandidate>();

  const literals = candidates.filter(isLiteralGateMatch);
  for (const shorter of literals) {
    if (suppressedById.has(shorter.candidateId)) continue;

    let bestLonger: VoiceCandidate | null = null;
    for (const longer of literals) {
      if (shorter.candidateId === longer.candidateId) continue;
      if (!isStrictSpanPrefix(shorter.span, longer.span)) continue;
      if (
        bestLonger == null ||
        spanLength(longer.span) > spanLength(bestLonger.span) ||
        (spanLength(longer.span) === spanLength(bestLonger.span) &&
          longer.score > bestLonger.score)
      ) {
        bestLonger = longer;
      }
    }
    if (!bestLonger) continue;

    suppressedById.set(
      shorter.candidateId,
      toSuppressed(shorter, {
        suppressionReason: "LITERAL_PREFIX_SUBSUMED",
        defeatedByCandidateId: bestLonger.candidateId,
        defeatedByTileId: bestLonger.tileId,
        scoreDelta: bestLonger.score - shorter.score,
        competingTokenPositions: spanTokenPositions(shorter.span),
      }),
    );
  }

  const kept = candidates.filter(
    (candidate) => !suppressedById.has(candidate.candidateId),
  );
  return { kept, suppressed: [...suppressedById.values()] };
}

function suppressionReasonFor(
  loser: VoiceCandidate,
  winner: VoiceCandidate,
): SuppressionReason {
  if (loser.evidenceTier > winner.evidenceTier) {
    return "LOST_TO_HIGHER_TIER";
  }
  if (loser.score < winner.score) {
    return "LOST_TO_HIGHER_SCORE";
  }
  return "MUTUAL_EXCLUSION";
}

function toSuppressed(
  candidate: VoiceCandidate,
  input: {
    suppressionReason: SuppressionReason;
    defeatedByCandidateId: string | null;
    defeatedByTileId: string | null;
    scoreDelta: number | null;
    competingTokenPositions: number[];
  },
): SuppressedCandidate {
  return {
    candidateId: candidate.candidateId,
    tileId: candidate.tileId,
    span: candidate.span,
    evidenceTier: candidate.evidenceTier,
    tierLabel: candidate.tierLabel,
    acceptReason: candidate.acceptReason,
    score: candidate.score,
    suppressionReason: input.suppressionReason,
    defeatedByCandidateId: input.defeatedByCandidateId,
    defeatedByTileId: input.defeatedByTileId,
    scoreDelta: input.scoreDelta,
    competingTokenPositions: input.competingTokenPositions,
  };
}

/**
 * Single semantic owner — builds conflict graph, applies hard-beats-soft,
 * produces a conflict-free winner set.
 */
export function resolveVoiceCandidates(
  input: ResolveVoiceCandidatesInput,
): ResolutionPassResult {
  const commitmentLevel = input.commitmentLevel ?? "final";
  const graph = buildConflictGraph({
    candidates: input.candidates,
    consumedSpans: input.consumedSpans,
  });

  const ineligible: SuppressedCandidate[] = [];
  const eligible: VoiceCandidate[] = [];

  for (const node of graph.nodes) {
    const eligibility = isCandidateEligibleOnGraph(graph, node.candidate);
    if (!eligibility.eligible) {
      const reason =
        eligibility.reason === "STICKY_LOCK_BLOCKED"
          ? "STICKY_LOCK_BLOCKED"
          : "HARD_OWNERSHIP_BLOCKED";
      const hardOwnerId =
        reason === "HARD_OWNERSHIP_BLOCKED"
          ? [...graph.hardOwnership.entries()].find(([position]) =>
              spanTokenPositions(node.candidate.span).includes(position),
            )?.[1] ?? null
          : null;
      const hardOwner = hardOwnerId
        ? graph.nodes.find((row) => row.candidateId === hardOwnerId)?.candidate
        : null;
      ineligible.push(
        toSuppressed(node.candidate, {
          suppressionReason: reason,
          defeatedByCandidateId: hardOwnerId,
          defeatedByTileId: hardOwner?.tileId ?? null,
          scoreDelta:
            hardOwner != null ? hardOwner.score - node.candidate.score : null,
          competingTokenPositions: hardOwnerId
            ? competingTokenPositions(graph, node.candidate, hardOwnerId)
            : spanTokenPositions(node.candidate.span),
        }),
      );
      continue;
    }
    eligible.push(node.candidate);
  }

  const prefixPass = suppressLiteralPrefixCandidates(eligible);
  const suppressed: SuppressedCandidate[] = [...prefixPass.suppressed];

  const sorted = [...prefixPass.kept].sort(compareCandidatePriority);
  const winners: WinnerDecision[] = [];
  const assignedTiles = new Set<string>();
  const assignedTokens = new Set<number>();

  logPlacementOrder([
    `[PLACEMENT-ORDER] 3. resolveVoiceCandidates() — sorted candidates (priority order)`,
    ...sorted.map(
      (row, index) =>
        `${index}. tileId=${row.tileId} span=${row.span.start}-${row.span.end} score=${row.score} reason=${row.acceptReason}`,
    ),
  ]);

  for (const candidate of sorted) {
    if (assignedTiles.has(candidate.tileId)) {
      suppressed.push(
        toSuppressed(candidate, {
          suppressionReason: "TILE_ALREADY_ASSIGNED",
          defeatedByCandidateId: null,
          defeatedByTileId: null,
          scoreDelta: null,
          competingTokenPositions: [],
        }),
      );
      continue;
    }

    const positions = spanTokenPositions(candidate.span);
    const overlapsAssigned = positions.some((position) =>
      assignedTokens.has(position),
    );
    if (overlapsAssigned) {
      const blockingWinner = winners.find((winner) =>
        spansOverlap(winner.span, candidate.span),
      );
      suppressed.push(
        toSuppressed(candidate, {
          suppressionReason: blockingWinner
            ? suppressionReasonFor(candidate, {
                candidateId: blockingWinner.candidateId,
                tileId: blockingWinner.tileId,
                span: blockingWinner.span,
                evidenceTier: blockingWinner.evidenceTier,
                tierLabel: blockingWinner.tierLabel,
                acceptReason: blockingWinner.acceptReason,
                score: blockingWinner.score,
                scoreComponents: { tierWeight: 0, featureScore: 0 },
              })
            : "MUTUAL_EXCLUSION",
          defeatedByCandidateId: blockingWinner?.candidateId ?? null,
          defeatedByTileId: blockingWinner?.tileId ?? null,
          scoreDelta:
            blockingWinner != null
              ? blockingWinner.score - candidate.score
              : null,
          competingTokenPositions: blockingWinner
            ? competingTokenPositions(
                graph,
                candidate,
                blockingWinner.candidateId,
              )
            : positions.filter((position) => assignedTokens.has(position)),
        }),
      );
      continue;
    }

    const defeatedIds: string[] = [];
    for (const other of sorted) {
      if (other.candidateId === candidate.candidateId) continue;
      if (!spansOverlap(other.span, candidate.span)) continue;
      if (
        compareCandidatePriority(candidate, other) <= 0 &&
        other.score <= candidate.score
      ) {
        defeatedIds.push(other.candidateId);
      }
    }

    const nearestRival = sorted
      .filter(
        (other) =>
          other.candidateId !== candidate.candidateId &&
          spansOverlap(other.span, candidate.span),
      )
      .sort((left, right) => compareCandidatePriority(right, left))[0];

    const margin =
      nearestRival != null ? candidate.score - nearestRival.score : candidate.score;

    const winner: WinnerDecision = {
      candidateId: candidate.candidateId,
      tileId: candidate.tileId,
      span: candidate.span,
      evidenceTier: candidate.evidenceTier,
      tierLabel: candidate.tierLabel,
      acceptReason: candidate.acceptReason,
      score: candidate.score,
      margin,
      defeatedCandidateIds: defeatedIds,
    };
    winners.push(winner);
    assignedTiles.add(candidate.tileId);
    for (const position of positions) {
      assignedTokens.add(position);
    }
  }

  winners.sort((left, right) => {
    const startDiff = left.span.start - right.span.start;
    if (startDiff !== 0) return startDiff;
    const lenDiff = spanLength(right.span) - spanLength(left.span);
    if (lenDiff !== 0) return lenDiff;
    return 0;
  });

  logPlacementOrder([
    `[PLACEMENT-ORDER] 3. resolveVoiceCandidates() — winners (after span.start sort)`,
    ...winners.map(
      (row, index) =>
        `${index}. tileId=${row.tileId} span=${row.span.start}-${row.span.end} score=${row.score} reason=${row.acceptReason}`,
    ),
    ``,
    `[PLACEMENT-ORDER] 3. resolveVoiceCandidates() — suppressed`,
    ...suppressed.map(
      (row, index) =>
        `${index}. tileId=${row.tileId} span=${row.span.start}-${row.span.end} reason=${row.suppressionReason}`,
    ),
  ]);

  const noOverlappingWinners = winners.every((left, leftIndex) =>
    winners.every((right, rightIndex) => {
      if (leftIndex >= rightIndex) return true;
      return !spansOverlap(left.span, right.span);
    }),
  );
  const oneTilePerWinner =
    winners.length === new Set(winners.map((winner) => winner.tileId)).size;

  return {
    passId: input.passId ?? `resolve:${commitmentLevel}`,
    commitmentLevel,
    winners,
    suppressed,
    ineligible,
    invariantChecks: {
      noOverlappingWinners,
      oneTilePerWinner,
    },
  };
}

export function winnersToCandidateIds(winners: readonly WinnerDecision[]): string[] {
  return winners.map((winner) => winner.candidateId);
}

export function candidateFromWinner(
  candidates: readonly VoiceCandidate[],
  winner: WinnerDecision,
): VoiceCandidate | undefined {
  return candidates.find((row) => row.candidateId === winner.candidateId);
}

export function makeVoiceCandidate(input: {
  tileId: string;
  span: { start: number; end: number };
  acceptReason: VoiceCandidate["acceptReason"];
  evidenceTier: VoiceCandidate["evidenceTier"];
  tierLabel: VoiceCandidate["tierLabel"];
  score: number;
  scoreComponents: VoiceCandidate["scoreComponents"];
}): VoiceCandidate {
  return {
    candidateId: candidateIdFor(input.tileId, input.span),
    tileId: input.tileId,
    span: input.span,
    evidenceTier: input.evidenceTier,
    tierLabel: input.tierLabel,
    acceptReason: input.acceptReason,
    score: input.score,
    scoreComponents: input.scoreComponents,
  };
}
