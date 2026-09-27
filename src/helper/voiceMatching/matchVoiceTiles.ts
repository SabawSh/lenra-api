import type { SuppressionReason, VoiceCandidate } from "./candidateTypes";
import { evaluateTile } from "./evaluateTile";
import { refineAllCandidateLiteralSpans } from "./literalSpanRefinement";
import { expectedPhraseKey } from "./phraseKnowledgeBase/normalizePhrase";
import type { PhraseKnowledgeEntry } from "./phraseKnowledgeBase/types";
import { logCandidateRejection } from "./placementPipelineTrace";
import {
  isAmbiguousPrefixSpan,
  longerPrefixExtensions,
} from "./prefixAmbiguity";
import { getRecentSpeechTokens } from "./recentWindow";
import { resolveVoiceCandidates } from "./resolver";
import { normalizeToken, tokenizeTileText } from "./textUtils";
import type {
  AcceptedTile,
  ConsumedSpan,
  MatchVoiceTilesInput,
  MatchVoiceTilesResult,
  PlacementCommitmentLevel,
  RejectedTile,
  RejectionReason,
  VoiceTile,
} from "./types";
import { resolveVoiceMatchingConfig } from "./voiceMatchingConfig";

/** Minimum tile length for phrase-knowledge rescue (single words never qualify). */
const MIN_KNOWLEDGE_TILE_TOKENS = 2;

function buildKnowledgeLookup(
  entries: readonly PhraseKnowledgeEntry[],
): Map<string, PhraseKnowledgeEntry> {
  const lookup = new Map<string, PhraseKnowledgeEntry>();
  for (const entry of entries) {
    const key = expectedPhraseKey(entry.expectedPhrase);
    if (!key || lookup.has(key)) continue;
    lookup.set(key, entry);
  }
  return lookup;
}

function resolveTileKnowledge(
  lookup: Map<string, PhraseKnowledgeEntry>,
  tileText: string,
): PhraseKnowledgeEntry | null {
  if (lookup.size === 0) return null;
  if (tokenizeTileText(tileText).length < MIN_KNOWLEDGE_TILE_TOKENS)
    return null;
  const key = expectedPhraseKey(tileText);
  return key ? (lookup.get(key) ?? null) : null;
}

/** Group key for tiles that share the same expected text (e.g. two "it's"). */
function duplicateTileKey(tileText: string): string {
  return tokenizeTileText(tileText).join(" ");
}

/** Duplicate-text tiles must bind to literal transcript tokens at the span. */
function isLiteralSpanForTile(
  transcript: readonly string[],
  span: { start: number; end: number },
  tileText: string,
): boolean {
  const expected = tokenizeTileText(tileText);
  if (expected.length === 0) return false;
  if (span.end - span.start + 1 !== expected.length) return false;
  return expected.every(
    (token, offset) =>
      normalizeToken(transcript[span.start + offset] ?? "") ===
      normalizeToken(token),
  );
}

function countTilesByText(
  tiles: readonly { text: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    const key = duplicateTileKey(tile.text);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Preview: defer a short tile that is a proper prefix of a longer unsolved
 * phrase when the spoken evidence at this span could still belong to that
 * phrase. Final may accept the short tile, but the placement layer then commits
 * it provisionally (see refreshProvisionalPrefixFlags) so a later continuation
 * can still win — ambiguity is shared, only the response to it differs.
 */
export function shouldDeferAmbiguousPrefix(input: {
  tileTokens: readonly string[];
  span: { start: number; end: number };
  transcript: readonly string[];
  unsolvedTiles: readonly VoiceTile[];
  tileId: string;
  commitmentLevel: PlacementCommitmentLevel;
}): boolean {
  if (input.commitmentLevel === "final") return false;

  return isAmbiguousPrefixSpan({
    tileTokens: input.tileTokens,
    span: input.span,
    transcript: input.transcript,
    longerTokenLists: longerPrefixExtensions({
      tileTokens: input.tileTokens,
      tileId: input.tileId,
      otherTiles: input.unsolvedTiles,
    }),
  });
}

/**
 * Duplicate-text tiles must attempt matching in expected sentence order, never
 * shuffled pool order. Unique tiles keep their relative input order.
 */
export function orderUnsolvedTilesForDuplicateOwnership(
  tiles: readonly VoiceTile[],
  expectedTileOrder: readonly string[] | undefined,
): VoiceTile[] {
  if (
    !expectedTileOrder ||
    expectedTileOrder.length === 0 ||
    tiles.length <= 1
  ) {
    return tiles as VoiceTile[];
  }

  const expectedIndex = new Map(
    expectedTileOrder.map((id, index) => [id, index]),
  );
  const sentenceIndex = (id: string): number =>
    expectedIndex.get(id) ?? Number.MAX_SAFE_INTEGER;

  const counts = countTilesByText(tiles);
  const duplicateGroups = new Map<string, VoiceTile[]>();
  for (const tile of tiles) {
    const key = duplicateTileKey(tile.text);
    if ((counts.get(key) ?? 0) <= 1) continue;
    const group = duplicateGroups.get(key) ?? [];
    group.push(tile);
    duplicateGroups.set(key, group);
  }
  if (duplicateGroups.size === 0) {
    return tiles as VoiceTile[];
  }

  for (const group of duplicateGroups.values()) {
    group.sort(
      (left, right) => sentenceIndex(left.id) - sentenceIndex(right.id),
    );
  }

  const emittedGroups = new Set<string>();
  const ordered: VoiceTile[] = [];
  for (const tile of tiles) {
    const key = duplicateTileKey(tile.text);
    if ((counts.get(key) ?? 0) <= 1) {
      ordered.push(tile);
      continue;
    }
    if (emittedGroups.has(key)) continue;
    emittedGroups.add(key);
    ordered.push(...(duplicateGroups.get(key) ?? [tile]));
  }
  return ordered;
}

function suppressionToRejectionReason(
  reason: SuppressionReason,
): RejectionReason {
  switch (reason) {
    case "STICKY_LOCK_BLOCKED":
    case "HARD_OWNERSHIP_BLOCKED":
    case "LOST_TO_HIGHER_TIER":
    case "LOST_TO_HIGHER_SCORE":
    case "MUTUAL_EXCLUSION":
    case "LITERAL_SLOT_TAKEN":
      return "OVERLAP_CONSUMED";
    case "LITERAL_PREFIX_SUBSUMED":
      return "SUBSUMED_BY_LONGER_TILE";
    case "TILE_ALREADY_ASSIGNED":
      return "OVERLAP_CONSUMED";
    case "DEFERRED_BY_POLICY":
      return "AMBIGUOUS_PREFIX";
  }
}

function winnersToAcceptedTiles(
  candidates: readonly VoiceCandidate[],
  winners: MatchVoiceTilesResult["resolution"]["winners"],
): AcceptedTile[] {
  return winners.map((winner) => ({
    tileId: winner.tileId,
    span: winner.span,
    acceptReason: winner.acceptReason,
  }));
}

function resolverLossesToRejectedTiles(
  resolution: MatchVoiceTilesResult["resolution"],
): RejectedTile[] {
  const rows: RejectedTile[] = [];
  for (const row of [...resolution.suppressed, ...resolution.ineligible]) {
    rows.push({
      tileId: row.tileId,
      reason: suppressionToRejectionReason(row.suppressionReason),
    });
  }
  return rows;
}

/**
 * Pure candidate generator + resolver.
 * Candidate generation never emits ACCEPT; the resolver is the sole semantic owner.
 */
export function matchVoiceTiles(
  input: MatchVoiceTilesInput,
): MatchVoiceTilesResult {
  const config = resolveVoiceMatchingConfig(input.config);
  const consumedSpans = input.consumedSpans ?? [];
  const recentSpeech = getRecentSpeechTokens(
    input.transcript,
    config.maxRecentTokens,
  );
  const knowledgeLookup = buildKnowledgeLookup(input.phraseKnowledge ?? []);
  const commitmentLevel: PlacementCommitmentLevel =
    input.commitmentLevel ?? "final";

  const unsolvedTiles = orderUnsolvedTilesForDuplicateOwnership(
    input.unsolvedTiles,
    input.expectedTileOrder,
  );
  const tileCountsByText = countTilesByText(unsolvedTiles);
  const spansConsumedByTextGroup = new Map<string, ConsumedSpan[]>();

  const candidates: VoiceCandidate[] = [];
  const rejectedTiles: RejectedTile[] = [];

  for (const tile of unsolvedTiles) {
    const phraseKnowledge = resolveTileKnowledge(knowledgeLookup, tile.text);
    const textKey = duplicateTileKey(tile.text);
    const isDuplicate = (tileCountsByText.get(textKey) ?? 0) > 1;
    const groupConsumed = isDuplicate
      ? (spansConsumedByTextGroup.get(textKey) ?? [])
      : [];
    const effectiveConsumed =
      groupConsumed.length > 0
        ? [...consumedSpans, ...groupConsumed]
        : consumedSpans;
    const result = evaluateTile(
      tile.id,
      tile.text,
      recentSpeech,
      effectiveConsumed,
      config,
      phraseKnowledge,
      input.tokenMatchLexicon,
    );

    if ("candidate" in result) {
      if (
        isDuplicate &&
        !isLiteralSpanForTile(
          input.transcript,
          result.candidate.span,
          tile.text,
        )
      ) {
        rejectedTiles.push({
          tileId: tile.id,
          reason: "INSUFFICIENT_EVIDENCE",
        });
        continue;
      }

      const tileTokens = tokenizeTileText(tile.text);
      if (
        shouldDeferAmbiguousPrefix({
          tileTokens,
          span: result.candidate.span,
          transcript: input.transcript,
          unsolvedTiles,
          tileId: tile.id,
          commitmentLevel,
        })
      ) {
        logCandidateRejection({
          candidate: tile.text,
          tileId: tile.id,
          reason: "AMBIGUOUS_PREFIX",
          functionName: "matchVoiceTiles / shouldDeferAmbiguousPrefix",
          condition:
            "commitmentLevel===preview && tile is proper prefix of longer unsolved phrase at this span",
        });
        rejectedTiles.push({
          tileId: tile.id,
          reason: "AMBIGUOUS_PREFIX",
        });
        continue;
      }

      candidates.push(result.candidate);
      if (isDuplicate) {
        const list = spansConsumedByTextGroup.get(textKey) ?? [];
        list.push({
          start: result.candidate.span.start,
          end: result.candidate.span.end,
        });
        spansConsumedByTextGroup.set(textKey, list);
      }
    } else {
      rejectedTiles.push(result.rejected);
    }
  }

  const tileTextById = new Map(
    unsolvedTiles.map((tile) => [tile.id, tile.text]),
  );
  const refinedCandidates = refineAllCandidateLiteralSpans({
    candidates,
    tileTextById,
    transcript: input.transcript,
    consumedSpans,
  });

  const resolution = resolveVoiceCandidates({
    candidates: refinedCandidates,
    consumedSpans,
    commitmentLevel,
    passId: `match:${commitmentLevel}`,
  });

  const acceptedTiles = winnersToAcceptedTiles(
    refinedCandidates,
    resolution.winners,
  );
  const resolverRejected = resolverLossesToRejectedTiles(resolution);

  return {
    acceptedTiles,
    rejectedTiles: [...rejectedTiles, ...resolverRejected],
    candidates: refinedCandidates,
    resolution,
  };
}
