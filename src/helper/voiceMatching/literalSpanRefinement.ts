import { findFreeLiteralSpan, expectedTileTokens } from "@/helper/puzzel/sessionPlacementState";
import {
  candidateIdFor,
  type VoiceCandidate,
} from "./candidateTypes";
import type { ConsumedSpan } from "./types";
import { tierLabelFor, tierWeight } from "./candidateTypes";

function consumedIndexSet(spans: readonly ConsumedSpan[]): Set<number> {
  const consumed = new Set<number>();
  for (const span of spans) {
    for (let index = span.start; index <= span.end; index++) {
      consumed.add(index);
    }
  }
  return consumed;
}

/**
 * Prefer a free literal transcript occurrence over a sliding-window near-miss
 * (e.g. "give you" at indices 2–3 instead of "i give" at 1–2).
 */
export function refineCandidateLiteralSpan(input: {
  candidate: VoiceCandidate;
  tileText: string;
  transcript: readonly string[];
  consumedSpans: readonly ConsumedSpan[];
}): VoiceCandidate {
  const expected = expectedTileTokens(input.tileText);
  if (expected.length === 0) return input.candidate;

  const consumed = consumedIndexSet(input.consumedSpans);
  const literal = findFreeLiteralSpan(
    input.transcript,
    expected,
    input.candidate.span.start,
    consumed,
  );
  if (!literal) return input.candidate;
  if (
    literal.start === input.candidate.span.start &&
    literal.end === input.candidate.span.end
  ) {
    return input.candidate;
  }

  const tier = input.candidate.evidenceTier;
  return {
    ...input.candidate,
    candidateId: candidateIdFor(input.candidate.tileId, literal),
    span: literal,
    evidenceTier: tier <= 2 ? 1 : tier,
    tierLabel: tier <= 2 ? "T1_EXACT_LEXICAL" : tierLabelFor(tier),
    score:
      tier <= 2
        ? tierWeight(1) + input.candidate.scoreComponents.featureScore
        : input.candidate.score,
  };
}

/**
 * Refine all candidates, accounting for inter-candidate span claims.
 *
 * A single-token tile like "Stolen" can grab the first literal occurrence even
 * when a multi-token tile like "she was stolen" already occupies those tokens.
 * evaluateTile runs without knowledge of other candidates in the same pass, so
 * both can legitimately claim the same occurrence. The resolver would kill the
 * shorter one, even though a free second occurrence exists.
 *
 * Fix: process candidates longest-span-first (higher-scoring candidates win ties
 * at equal span length) and accumulate their spans as consumed for the remainder.
 * A shorter candidate whose span overlaps an already-claimed span is re-probed
 * for a free literal occurrence elsewhere in the transcript.
 */
export function refineAllCandidateLiteralSpans(input: {
  candidates: readonly VoiceCandidate[];
  tileTextById: ReadonlyMap<string, string>;
  transcript: readonly string[];
  consumedSpans: readonly ConsumedSpan[];
}): VoiceCandidate[] {
  const indexed = input.candidates.map((candidate, originalIndex) => ({
    candidate,
    originalIndex,
  }));

  // Longest span first; break ties by score (descending).
  const sorted = [...indexed].sort((a, b) => {
    const spanLenA = a.candidate.span.end - a.candidate.span.start + 1;
    const spanLenB = b.candidate.span.end - b.candidate.span.start + 1;
    if (spanLenB !== spanLenA) return spanLenB - spanLenA;
    return b.candidate.score - a.candidate.score;
  });

  const claimedSpans: ConsumedSpan[] = [...input.consumedSpans];
  const refined: (VoiceCandidate | null)[] = Array(input.candidates.length).fill(null);

  for (const { candidate, originalIndex } of sorted) {
    const tileText = input.tileTextById.get(candidate.tileId);
    if (!tileText) {
      refined[originalIndex] = candidate;
      claimedSpans.push(candidate.span);
      continue;
    }

    const result = refineCandidateLiteralSpan({
      candidate,
      tileText,
      transcript: input.transcript,
      consumedSpans: claimedSpans,
    });

    refined[originalIndex] = result;
    claimedSpans.push(result.span);
  }

  return refined as VoiceCandidate[];
}
