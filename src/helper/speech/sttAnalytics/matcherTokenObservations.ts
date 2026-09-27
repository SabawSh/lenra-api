import { alignTileToWindow, validateAlignment } from "@/helper/voiceMatching/alignmentValidation";
import { validateEvidence } from "@/helper/voiceMatching/evidenceValidation";
import { getRecentSpeechTokens } from "@/helper/voiceMatching/recentWindow";
import { windowOverlapsConsumedSpan } from "@/helper/voiceMatching/spans";
import { tokenizeTileText } from "@/helper/voiceMatching/textUtils";
import type {
  AcceptedTile,
  AlignmentResult,
  ConsumedSpan,
  MatchVoiceTilesResult,
  RejectionReason,
} from "@/helper/voiceMatching/types";
import { validatePronunciation } from "@/helper/voiceMatching/pronunciationValidation";
import { DEFAULT_MAX_RECENT_TOKENS } from "@/helper/voiceMatching/voiceMatchingConfig";
import {
  generateSlidingWindows,
  tileTokenCountFromText,
} from "@/helper/voiceMatching/windows";
import { normalizeSpeechToken } from "@/helper/speech/normalizer";
import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import type { TokenObservationPair } from "./tokenObservations";

const PRONUNCIATION_NEAR_MISS: RejectionReason = "LOW_PRONUNCIATION";

const ALIGNMENT_NEAR_MISS_REASONS = new Set<RejectionReason>([
  "LOW_TOKEN_COVERAGE",
  "LOW_ORDER_PRESERVATION",
  "INSERTION_TOLERANCE_EXCEEDED",
  "DELETION_TOLERANCE_EXCEEDED",
]);

function duplicateTileKey(tileText: string): string {
  return tokenizeTileText(tileText).join(" ");
}

function pairsFromAlignment(alignment: AlignmentResult): TokenObservationPair[] {
  const pairs: TokenObservationPair[] = [];

  for (const row of alignment.alignments) {
    const expectedToken = normalizeSpeechToken(row.expected);
    const observedToken = normalizeSpeechToken(row.spoken);
    if (!expectedToken || !observedToken || expectedToken === observedToken) {
      continue;
    }
    pairs.push({ expectedToken, observedToken });
  }

  return pairs;
}

function pairsFromAcceptedTile(
  tileText: string,
  accepted: AcceptedTile,
  transcriptTokens: readonly string[],
  lexicon?: VoiceMatchLexicon,
): TokenObservationPair[] {
  const tileTokens = tokenizeTileText(tileText);
  const windowTokens = transcriptTokens.slice(
    accepted.span.start,
    accepted.span.end + 1,
  );
  if (windowTokens.length === 0) return [];

  return pairsFromAlignment(
    alignTileToWindow(tileTokens, windowTokens, lexicon),
  );
}

function findNearMissAlignment(
  reason: RejectionReason,
  tileText: string,
  recentSpeech: ReturnType<typeof getRecentSpeechTokens>,
  consumedSpans: readonly ConsumedSpan[],
  lexicon?: VoiceMatchLexicon,
): AlignmentResult | null {
  const tileTokens = tokenizeTileText(tileText);
  const windows = generateSlidingWindows(
    recentSpeech.tokens,
    tileTokenCountFromText(tileText),
    recentSpeech.startOffset,
  );

  let bestPartial: AlignmentResult | null = null;

  for (const window of windows) {
    if (windowOverlapsConsumedSpan(window, consumedSpans)) continue;

    const evidenceGate = validateEvidence(tileTokens, window.tokens, lexicon);
    if (!evidenceGate.pass) continue;

    const alignment = alignTileToWindow(tileTokens, window.tokens, lexicon);

    if (reason === PRONUNCIATION_NEAR_MISS) {
      if (!validateAlignment(alignment).pass) continue;
      if (!validatePronunciation(alignment).pass) {
        return alignment;
      }
      continue;
    }

    if (!ALIGNMENT_NEAR_MISS_REASONS.has(reason)) continue;

    if (alignment.matchedTileTokenCount === 0) continue;
    if (
      !bestPartial ||
      alignment.matchedTileTokenCount > bestPartial.matchedTileTokenCount
    ) {
      bestPartial = alignment;
    }
  }

  return bestPartial;
}

function isNearMissReason(reason: RejectionReason): boolean {
  return reason === PRONUNCIATION_NEAR_MISS || ALIGNMENT_NEAR_MISS_REASONS.has(reason);
}

export type CollectMatcherTokenObservationPairsInput = {
  transcriptTokens: readonly string[];
  /** Tiles evaluated by the matcher, in the same order as matching. */
  evaluatedTiles: readonly { id: string; text: string }[];
  matchResult: MatchVoiceTilesResult;
  tokenMatchLexicon?: VoiceMatchLexicon;
  maxRecentTokens?: number;
};

/**
 * Analytics-only extraction of token mismatches confirmed by the matcher.
 * Never uses sliding-window alignment over unrelated speech.
 */
export function collectMatcherTokenObservationPairs(
  input: CollectMatcherTokenObservationPairsInput,
): TokenObservationPair[] {
  const recentSpeech = getRecentSpeechTokens(
    input.transcriptTokens,
    input.maxRecentTokens ?? DEFAULT_MAX_RECENT_TOKENS,
  );

  const acceptedById = new Map(
    input.matchResult.acceptedTiles.map((tile) => [tile.tileId, tile]),
  );
  const rejectedById = new Map(
    input.matchResult.rejectedTiles.map((tile) => [tile.tileId, tile]),
  );

  const tileCountsByText = new Map<string, number>();
  for (const tile of input.evaluatedTiles) {
    const key = duplicateTileKey(tile.text);
    tileCountsByText.set(key, (tileCountsByText.get(key) ?? 0) + 1);
  }

  const spansConsumedByTextGroup = new Map<string, ConsumedSpan[]>();
  const pairs: TokenObservationPair[] = [];

  for (const tile of input.evaluatedTiles) {
    const textKey = duplicateTileKey(tile.text);
    const isDuplicate = (tileCountsByText.get(textKey) ?? 0) > 1;
    const groupConsumed = isDuplicate
      ? spansConsumedByTextGroup.get(textKey) ?? []
      : [];
    const effectiveConsumed = groupConsumed;

    const accepted = acceptedById.get(tile.id);
    if (accepted) {
      pairs.push(
        ...pairsFromAcceptedTile(
          tile.text,
          accepted,
          input.transcriptTokens,
          input.tokenMatchLexicon,
        ),
      );
      if (isDuplicate) {
        const list = spansConsumedByTextGroup.get(textKey) ?? [];
        list.push({ start: accepted.span.start, end: accepted.span.end });
        spansConsumedByTextGroup.set(textKey, list);
      }
      continue;
    }

    const rejected = rejectedById.get(tile.id);
    if (!rejected || !isNearMissReason(rejected.reason)) continue;

    const alignment = findNearMissAlignment(
      rejected.reason,
      tile.text,
      recentSpeech,
      effectiveConsumed,
      input.tokenMatchLexicon,
    );
    if (alignment) {
      pairs.push(...pairsFromAlignment(alignment));
    }
  }

  return pairs;
}
