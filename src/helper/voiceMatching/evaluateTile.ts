import { alignTileToWindow, validateAlignment } from "./alignmentValidation";
import {
  decideTileAcceptance,
  prepareKnowledgeWindowCandidate,
  type KnowledgeWindowCandidate,
} from "./decisionEngine";
import type { PhraseKnowledgeEntry } from "./phraseKnowledgeBase/types";
import {
  validateEvidence,
  validateSpeechSpanForShortTile,
} from "./evidenceValidation";
import {
  collectPhraseSimilarityCandidate,
  type PhraseSimilarityCandidate,
} from "./phraseSimilarityEngine";
import { validatePronunciation } from "./pronunciationValidation";
import { logCandidateRejection } from "./placementPipelineTrace";
import { windowBlockedByConsumedSpan } from "./spans";
import { tokenizeTileText } from "./textUtils";
import { buildCandidateScoring, gateMatchEvidenceTier } from "./evidenceTier";
import { makeVoiceCandidate } from "./resolver";
import type { VoiceCandidate } from "./candidateTypes";
import {
  knowledgeFeatureScoreFromDecision,
} from "./decisionEngine";
import type {
  AlignmentResult,
  ConsumedSpan,
  GateResult,
  RecentSpeechSlice,
  RejectedTile,
  RejectionReason,
  SpeechWindow,
} from "./types";
import type { ResolvedVoiceMatchingConfig } from "./voiceMatchingConfig";
import { generateSlidingWindows, tileTokenCountFromText } from "./windows";
import { scoreTokenPhoneticDistance } from "@/helper/speech/phoneticDistance";
import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import { findFreeLiteralSpan } from "@/helper/puzzel/sessionPlacementState";

export type EvaluateTileResult =
  | { candidate: VoiceCandidate }
  | { rejected: RejectedTile };

function minAlignmentPronunciationScore(
  alignment: AlignmentResult,
): number | null {
  if (alignment.alignments.length === 0) return null;

  let minScore = 1;
  for (const row of alignment.alignments) {
    const similarity = scoreTokenPhoneticDistance(
      row.expected,
      row.spoken,
    ).similarity;
    if (similarity < minScore) minScore = similarity;
  }

  return minScore;
}

function collectPostGateCandidates(input: {
  tileText: string;
  tileTokens: readonly string[];
  window: SpeechWindow;
  phraseKnowledge: PhraseKnowledgeEntry | null;
  alignment: AlignmentResult | null;
  bestPhraseSimilarity: PhraseSimilarityCandidate | null;
  bestKnowledgeWindow: KnowledgeWindowCandidate | null;
  bestPronunciationScore: number | null;
}): {
  bestPhraseSimilarity: PhraseSimilarityCandidate | null;
  bestKnowledgeWindow: KnowledgeWindowCandidate | null;
  bestPronunciationScore: number | null;
} {
  const bestPhraseSimilarity = collectPhraseSimilarityCandidate({
    expectedPhrase: input.tileText,
    window: input.window,
    currentBest: input.bestPhraseSimilarity,
  });

  let bestKnowledgeWindow = input.bestKnowledgeWindow;
  if (input.phraseKnowledge) {
    bestKnowledgeWindow = prepareKnowledgeWindowCandidate({
      phraseKnowledge: input.phraseKnowledge,
      tileTokens: input.tileTokens,
      window: input.window,
      currentBest: input.bestKnowledgeWindow,
    });
  }

  let bestPronunciationScore = input.bestPronunciationScore;
  if (input.alignment) {
    const score = minAlignmentPronunciationScore(input.alignment);
    if (
      score !== null &&
      (bestPronunciationScore === null || score > bestPronunciationScore)
    ) {
      bestPronunciationScore = score;
    }
  }

  return { bestPhraseSimilarity, bestKnowledgeWindow, bestPronunciationScore };
}

export function evaluateTile(
  tileId: string,
  tileText: string,
  recentSpeech: RecentSpeechSlice,
  consumedSpans: readonly ConsumedSpan[],
  config: ResolvedVoiceMatchingConfig,
  phraseKnowledge: PhraseKnowledgeEntry | null,
  tokenMatchLexicon?: VoiceMatchLexicon,
): EvaluateTileResult {
  const tileTokens = tokenizeTileText(tileText);
  const tileLength = tileTokenCountFromText(tileText);

  const consumed = new Set<number>();
  for (const span of consumedSpans) {
    for (let index = span.start; index <= span.end; index++) {
      consumed.add(index);
    }
  }
  const exactLiteralSpan = findFreeLiteralSpan(
    recentSpeech.tokens,
    tileTokens,
    0,
    consumed,
  );
  if (exactLiteralSpan) {
    const span = {
      start: exactLiteralSpan.start + recentSpeech.startOffset,
      end: exactLiteralSpan.end + recentSpeech.startOffset,
    };
    const gateTier = gateMatchEvidenceTier({
      tileText,
      windowTokens: recentSpeech.tokens.slice(
        exactLiteralSpan.start,
        exactLiteralSpan.end + 1,
      ),
      allEvidenceExact: true,
    });
    const scoring = buildCandidateScoring({
      acceptReason: "GATE_MATCH",
      gateMatchTier: gateTier,
      pronunciationScore: 1,
    });
    const candidate = makeVoiceCandidate({
      tileId,
      span,
      acceptReason: "GATE_MATCH",
      evidenceTier: scoring.evidenceTier,
      tierLabel: scoring.tierLabel,
      score: scoring.score,
      scoreComponents: scoring.scoreComponents,
    });
    return { candidate };
  }

  const windows = generateSlidingWindows(
    recentSpeech.tokens,
    tileLength,
    recentSpeech.startOffset,
  );

  let bestPhraseSimilarity: PhraseSimilarityCandidate | null = null;
  let bestKnowledgeWindow: KnowledgeWindowCandidate | null = null;
  let bestPronunciationScore: number | null = null;

  let bestReason: RejectionReason = "NO_WINDOW";
  let lastPronunciationResult: GateResult = {
    pass: false,
    reason: "LOW_PRONUNCIATION",
  };

  for (const window of windows) {
    const consumedCheck = windowBlockedByConsumedSpan(
      window,
      consumedSpans,
      tileLength,
    );
    if (consumedCheck.blocked) {
      bestReason = "OVERLAP_CONSUMED";
      logCandidateRejection({
        candidate: tileText,
        tileId,
        reason: "OVERLAP_CONSUMED",
        functionName: "evaluateTile / windowBlockedByConsumedSpan",
        condition: "spansOverlap(window, consumedSpan) — hard reservation",
        window: {
          start: window.start,
          end: window.end,
          tokens: window.tokens,
        },
        consumedSpans,
      });
      continue;
    }

    const spanGate = validateSpeechSpanForShortTile(tileTokens, window.tokens);
    if (!spanGate.pass) {
      bestReason = spanGate.reason;
      continue;
    }

    const evidenceGate = validateEvidence(tileTokens, window.tokens, tokenMatchLexicon);
    if (!evidenceGate.pass) {
      ({ bestPhraseSimilarity, bestKnowledgeWindow, bestPronunciationScore } =
        collectPostGateCandidates({
          tileText,
          tileTokens,
          window,
          phraseKnowledge,
          alignment: null,
          bestPhraseSimilarity,
          bestKnowledgeWindow,
          bestPronunciationScore,
        }));
      bestReason = evidenceGate.reason;
      continue;
    }

    const alignment = alignTileToWindow(tileTokens, window.tokens, tokenMatchLexicon);
    const alignmentGate = validateAlignment(alignment);
    if (!alignmentGate.pass) {
      ({ bestPhraseSimilarity, bestKnowledgeWindow, bestPronunciationScore } =
        collectPostGateCandidates({
          tileText,
          tileTokens,
          window,
          phraseKnowledge,
          alignment,
          bestPhraseSimilarity,
          bestKnowledgeWindow,
          bestPronunciationScore,
        }));
      bestReason = alignmentGate.reason;
      continue;
    }

    const pronunciationGate = validatePronunciation(alignment);
    lastPronunciationResult = pronunciationGate;

    if (!pronunciationGate.pass) {
      ({ bestPhraseSimilarity, bestKnowledgeWindow, bestPronunciationScore } =
        collectPostGateCandidates({
          tileText,
          tileTokens,
          window,
          phraseKnowledge,
          alignment,
          bestPhraseSimilarity,
          bestKnowledgeWindow,
          bestPronunciationScore,
        }));
      bestReason = pronunciationGate.reason;
      continue;
    }

    // Never GATE_MATCH on a window shorter than the tile (adaptive windows
    // can be tileLength-1). Incomplete phrase hits must not steal single tokens.
    if (window.tokens.length < tileLength) {
      ({ bestPhraseSimilarity, bestKnowledgeWindow, bestPronunciationScore } =
        collectPostGateCandidates({
          tileText,
          tileTokens,
          window,
          phraseKnowledge,
          alignment,
          bestPhraseSimilarity,
          bestKnowledgeWindow,
          bestPronunciationScore,
        }));
      bestReason = "INSUFFICIENT_EVIDENCE";
      continue;
    }

    const gateTier = gateMatchEvidenceTier({
      tileText,
      windowTokens: window.tokens,
      allEvidenceExact: true,
    });
    const scoring = buildCandidateScoring({
      acceptReason: "GATE_MATCH",
      gateMatchTier: gateTier,
      pronunciationScore: minAlignmentPronunciationScore(alignment),
    });
    const candidate = makeVoiceCandidate({
      tileId,
      span: { start: window.start, end: window.end },
      acceptReason: "GATE_MATCH",
      evidenceTier: scoring.evidenceTier,
      tierLabel: scoring.tierLabel,
      score: scoring.score,
      scoreComponents: scoring.scoreComponents,
    });
    return { candidate };
  }

  const decision = decideTileAcceptance({
    tile: { id: tileId, text: tileText },
    pronunciationResult: lastPronunciationResult,
    pronunciationScore: bestPronunciationScore,
    phraseSimilarityResult: bestPhraseSimilarity,
    phraseKnowledge,
    knowledgeCandidate: bestKnowledgeWindow,
    config,
    fallbackReason: bestReason,
  });

  if (!decision.accepted) {
    logCandidateRejection({
      candidate: tileText,
      tileId,
      reason: decision.reason,
      functionName: "evaluateTile / decideTileAcceptance",
      condition: `fallbackReason=${bestReason}; decision engine did not rescue`,
    });
    if (bestReason === "INSUFFICIENT_EVIDENCE" && windows.every((w) => w.tokens.length < tileLength)) {
      logCandidateRejection({
        candidate: tileText,
        tileId,
        reason: "INSUFFICIENT_EVIDENCE",
        functionName: "evaluateTile / generateSlidingWindows",
        condition: `no sliding window length >= tileLength (${tileLength}); maxWindow=${Math.max(0, ...windows.map((w) => w.tokens.length))}`,
      });
    }
    return {
      rejected: {
        tileId,
        reason: decision.reason,
      },
    };
  }

  const scoring = buildCandidateScoring({
    acceptReason: decision.reason,
    phraseSimilarity: bestPhraseSimilarity,
    knowledgeCandidate: bestKnowledgeWindow,
    knowledgeWeightedConfidence:
      knowledgeFeatureScoreFromDecision(decision) ?? undefined,
    pronunciationScore: bestPronunciationScore,
  });

  const candidate = makeVoiceCandidate({
    tileId,
    span: decision.span,
    acceptReason: decision.reason,
    evidenceTier: scoring.evidenceTier,
    tierLabel: scoring.tierLabel,
    score: scoring.score,
    scoreComponents: scoring.scoreComponents,
  });
  return { candidate };
}
