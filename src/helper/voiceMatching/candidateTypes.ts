import type { MatchedSpan, PlacementCommitmentLevel } from "./types";

/** Evidence hierarchy — lower numeric value = stronger (T1 strongest). */
export type EvidenceTier = 1 | 2 | 3 | 4 | 5;

export type EvidenceTierLabel =
  | "T1_EXACT_LEXICAL"
  | "T2_VALIDATED_VARIANT"
  | "T3_ADAPTIVE_KNOWLEDGE"
  | "T4_PHRASE_SIMILARITY"
  | "T5_PRONUNCIATION_RESCUE";

export type CandidateAcceptReason =
  | "GATE_MATCH"
  | "PHRASE_SIMILARITY"
  | "PHRASE_KNOWLEDGE";

export type VoiceCandidate = {
  /** Stable id for graph nodes and replay (`tileId:start:end`). */
  candidateId: string;
  tileId: string;
  span: MatchedSpan;
  evidenceTier: EvidenceTier;
  tierLabel: EvidenceTierLabel;
  /** Legacy accept reason — mirrors evidence source for explainability. */
  acceptReason: CandidateAcceptReason;
  /** Composite ranking score (tier-weighted). */
  score: number;
  scoreComponents: {
    tierWeight: number;
    featureScore: number;
  };
};

export type SuppressionReason =
  | "LOST_TO_HIGHER_TIER"
  | "LOST_TO_HIGHER_SCORE"
  | "HARD_OWNERSHIP_BLOCKED"
  | "STICKY_LOCK_BLOCKED"
  | "LITERAL_SLOT_TAKEN"
  | "LITERAL_PREFIX_SUBSUMED"
  | "MUTUAL_EXCLUSION"
  | "TILE_ALREADY_ASSIGNED"
  | "DEFERRED_BY_POLICY";

export type SuppressedCandidate = {
  candidateId: string;
  tileId: string;
  span: MatchedSpan;
  evidenceTier: EvidenceTier;
  tierLabel: EvidenceTierLabel;
  acceptReason: CandidateAcceptReason;
  score: number;
  suppressionReason: SuppressionReason;
  defeatedByCandidateId: string | null;
  defeatedByTileId: string | null;
  scoreDelta: number | null;
  competingTokenPositions: number[];
};

export type WinnerDecision = {
  candidateId: string;
  tileId: string;
  span: MatchedSpan;
  evidenceTier: EvidenceTier;
  tierLabel: EvidenceTierLabel;
  acceptReason: CandidateAcceptReason;
  score: number;
  margin: number;
  defeatedCandidateIds: string[];
};

export type ResolutionPassResult = {
  passId: string;
  commitmentLevel: PlacementCommitmentLevel;
  winners: WinnerDecision[];
  suppressed: SuppressedCandidate[];
  ineligible: SuppressedCandidate[];
  invariantChecks: {
    noOverlappingWinners: boolean;
    oneTilePerWinner: boolean;
  };
};

export function candidateIdFor(tileId: string, span: MatchedSpan): string {
  return `${tileId}:${span.start}:${span.end}`;
}

export function tierLabelFor(tier: EvidenceTier): EvidenceTierLabel {
  switch (tier) {
    case 1:
      return "T1_EXACT_LEXICAL";
    case 2:
      return "T2_VALIDATED_VARIANT";
    case 3:
      return "T3_ADAPTIVE_KNOWLEDGE";
    case 4:
      return "T4_PHRASE_SIMILARITY";
    case 5:
      return "T5_PRONUNCIATION_RESCUE";
  }
}

export function isHardEvidenceTier(tier: EvidenceTier): boolean {
  return tier === 1 || tier === 2;
}

export function tierWeight(tier: EvidenceTier): number {
  switch (tier) {
    case 1:
      return 1000;
    case 2:
      return 900;
    case 3:
      return 500;
    case 4:
      return 300;
    case 5:
      return 100;
  }
}
