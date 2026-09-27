import type { PhraseKnowledgeEntry, Observation } from "./phraseKnowledgeBase/types";
import {
  KNOWLEDGE_MIN_TOKEN_OVERLAP,
  type ResolvedVoiceMatchingConfig,
} from "./voiceMatchingConfig";
import { isContainedSingleTokenFuzzyMatch } from "./containedFuzzyMatch";
import {
  scorePhraseSimilarity,
  type PhraseSimilarityCandidate,
} from "./phraseSimilarityEngine";
import { normalizeToken, tokenizeTileText } from "./textUtils";
import type {
  AcceptedTile,
  GateResult,
  MatchedSpan,
  RejectionReason,
  SpeechWindow,
  VoiceTile,
} from "./types";

export type KnowledgeWindowCandidate = {
  window: SpeechWindow;
  similarity: number;
  tokenOverlap: number;
};

export type DecisionAnalyticsMetadata = Record<string, never>;

export type DecisionEngineInput = {
  tile: VoiceTile;
  pronunciationResult: GateResult;
  pronunciationScore: number | null;
  phraseSimilarityResult: PhraseSimilarityCandidate | null;
  phraseKnowledge: PhraseKnowledgeEntry | null;
  knowledgeCandidate: KnowledgeWindowCandidate | null;
  analyticsMetadata?: DecisionAnalyticsMetadata;
  config: ResolvedVoiceMatchingConfig;
  fallbackReason: RejectionReason;
};

export type DecisionAcceptReason = "PHRASE_SIMILARITY" | "PHRASE_KNOWLEDGE";

export type DecisionEngineDebugReport = {
  expected: string;
  observed: string;
  similarity: number | null;
  knowledgeObservations: string[];
  pronunciationScore: number | null;
  decision: "accept" | "reject";
  reason: DecisionAcceptReason | RejectionReason;
};

export type DecisionEngineResult =
  | {
      accepted: true;
      span: MatchedSpan;
      reason: DecisionAcceptReason;
      debug: DecisionEngineDebugReport;
    }
  | {
      accepted: false;
      reason: RejectionReason;
      debug: DecisionEngineDebugReport;
    };

type KnowledgeMatchTarget = {
  phrase: string;
  confidence: number;
  observation: Observation | null;
};

type KnowledgeMatchScore = {
  phrase: string;
  similarity: number;
  confidence: number;
  weightedConfidence: number;
  observation: Observation | null;
};

function minKnowledgeTokenOverlap(tileTokenCount: number): number {
  return Math.min(KNOWLEDGE_MIN_TOKEN_OVERLAP, tileTokenCount);
}

function countTokenOverlap(
  tileTokens: readonly string[],
  windowTokens: readonly string[],
): number {
  const tileNorm = new Set(
    tileTokens.map((token) => normalizeToken(token)).filter(Boolean),
  );
  const overlapping = new Set<string>();

  for (const token of windowTokens) {
    const norm = normalizeToken(token);
    if (!norm || overlapping.has(norm)) continue;
    if (tileNorm.has(norm)) {
      overlapping.add(norm);
    }
  }

  return overlapping.size;
}

function phrasePlacementDebugEnabled(): boolean {
  return (
    process.env.VOICE_MATCH_DEBUG === "1" ||
    process.env.NEXT_PUBLIC_STT_FALLBACK_DEBUG === "1"
  );
}

function logPhrasePlacementDecision(input: {
  stage: string;
  tileText: string;
  tileTokenCount: number;
  windowTokens: readonly string[];
  tokenOverlap: number;
  similarity: number | null;
  coversTile: boolean;
  reason: string;
}): void {
  if (!phrasePlacementDebugEnabled()) return;
  if (input.tileTokenCount < 2) return;
}

function knowledgeMatchTargets(entry: PhraseKnowledgeEntry): KnowledgeMatchTarget[] {
  return [
    { phrase: entry.expectedPhrase, confidence: 1.0, observation: null },
    ...entry.observations.map((observation) => ({
      phrase: observation.observedPhrase,
      confidence: observation.confidence,
      observation,
    })),
  ];
}

function bestKnowledgeSimilarity(
  entry: PhraseKnowledgeEntry,
  spokenTokens: readonly string[],
): number {
  const observedPhrase = spokenTokens.join(" ");
  let best = 0;

  for (const target of knowledgeMatchTargets(entry)) {
    const { similarity } = scorePhraseSimilarity(target.phrase, observedPhrase);
    if (similarity > best) best = similarity;
  }

  return best;
}

function countKnowledgeTokenOverlap(
  entry: PhraseKnowledgeEntry,
  windowTokens: readonly string[],
): number {
  let best = 0;
  for (const target of knowledgeMatchTargets(entry)) {
    const targetTokens = tokenizeTileText(target.phrase);
    const overlap = countTokenOverlap(targetTokens, windowTokens);
    if (overlap > best) best = overlap;
  }
  return best;
}

/** Prepare the best knowledge window during the matcher loop — no acceptance. */
export function prepareKnowledgeWindowCandidate(input: {
  phraseKnowledge: PhraseKnowledgeEntry;
  tileTokens: readonly string[];
  window: SpeechWindow;
  currentBest: KnowledgeWindowCandidate | null;
}): KnowledgeWindowCandidate | null {
  const minOverlap = minKnowledgeTokenOverlap(input.tileTokens.length);
  const tokenOverlap = countKnowledgeTokenOverlap(
    input.phraseKnowledge,
    input.window.tokens,
  );
  if (tokenOverlap < minOverlap) return input.currentBest;

  const similarity = bestKnowledgeSimilarity(
    input.phraseKnowledge,
    input.window.tokens,
  );

  if (!input.currentBest || similarity > input.currentBest.similarity) {
    return {
      window: input.window,
      similarity,
      tokenOverlap,
    };
  }

  return input.currentBest;
}

function scoreKnowledgeMatches(
  entry: PhraseKnowledgeEntry,
  spokenTokens: readonly string[],
): KnowledgeMatchScore[] {
  const observedPhrase = spokenTokens.join(" ");

  return knowledgeMatchTargets(entry).map((target) => {
    const { similarity } = scorePhraseSimilarity(target.phrase, observedPhrase);
    return {
      phrase: target.phrase,
      similarity,
      confidence: target.confidence,
      weightedConfidence: similarity * target.confidence,
      observation: target.observation,
    };
  });
}

function selectKnowledgeMatch(input: {
  entry: PhraseKnowledgeEntry;
  candidate: KnowledgeWindowCandidate;
  threshold: number;
}): { match: KnowledgeMatchScore; observationsUsed: string[] } | null {
  const minOverlap = minKnowledgeTokenOverlap(
    tokenizeTileText(input.entry.expectedPhrase).length,
  );
  const scores = scoreKnowledgeMatches(
    input.entry,
    input.candidate.window.tokens,
  );

  let best: KnowledgeMatchScore | null = null;
  for (const score of scores) {
    if (score.weightedConfidence < input.threshold) continue;

    const overlap = countTokenOverlap(
      tokenizeTileText(score.phrase),
      input.candidate.window.tokens,
    );
    if (overlap < minOverlap) continue;

    if (!best || score.weightedConfidence > best.weightedConfidence) {
      best = score;
    }
  }

  if (!best) return null;

  const observationsUsed = best.observation
    ? [best.observation.observedPhrase]
    : [input.entry.expectedPhrase];

  return { match: best, observationsUsed };
}

function buildDebugReport(input: {
  expected: string;
  observed: string;
  similarity: number | null;
  knowledgeObservations: string[];
  pronunciationScore: number | null;
  accepted: boolean;
  reason: DecisionAcceptReason | RejectionReason;
}): DecisionEngineDebugReport {
  return {
    expected: input.expected,
    observed: input.observed,
    similarity: input.similarity,
    knowledgeObservations: input.knowledgeObservations,
    pronunciationScore: input.pronunciationScore,
    decision: input.accepted ? "accept" : "reject",
    reason: input.reason,
  };
}

/**
 * Single decision point for post-gate tile acceptance.
 */
export function decideTileAcceptance(
  input: DecisionEngineInput,
): DecisionEngineResult {
  const {
    tile,
    pronunciationScore,
    phraseSimilarityResult,
    phraseKnowledge,
    knowledgeCandidate,
    config,
    fallbackReason,
  } = input;

  const observedFromSimilarity =
    phraseSimilarityResult?.diagnostics.observedPhrase ?? "";
  const observedFromKnowledge =
    knowledgeCandidate?.window.tokens.join(" ") ?? "";
  const observed = observedFromSimilarity || observedFromKnowledge;

  const tileTokenCount = tokenizeTileText(tile.text).length;
  const phraseSimilarityWindowCount =
    phraseSimilarityResult?.window.tokens.length ?? 0;
  const phraseSimilarityTokenOverlap =
    phraseSimilarityResult != null
      ? countTokenOverlap(
          tokenizeTileText(tile.text),
          phraseSimilarityResult.window.tokens,
        )
      : 0;
  // Phrase rescue requires a window at least as long as the tile. A shorter
  // window (e.g. spoken "you" vs tile "do you") can score high phonetically
  // on a suffix, but must never become a candidate — otherwise it steals the
  // standalone "you" tile. Never treat "overlap covers the window" as enough.
  const phraseSimilarityCoversTile =
    phraseSimilarityWindowCount >= tileTokenCount;

  const expectedNorm = normalizeToken(tile.text);
  const observedNorm = normalizeToken(observedFromSimilarity);
  // Tiny tiles ("I", "a", "to"): phonetic similarity happily maps "I"→"it".
  // Only exact lexical identity may accept via phrase similarity.
  const shortSingletonBlocksFuzzy =
    tileTokenCount === 1 &&
    expectedNorm.length <= 2 &&
    observedNorm !== expectedNorm;

  // "mouse" inside "famous": every tile phoneme matched exactly and the spoken
  // word just has more sound. Containment is not evidence the user said the tile.
  const containedInLongerSpokenWord =
    phraseSimilarityResult != null &&
    isContainedSingleTokenFuzzyMatch({
      tileTokenCount,
      expectedPhonemes: phraseSimilarityResult.diagnostics.expectedPhonemes,
      observedPhonemes: phraseSimilarityResult.diagnostics.observedPhonemes,
    });

  if (
    phraseSimilarityResult &&
    phraseSimilarityCoversTile &&
    phraseSimilarityResult.similarity >= config.phraseSimilarityThreshold &&
    !shortSingletonBlocksFuzzy &&
    !containedInLongerSpokenWord
  ) {
    logPhrasePlacementDecision({
      stage: "accept",
      tileText: tile.text,
      tileTokenCount,
      windowTokens: phraseSimilarityResult.window.tokens,
      tokenOverlap: phraseSimilarityTokenOverlap,
      similarity: phraseSimilarityResult.similarity,
      coversTile: phraseSimilarityCoversTile,
      reason: "PHRASE_SIMILARITY",
    });
    const debug = buildDebugReport({
      expected: tile.text,
      observed: phraseSimilarityResult.diagnostics.observedPhrase,
      similarity: phraseSimilarityResult.similarity,
      knowledgeObservations: [],
      pronunciationScore,
      accepted: true,
      reason: "PHRASE_SIMILARITY",
    });
    return {
      accepted: true,
      span: {
        start: phraseSimilarityResult.window.start,
        end: phraseSimilarityResult.window.end,
      },
      reason: "PHRASE_SIMILARITY",
      debug,
    };
  }

  if (
    phraseSimilarityResult &&
    tileTokenCount >= 2 &&
    !phraseSimilarityCoversTile
  ) {
    logPhrasePlacementDecision({
      stage: "reject-short-window",
      tileText: tile.text,
      tileTokenCount,
      windowTokens: phraseSimilarityResult.window.tokens,
      tokenOverlap: phraseSimilarityTokenOverlap,
      similarity: phraseSimilarityResult.similarity,
      coversTile: phraseSimilarityCoversTile,
      reason: "INSUFFICIENT_EVIDENCE",
    });
  }

  if (phraseKnowledge && knowledgeCandidate) {
    const knowledgeDecision = selectKnowledgeMatch({
      entry: phraseKnowledge,
      candidate: knowledgeCandidate,
      threshold: config.phraseKnowledgeThreshold,
    });

    if (knowledgeDecision) {
      const debug = buildDebugReport({
        expected: tile.text,
        observed: knowledgeCandidate.window.tokens.join(" "),
        similarity: knowledgeDecision.match.similarity,
        knowledgeObservations: knowledgeDecision.observationsUsed,
        pronunciationScore,
        accepted: true,
        reason: "PHRASE_KNOWLEDGE",
      });
      return {
        accepted: true,
        span: {
          start: knowledgeCandidate.window.start,
          end: knowledgeCandidate.window.end,
        },
        reason: "PHRASE_KNOWLEDGE",
        debug,
      };
    }
  }

  const debug = buildDebugReport({
    expected: tile.text,
    observed,
    similarity: phraseSimilarityResult?.similarity ?? null,
    knowledgeObservations: [],
    pronunciationScore,
    accepted: false,
    reason: fallbackReason,
  });
  return {
    accepted: false,
    reason: fallbackReason,
    debug,
  };
}

export function decisionResultToEvaluateTile(
  tileId: string,
  decision: DecisionEngineResult,
):
  | { accepted: AcceptedTile }
  | { rejected: { tileId: string; reason: RejectionReason } } {
  if (decision.accepted) {
    return {
      accepted: {
        tileId,
        span: decision.span,
        acceptReason: decision.reason,
      },
    };
  }

  return {
    rejected: {
      tileId,
      reason: decision.reason,
    },
  };
}

/** Feature score for resolver ranking when knowledge accepts. */
export function knowledgeFeatureScoreFromDecision(
  decision: DecisionEngineResult,
): number | null {
  if (!decision.accepted || decision.reason !== "PHRASE_KNOWLEDGE") return null;
  return decision.debug.similarity ?? null;
}
