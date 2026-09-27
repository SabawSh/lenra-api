import {
  MAX_DELETION_SLACK,
  MAX_INSERTION_SLACK,
  MIN_ORDER_PRESERVATION,
  MIN_TOKEN_COVERAGE,
} from "./voiceMatchingConfig";
import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import { lexicalEvidenceMatch, lexicalSimilarity } from "./lexicalMatch";
import type { AlignmentResult, GateResult, TokenAlignment } from "./types";
import { findVariantSpan } from "./variantSpanMatch";
import { normalizeToken } from "./textUtils";

function pushSpanAlignments(input: {
  alignments: TokenAlignment[];
  tileTokens: readonly string[];
  windowTokens: readonly string[];
  expectedIndex: number;
  spokenIndex: number;
  expectedLen: number;
  spokenLen: number;
  lastMatchedSpoken: number;
  inOrderMatches: number;
}): {
  lastMatchedSpoken: number;
  inOrderMatches: number;
} {
  const spokenJoined = Array.from(
    { length: input.spokenLen },
    (_, offset) => input.windowTokens[input.spokenIndex + offset] ?? "",
  ).join(" ");
  const spoken =
    input.spokenLen === 1
      ? (input.windowTokens[input.spokenIndex] ?? "")
      : spokenJoined;

  let { lastMatchedSpoken, inOrderMatches } = input;
  for (let offset = 0; offset < input.expectedLen; offset++) {
    input.alignments.push({
      expectedIndex: input.expectedIndex + offset,
      spokenIndex: input.spokenIndex,
      expected: input.tileTokens[input.expectedIndex + offset] ?? "",
      spoken,
    });
    if (input.spokenIndex >= lastMatchedSpoken) inOrderMatches += 1;
    lastMatchedSpoken = input.spokenIndex;
  }
  return { lastMatchedSpoken, inOrderMatches };
}

function buildAlignment(
  tileTokens: readonly string[],
  windowTokens: readonly string[],
  lexicon?: VoiceMatchLexicon,
): AlignmentResult {
  if (tileTokens.length === 0) {
    return {
      alignments: [],
      matchedTileTokenCount: 0,
      tileTokenCount: 0,
      orderPreserved: false,
      insertionCount: 0,
      deletionCount: 0,
    };
  }

  const alignments: TokenAlignment[] = [];
  let spokenCursor = 0;
  let inOrderMatches = 0;
  let lastMatchedSpoken = -1;
  let expectedIndex = 0;

  while (expectedIndex < tileTokens.length) {
    const expected = tileTokens[expectedIndex] ?? "";
    const expectedNorm = normalizeToken(expected);

    // 1. Legacy per-token path first (exact / cached form / lexical).
    let bestSpokenIndex = -1;
    let bestSimilarity = 0;

    for (
      let spokenIndex = spokenCursor;
      spokenIndex < windowTokens.length;
      spokenIndex++
    ) {
      const spoken = windowTokens[spokenIndex] ?? "";
      const similarity = lexicalSimilarity(expected, spoken, lexicon);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestSpokenIndex = spokenIndex;
      }
      if (similarity >= 0.95) break;
    }

    if (
      bestSpokenIndex >= 0 &&
      lexicalEvidenceMatch(expected, windowTokens[bestSpokenIndex] ?? "", lexicon)
    ) {
      const spoken = windowTokens[bestSpokenIndex] ?? "";
      alignments.push({
        expectedIndex,
        spokenIndex: bestSpokenIndex,
        expected,
        spoken,
      });
      if (bestSpokenIndex > lastMatchedSpoken) inOrderMatches += 1;
      lastMatchedSpoken = bestSpokenIndex;
      spokenCursor = bestSpokenIndex + 1;
      expectedIndex += 1;
      continue;
    }

    // 2. Variant span fallback only when 1↔1 did not accept.
    let spanMatched = false;
    for (
      let spokenIndex = spokenCursor;
      spokenIndex < windowTokens.length;
      spokenIndex++
    ) {
      const span = findVariantSpan(
        tileTokens,
        expectedIndex,
        windowTokens,
        spokenIndex,
        lexicon,
      );
      if (!span) continue;

      ({ lastMatchedSpoken, inOrderMatches } = pushSpanAlignments({
        alignments,
        tileTokens,
        windowTokens,
        expectedIndex,
        spokenIndex,
        expectedLen: span.expectedLen,
        spokenLen: span.spokenLen,
        lastMatchedSpoken,
        inOrderMatches,
      }));
      expectedIndex += span.expectedLen;
      spokenCursor = spokenIndex + span.spokenLen;
      spanMatched = true;
      break;
    }
    if (spanMatched) continue;

    // 3. Deletion — same as prior behavior when nothing matches.
    if (!expectedNorm) {
      expectedIndex += 1;
      continue;
    }
    expectedIndex += 1;
  }

  const matchedTileTokenCount = alignments.length;
  const firstMatched = alignments[0]?.spokenIndex ?? 0;
  const lastMatched = alignments.at(-1)?.spokenIndex ?? firstMatched;
  const insertionCount = Math.max(
    0,
    windowTokens.length - (lastMatched - firstMatched + 1),
  );
  const deletionCount = tileTokens.length - matchedTileTokenCount;
  const orderPreserved =
    matchedTileTokenCount === 0
      ? false
      : inOrderMatches === matchedTileTokenCount;

  return {
    alignments,
    matchedTileTokenCount,
    tileTokenCount: tileTokens.length,
    orderPreserved,
    insertionCount,
    deletionCount,
  };
}

export function alignTileToWindow(
  tileTokens: readonly string[],
  windowTokens: readonly string[],
  lexicon?: VoiceMatchLexicon,
): AlignmentResult {
  return buildAlignment(tileTokens, windowTokens, lexicon);
}

export function validateAlignment(alignment: AlignmentResult): GateResult {
  if (alignment.tileTokenCount === 0) {
    return { pass: false, reason: "LOW_TOKEN_COVERAGE" };
  }

  const tokenCoverage =
    alignment.matchedTileTokenCount / alignment.tileTokenCount;
  if (tokenCoverage < MIN_TOKEN_COVERAGE) {
    return { pass: false, reason: "LOW_TOKEN_COVERAGE" };
  }

  const orderPreservation =
    alignment.matchedTileTokenCount === 0
      ? 0
      : alignment.orderPreserved
        ? 1
        : 0;
  if (orderPreservation < MIN_ORDER_PRESERVATION) {
    return { pass: false, reason: "LOW_ORDER_PRESERVATION" };
  }

  if (alignment.insertionCount > MAX_INSERTION_SLACK) {
    return { pass: false, reason: "INSERTION_TOLERANCE_EXCEEDED" };
  }

  if (alignment.deletionCount > MAX_DELETION_SLACK) {
    return { pass: false, reason: "DELETION_TOLERANCE_EXCEEDED" };
  }

  return { pass: true };
}
