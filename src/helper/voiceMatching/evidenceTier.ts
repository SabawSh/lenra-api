import type { CandidateAcceptReason } from "./candidateTypes";
import {
  type EvidenceTier,
  tierLabelFor,
  tierWeight,
} from "./candidateTypes";
import type { PhraseSimilarityCandidate } from "./phraseSimilarityEngine";
import type { KnowledgeWindowCandidate } from "./decisionEngine";
import { normalizeToken, tokenizeTileText } from "./textUtils";

export function gateMatchEvidenceTier(input: {
  tileText: string;
  windowTokens: readonly string[];
  allEvidenceExact: boolean;
}): EvidenceTier {
  const expected = tokenizeTileText(input.tileText);
  const spoken = input.windowTokens.map((token) => normalizeToken(token));
  if (
    expected.length === spoken.length &&
    expected.every((token, index) => token === spoken[index])
  ) {
    return 1;
  }
  return input.allEvidenceExact ? 1 : 2;
}

export function tierFromAcceptReason(
  acceptReason: CandidateAcceptReason,
  gateMatchTier?: EvidenceTier,
): EvidenceTier {
  switch (acceptReason) {
    case "GATE_MATCH":
      return gateMatchTier ?? 2;
    case "PHRASE_KNOWLEDGE":
      return 3;
    case "PHRASE_SIMILARITY":
      return 4;
  }
}

export function featureScoreFromPhraseSimilarity(
  candidate: PhraseSimilarityCandidate | null,
): number {
  return candidate?.similarity ?? 0;
}

export function featureScoreFromKnowledge(
  candidate: KnowledgeWindowCandidate | null,
  weightedConfidence?: number,
): number {
  if (weightedConfidence != null) return weightedConfidence;
  return candidate?.similarity ?? 0;
}

export function compositeCandidateScore(
  tier: EvidenceTier,
  featureScore: number,
): { score: number; tierWeight: number; featureScore: number } {
  const weight = tierWeight(tier);
  const feature = Math.max(0, Math.min(1, featureScore));
  return {
    score: weight + feature,
    tierWeight: weight,
    featureScore: feature,
  };
}

export function buildCandidateScoring(input: {
  acceptReason: CandidateAcceptReason;
  gateMatchTier?: EvidenceTier;
  phraseSimilarity?: PhraseSimilarityCandidate | null;
  knowledgeCandidate?: KnowledgeWindowCandidate | null;
  knowledgeWeightedConfidence?: number;
  pronunciationScore?: number | null;
}): {
  evidenceTier: EvidenceTier;
  tierLabel: ReturnType<typeof tierLabelFor>;
  score: number;
  scoreComponents: { tierWeight: number; featureScore: number };
} {
  const evidenceTier = tierFromAcceptReason(
    input.acceptReason,
    input.gateMatchTier,
  );

  let featureScore = 0;
  if (input.acceptReason === "PHRASE_SIMILARITY") {
    featureScore = featureScoreFromPhraseSimilarity(input.phraseSimilarity);
  } else if (input.acceptReason === "PHRASE_KNOWLEDGE") {
    featureScore = featureScoreFromKnowledge(
      input.knowledgeCandidate,
      input.knowledgeWeightedConfidence,
    );
  } else if (input.pronunciationScore != null) {
    featureScore = input.pronunciationScore;
  } else {
    featureScore = 1;
  }

  const composite = compositeCandidateScore(evidenceTier, featureScore);
  return {
    evidenceTier,
    tierLabel: tierLabelFor(evidenceTier),
    score: composite.score,
    scoreComponents: {
      tierWeight: composite.tierWeight,
      featureScore: composite.featureScore,
    },
  };
}
