import type { PlacementProposal } from "@/helper/puzzel/sessionPlacementState";
import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import { normalizeText } from "@/helper/speech/normalizer";
import { tokenize } from "@/helper/speech/tokenizer";
import type { PuzzlePart } from "@/types/puzzle";
import type {
  ConsumedSpan,
  MatchVoiceTilesResult,
  PlacementCommitmentLevel,
} from "./types";
import { matchVoiceTiles } from "./matchVoiceTiles";
import { logPlacementOrder } from "./placementOrderTrace";
import {
  getPhraseKnowledgeBase,
  refreshAdaptivePhraseKnowledge,
} from "./phraseKnowledgeBase";

export type VoicePlacementInput = {
  transcriptTokens: readonly string[];
  unsolvedPool: readonly PuzzlePart[];
  consumedSpans?: readonly ConsumedSpan[];
  tokenMatchLexicon?: VoiceMatchLexicon;
  expectedTileOrder?: readonly string[];
  commitmentLevel?: PlacementCommitmentLevel;
};

function tileTokenCount(part: PuzzlePart): number {
  const fromText = tokenize(normalizeText(part.text));
  return fromText.length > 0 ? fromText.length : part.tokens.length;
}

export function consumedSpansFromIndices(
  tokens: readonly string[],
  consumedIndices: readonly boolean[],
): ConsumedSpan[] {
  const spans: ConsumedSpan[] = [];
  let spanStart: number | null = null;

  for (let index = 0; index < consumedIndices.length; index++) {
    const consumed = consumedIndices[index] ?? false;
    if (consumed && spanStart === null) {
      spanStart = index;
      continue;
    }
    if (!consumed && spanStart !== null) {
      spans.push({ start: spanStart, end: index - 1 });
      spanStart = null;
    }
  }

  if (spanStart !== null) {
    spans.push({ start: spanStart, end: consumedIndices.length - 1 });
  }

  return spans;
}

export function proposalsFromMatchResult(
  result: MatchVoiceTilesResult,
  pool: readonly PuzzlePart[],
): PlacementProposal[] {
  const tokenCountById = new Map(
    pool.map((part) => [part.id, tileTokenCount(part)]),
  );

  return result.acceptedTiles.map((accepted) => {
    const indices: number[] = [];
    for (let index = accepted.span.start; index <= accepted.span.end; index++) {
      indices.push(index);
    }

    return {
      tileId: accepted.tileId,
      speechIndex: accepted.span.start,
      matchedSpan: accepted.span,
      matchedTokenIndices: indices,
      tileTokenCount: tokenCountById.get(accepted.tileId) ?? indices.length,
      confidence: 1,
      source: "strict" as const,
    };
  });
}

export function orchestrateVoicePlacements(
  input: VoicePlacementInput,
): MatchVoiceTilesResult & { proposals: PlacementProposal[] } {
  refreshAdaptivePhraseKnowledge();

  const result = matchVoiceTiles({
    transcript: input.transcriptTokens,
    unsolvedTiles: input.unsolvedPool.map((part) => ({
      id: part.id,
      text: part.text,
    })),
    consumedSpans: input.consumedSpans,
    phraseKnowledge: getPhraseKnowledgeBase().getEntries(),
    tokenMatchLexicon: input.tokenMatchLexicon,
    expectedTileOrder: input.expectedTileOrder,
    commitmentLevel: input.commitmentLevel,
  });

  const proposals = proposalsFromMatchResult(result, input.unsolvedPool);

  const textById = new Map(input.unsolvedPool.map((part) => [part.id, part.text]));
  const scoreById = new Map(
    (result.candidates ?? []).map((row) => [row.tileId, row.score]),
  );

  logPlacementOrder([
    `[PLACEMENT-ORDER] 1. acceptedTiles (exact order)`,
    ...result.acceptedTiles.map((tile, index) => {
      const text = textById.get(tile.tileId) ?? "?";
      return `${index}. tileId=${tile.tileId} tileText=${JSON.stringify(text)} speechStart=${tile.span.start} speechEnd=${tile.span.end} score=${scoreById.get(tile.tileId) ?? "n/a"}`;
    }),
    ``,
    `[PLACEMENT-ORDER] 2. proposalsFromMatchResult() (array order)`,
    ...proposals.map((proposal, index) => {
      const text = textById.get(proposal.tileId) ?? "?";
      return `${index}. tileId=${proposal.tileId} tileText=${JSON.stringify(text)} span=${proposal.matchedSpan.start}-${proposal.matchedSpan.end}`;
    }),
  ]);

  return {
    ...result,
    proposals,
  };
}
