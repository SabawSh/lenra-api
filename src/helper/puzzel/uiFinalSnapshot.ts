import type { PuzzlePart } from "@/types/puzzle";
import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import { orchestrateVoicePlacements } from "@/helper/voiceMatching/placementBridge";
import {
  beginPipelineTrace,
  logPipelineStage,
  pipelineNowMs,
} from "@/helper/voiceMatching/placementPipelineTrace";
import type {
  AcceptReason,
  MatchVoiceTilesResult,
  RejectionReason,
} from "@/helper/voiceMatching/types";
import { normalizeText } from "@/helper/speech/normalizer";
import { resolveSttFallbackConfig } from "@/helper/speech/sttConfig";
import { tokenize } from "@/helper/speech/tokenizer";
import { logPlacementOrder } from "@/helper/voiceMatching/placementOrderTrace";
import {
  formatMatchDiffTiles,
  logMatchDiff,
  matchDiffTraceEnabled,
  type MatchDiffTile,
} from "@/helper/voiceMatching/matchDiffTrace";
import {
  isLifecycleWatchTileText,
  logTileLifecycle,
} from "@/helper/voiceMatching/tileLifecycleTrace";
import {
  appendPlacements,
  consumedSpansFromSessionState,
  createEmptySessionPlacementState,
  orderedEntriesFromSessionState,
  preparePriorPlacementForMatching,
  purgeDetachedPlacements,
  type MatchedSpan,
  type SessionPlacementEntry,
  type SessionPlacementState,
} from "./sessionPlacementState";
import type { PlacementCommitmentLevel } from "@/helper/voiceMatching/types";

export type UiFinalSnapshotTile = {
  id: string;
  text: string;
  span: MatchedSpan;
  speechIndex: number;
  /** Placement commit order — UI sort key (same as session placement). */
  commitSeq: number;
  acceptReason: AcceptReason;
};

export type UiFinalSnapshotRejectedTile = {
  id: string;
  text: string;
  reason: RejectionReason | string;
};

export type UiFinalSnapshot = {
  sessionId: number;
  utteranceKey: string;
  orderedTiles: readonly UiFinalSnapshotTile[];
  spans: readonly MatchedSpan[];
  acceptedTiles: readonly { id: string; text: string; acceptReason: AcceptReason }[];
  rejectedTiles: readonly UiFinalSnapshotRejectedTile[];
};

export type BuildUiFinalSnapshotInput = {
  sessionId: number;
  utteranceKey: string;
  transcriptTokens: readonly string[];
  voicePool: readonly PuzzlePart[];
  originalParts: readonly PuzzlePart[];
  tileTextById: ReadonlyMap<string, string>;
  /**
   * Accumulated placement from earlier preview/final commits in the SAME voice
   * session. Committed tiles are immutable — later snapshots only append
   * unsolved matches. Omit / pass empty only for a fresh voice session or reset.
   */
  priorPlacement?: SessionPlacementState;
  /**
   * Cached pronunciation surfaces for tile tokens (built when the puzzle /
   * session is created). The matcher only reads this map — it never regenerates
   * surfaces during matching.
   */
  tokenMatchLexicon?: VoiceMatchLexicon;
  /**
   * Preview defers ambiguous short prefixes of longer unsolved phrases.
   * Final (mic release) may accept those short tiles.
   */
  commitmentLevel?: PlacementCommitmentLevel;
  /** Optional hypothesis metadata for [MATCH-DIFF] probes only. */
  matchDiffMeta?: {
    hypothesisFinal?: boolean;
    confidence?: number;
    rawEngineTranscript?: string;
    afterNormalize?: string;
    afterRecovery?: string;
  };
};

export type BuildUiFinalSnapshotResult = {
  snapshot: UiFinalSnapshot;
  matchResult: MatchVoiceTilesResult;
  /** New accumulated placement state — persist and feed back as priorPlacement. */
  placementState: SessionPlacementState;
};

function voiceDebugEnabled(): boolean {
  return resolveSttFallbackConfig().debug;
}

/**
 * COMMIT PHASE pipeline trace — debug-gated (no permanent production noise).
 */
export function logVoiceCommitPipeline(
  stage: string,
  payload: Record<string, unknown>,
): void {
  if (!voiceDebugEnabled()) return;
}

function tileTokens(text: string): string[] {
  return tokenize(normalizeText(text));
}

function isContiguousSubsequence(
  needle: readonly string[],
  haystack: readonly string[],
): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start++) {
    if (needle.every((token, index) => token === haystack[start + index])) {
      return true;
    }
  }
  return false;
}

function isDetachedSpan(span: MatchedSpan): boolean {
  return span.start < 0 || span.end < span.start;
}

function matchDiffTilesFromPlacement(
  state: SessionPlacementState,
  tileTextById: ReadonlyMap<string, string>,
): MatchDiffTile[] {
  return orderedEntriesFromSessionState(state).map((entry) => ({
    tileId: entry.tileId,
    tileText: tileTextById.get(entry.tileId) ?? entry.tileId,
    speechStart: entry.matchedSpan.start,
    speechEnd: entry.matchedSpan.end,
    detached: isDetachedSpan(entry.matchedSpan),
  }));
}

function transcriptContainsTileLiteral(
  transcriptTokens: readonly string[],
  tileText: string,
): boolean {
  const expected = tokenize(normalizeText(tileText));
  if (expected.length === 0) return false;
  for (
    let start = 0;
    start <= transcriptTokens.length - expected.length;
    start++
  ) {
    if (
      expected.every(
        (token, offset) =>
          normalizeText(transcriptTokens[start + offset] ?? "") === token,
      )
    ) {
      return true;
    }
  }
  return false;
}

function spansOverlap(left: MatchedSpan, right: MatchedSpan): boolean {
  return left.start <= right.end && right.start <= left.end;
}

/**
 * Explain (never decide) why the placement owner dropped an accepted candidate.
 * Placement has already made the decision; this only labels it.
 */
function classifyPlacementDrop(
  droppedTileId: string,
  droppedSpan: MatchedSpan,
  placedEntries: readonly SessionPlacementEntry[],
  tileTextById: ReadonlyMap<string, string>,
): RejectionReason {
  const droppedText = tileTextById.get(droppedTileId);
  const droppedTokens = droppedText ? tileTokens(droppedText) : [];

  for (const entry of placedEntries) {
    if (!spansOverlap(droppedSpan, entry.matchedSpan)) continue;
    const placedText = tileTextById.get(entry.tileId);
    const placedTokens = placedText ? tileTokens(placedText) : [];
    if (
      droppedTokens.length > 0 &&
      droppedTokens.length < placedTokens.length &&
      isContiguousSubsequence(droppedTokens, placedTokens)
    ) {
      return "SUBSUMED_BY_LONGER_TILE";
    }
    return "OVERLAP_CONSUMED";
  }

  return "OVERLAP_CONSUMED";
}

/**
 * Single authoritative builder for voice-rendered puzzle state.
 *
 * Ownership:
 * - matchVoiceTiles generates candidates; Resolver is the semantic owner.
 * - appendPlacements is sticky commit only — never arbitrates competing hypotheses.
 * - This snapshot renders EXACTLY the placement output.
 */
export function buildUiFinalSnapshot(
  input: BuildUiFinalSnapshotInput,
): BuildUiFinalSnapshotResult {
  const commitmentLevel: PlacementCommitmentLevel =
    input.commitmentLevel ?? "final";
  const transcriptLabel = input.transcriptTokens.join(" ");
  const trace = beginPipelineTrace(transcriptLabel);

  const priorRaw = input.priorPlacement ?? createEmptySessionPlacementState();
  logPlacementOrder([
    `--------------------------------`,
    `SNAPSHOT INPUT`,
    `transcript: ${transcriptLabel}`,
    `commitmentLevel: ${commitmentLevel}`,
    ...orderedEntriesFromSessionState(priorRaw).map((entry) => {
      const text = input.tileTextById.get(entry.tileId) ?? entry.tileId;
      return `commitSeq=${entry.commitSeq}\ntileText=${text}`;
    }),
    `--------------------------------`,
  ]);

  let stageStart = pipelineNowMs();
  let priorPlacement = preparePriorPlacementForMatching(
    priorRaw,
    input.transcriptTokens,
    input.tileTextById,
    input.tokenMatchLexicon,
  );
  if (commitmentLevel === "final") {
    priorPlacement = purgeDetachedPlacements(priorPlacement, {
      tileTextById: input.tileTextById,
      commitmentLevel,
      transcript: transcriptLabel,
    });
  }

  const previousAccepted = matchDiffTilesFromPlacement(
    priorRaw,
    input.tileTextById,
  );
  const afterPrepare = matchDiffTilesFromPlacement(
    priorPlacement,
    input.tileTextById,
  );
  const prepareDropped: Array<{ tile: MatchDiffTile; reason: string }> = [];
  for (const prev of previousAccepted) {
    const still = afterPrepare.find((tile) => tile.tileId === prev.tileId);
    if (!still) {
      const inTranscript = transcriptContainsTileLiteral(
        input.transcriptTokens,
        prev.tileText,
      );
      prepareDropped.push({
        tile: prev,
        reason: inTranscript
          ? "PREPARE_PRIOR_DROPPED_FALSE_LOCK"
          : "PREPARE_PRIOR_DROPPED_FALSE_LOCK (transcript also missing literal)",
      });
      continue;
    }
    if (!prev.detached && still.detached) {
      prepareDropped.push({
        tile: still,
        reason: "PREPARE_PRIOR_DETACHED_WORDS_GONE",
      });
    }
  }

  logPipelineStage(
    trace,
    "preparePriorPlacementForMatching",
    {
      priorPlacedIds: [
        ...(input.priorPlacement?.placedTiles.keys() ?? []),
      ],
      transcriptTokens: [...input.transcriptTokens],
      commitmentLevel,
    },
    {
      placedIds: [...priorPlacement.placedTiles.keys()],
      spans: [...priorPlacement.placedTiles.values()].map((entry) => ({
        tileId: entry.tileId,
        span: entry.matchedSpan,
        commitSeq: entry.commitSeq,
      })),
    },
    stageStart,
  );

  const consumedSpans = consumedSpansFromSessionState(priorPlacement);
  const placedIds = new Set(priorPlacement.placedTiles.keys());
  const unsolvedPool = input.voicePool.filter((part) => !placedIds.has(part.id));

  stageStart = pipelineNowMs();
  const matchResult = orchestrateVoicePlacements({
    transcriptTokens: input.transcriptTokens,
    unsolvedPool,
    consumedSpans,
    tokenMatchLexicon: input.tokenMatchLexicon,
    expectedTileOrder: input.originalParts.map((part) => part.id),
    commitmentLevel,
  });
  logPipelineStage(
    trace,
    "orchestrateVoicePlacements (matchVoiceTiles)",
    {
      transcriptTokens: [...input.transcriptTokens],
      unsolvedPool: unsolvedPool.map((part) => part.text),
      consumedSpans,
      commitmentLevel,
    },
    {
      acceptedTiles: matchResult.acceptedTiles,
      rejectedTiles: matchResult.rejectedTiles,
      proposals: matchResult.proposals,
    },
    stageStart,
  );

  logVoiceCommitPipeline("matcher", {
    acceptedTilesLength: matchResult.acceptedTiles.length,
    acceptedTileIds: matchResult.acceptedTiles.map((tile) => tile.tileId),
    consumedSpanCount: consumedSpans.length,
    unsolvedPoolSize: unsolvedPool.length,
    commitmentLevel,
  });

  for (const candidate of matchResult.candidates ?? []) {
    const text = input.tileTextById.get(candidate.tileId) ?? "";
    if (!isLifecycleWatchTileText(text)) continue;
    logTileLifecycle({
      phase: "candidate created",
      functionName: "matchVoiceTiles/evaluateTile",
      reason: "CANDIDATE_CREATED",
      tileId: candidate.tileId,
      tileText: text,
      attachment: "absent",
      commitmentLevel,
      transcript: transcriptLabel,
      matchedSpan: candidate.span,
      literalSpan: candidate.span,
    });
  }
  for (const accepted of matchResult.acceptedTiles) {
    const text = input.tileTextById.get(accepted.tileId) ?? "";
    if (!isLifecycleWatchTileText(text)) continue;
    logTileLifecycle({
      phase: "resolver winner",
      functionName: "resolveVoiceCandidates",
      reason: `RESOLVER_WINNER acceptReason=${accepted.acceptReason}`,
      tileId: accepted.tileId,
      tileText: text,
      attachment: "absent",
      commitmentLevel,
      transcript: transcriptLabel,
      matchedSpan: accepted.span,
      literalSpan: accepted.span,
    });
  }
  for (const rejected of matchResult.rejectedTiles) {
    const text = input.tileTextById.get(rejected.tileId) ?? "";
    if (!isLifecycleWatchTileText(text)) continue;
    logTileLifecycle({
      phase: "resolver rejected",
      functionName: "matchVoiceTiles|resolveVoiceCandidates",
      reason: `REJECTED reason=${rejected.reason}`,
      tileId: rejected.tileId,
      tileText: text,
      attachment: "absent",
      commitmentLevel,
      transcript: transcriptLabel,
    });
  }

  stageStart = pipelineNowMs();
  const placementState = appendPlacements(
    priorPlacement,
    matchResult.proposals,
    {
      transcriptTokens: input.transcriptTokens,
      tileTextById: input.tileTextById,
    },
  );

  logPlacementOrder([
    `--------------------------------`,
    `SNAPSHOT AFTER APPEND`,
    ...orderedEntriesFromSessionState(placementState).map((entry) => {
      const text = input.tileTextById.get(entry.tileId) ?? entry.tileId;
      return [
        `commitSeq=${entry.commitSeq}`,
        `tileText=${text}`,
        `speechStart=${entry.matchedSpan.start}`,
        `speechEnd=${entry.matchedSpan.end}`,
      ].join("\n");
    }),
    `--------------------------------`,
  ]);

  logPipelineStage(
    trace,
    "appendPlacements",
    {
      priorPlacedIds: [...priorPlacement.placedTiles.keys()],
      proposals: matchResult.proposals,
    },
    {
      placedIds: [...placementState.placedTiles.keys()],
      spans: [...placementState.placedTiles.values()].map((entry) => ({
        tileId: entry.tileId,
        span: entry.matchedSpan,
        commitSeq: entry.commitSeq,
      })),
    },
    stageStart,
  );

  const entries = orderedEntriesFromSessionState(placementState);
  // Look up from the full puzzle (originalParts), not just the current unsolved
  // pool. Already-placed tiles leave the pool but must still render.
  const partById = new Map(input.originalParts.map((part) => [part.id, part]));
  for (const part of input.voicePool) {
    if (!partById.has(part.id)) partById.set(part.id, part);
  }
  const acceptReasonById = new Map(
    matchResult.acceptedTiles.map((tile) => [tile.tileId, tile.acceptReason]),
  );

  const orderedTiles: UiFinalSnapshotTile[] = entries.flatMap((entry) => {
    const part = partById.get(entry.tileId);
    if (!part) return [];
    return [
      {
        id: part.id,
        text: part.text,
        span: { ...entry.matchedSpan },
        speechIndex: entry.speechIndex,
        commitSeq: entry.commitSeq,
        acceptReason: acceptReasonById.get(entry.tileId) ?? "GATE_MATCH",
      },
    ];
  });

  logPlacementOrder([
    `--------------------------------`,
    `SNAPSHOT orderedTiles (after orderedEntriesFromSessionState)`,
    ...orderedTiles.map(
      (tile) =>
        `commitSeq=${tile.commitSeq}\ntileText=${tile.text}\nspeechStart=${tile.span.start}\nspeechEnd=${tile.span.end}`,
    ),
    `--------------------------------`,
  ]);

  const orderedPlacedIds = new Set(orderedTiles.map((tile) => tile.id));

  const placementDrops: UiFinalSnapshotRejectedTile[] = matchResult.acceptedTiles
    .filter((tile) => !orderedPlacedIds.has(tile.tileId))
    .map((tile) => ({
      id: tile.tileId,
      text: input.tileTextById.get(tile.tileId) ?? tile.tileId,
      reason: classifyPlacementDrop(
        tile.tileId,
        tile.span,
        entries,
        input.tileTextById,
      ),
    }));

  const rejectedTiles: UiFinalSnapshotRejectedTile[] = [
    ...matchResult.rejectedTiles.map((tile) => ({
      id: tile.tileId,
      text: input.tileTextById.get(tile.tileId) ?? tile.tileId,
      reason: tile.reason,
    })),
    ...placementDrops,
  ];

  const snapshot: UiFinalSnapshot = {
    sessionId: input.sessionId,
    utteranceKey: input.utteranceKey,
    orderedTiles,
    spans: orderedTiles
      .map((tile) => tile.span)
      .filter((span) => span.start >= 0 && span.end >= span.start),
    acceptedTiles: orderedTiles.map((tile) => ({
      id: tile.id,
      text: tile.text,
      acceptReason: tile.acceptReason,
    })),
    rejectedTiles,
  };

  logPlacementOrder([
    `[PLACEMENT-ORDER] 5. buildUiFinalSnapshot() — snapshot.orderedTiles (tile text only)`,
    `transcript: ${transcriptLabel}`,
    ...orderedTiles.map((tile, index) => `${index}. ${tile.text}`),
  ]);

  if (matchDiffTraceEnabled()) {
    const currentAccepted = matchDiffTilesFromPlacement(
      placementState,
      input.tileTextById,
    );
    const prevIds = new Set(previousAccepted.map((tile) => tile.tileId));
    const currIds = new Set(currentAccepted.map((tile) => tile.tileId));
    const added = currentAccepted.filter((tile) => !prevIds.has(tile.tileId));
    const removed = previousAccepted.filter((tile) => !currIds.has(tile.tileId));

    const removalLines: string[] = [];
    for (const tile of removed) {
      const prepareHit = prepareDropped.find(
        (row) => row.tile.tileId === tile.tileId,
      );
      if (prepareHit) {
        removalLines.push(
          `  - ${tile.tileText} (${tile.tileId}): ${prepareHit.reason}`,
        );
        continue;
      }
      const inTranscript = transcriptContainsTileLiteral(
        input.transcriptTokens,
        tile.tileText,
      );
      if (!inTranscript) {
        removalLines.push(
          `  - ${tile.tileText} (${tile.tileId}): TRANSCRIPT_NO_LONGER_CONTAINS_TILE (Chrome/hypothesis weaker or shorter)`,
        );
        continue;
      }
      removalLines.push(
        `  - ${tile.tileText} (${tile.tileId}): APPEND_EVICTED_OR_PLACEMENT_DROP (still in transcript after preparePrior)`,
      );
    }

    const meta = input.matchDiffMeta;
    const recoveryChanged =
      meta?.afterNormalize != null &&
      meta?.afterRecovery != null &&
      meta.afterNormalize.trim() !== meta.afterRecovery.trim();

    logMatchDiff([
      `transcript: ${transcriptLabel}`,
      `commitmentLevel: ${commitmentLevel}`,
      `hypothesisFinal: ${meta?.hypothesisFinal ?? "n/a"}`,
      `confidence: ${meta?.confidence ?? "n/a"}`,
      meta?.rawEngineTranscript != null
        ? `rawEngine: ${meta.rawEngineTranscript}`
        : `rawEngine: n/a`,
      meta?.afterNormalize != null
        ? `afterNormalize: ${meta.afterNormalize}`
        : `afterNormalize: n/a`,
      meta?.afterRecovery != null
        ? `afterRecovery: ${meta.afterRecovery}`
        : `afterRecovery: n/a`,
      `captionAwareRecoveryChangedTranscript: ${recoveryChanged}`,
      ``,
      `previousAccepted:`,
      formatMatchDiffTiles(previousAccepted),
      ``,
      `currentAccepted:`,
      formatMatchDiffTiles(currentAccepted),
      ``,
      `added:`,
      formatMatchDiffTiles(added),
      ``,
      `removed:`,
      removed.length === 0 ? "(none)" : removalLines.join("\n"),
      ``,
      `thisPassMatcherAccepted (unsolved only):`,
      matchResult.acceptedTiles.length === 0
        ? "(none)"
        : matchResult.acceptedTiles
            .map((tile) => {
              const text = input.tileTextById.get(tile.tileId) ?? tile.tileId;
              return `  - ${text} (${tile.tileId}) [${tile.span.start}-${tile.span.end}]`;
            })
            .join("\n"),
      ``,
      `preparePrior side-effects:`,
      prepareDropped.length === 0
        ? "(none)"
        : prepareDropped
            .map(
              (row) =>
                `  - ${row.tile.tileText} (${row.tile.tileId}): ${row.reason}`,
            )
            .join("\n"),
    ]);
  }

  logVoiceCommitPipeline("buildUiFinalSnapshot", {
    matcherAcceptedLength: matchResult.acceptedTiles.length,
    placedTilesLength: orderedTiles.length,
    placementDroppedTileIds: placementDrops.map((tile) => tile.id),
    orderedTileIds: orderedTiles.map((tile) => tile.id),
    spans: snapshot.spans,
  });

  return {
    snapshot,
    matchResult,
    placementState,
  };
}

export function puzzlePartsFromUiFinalSnapshot(
  snapshot: UiFinalSnapshot,
  pool: readonly PuzzlePart[],
  originalParts: readonly PuzzlePart[],
): PuzzlePart[] {
  const byId = new Map<string, PuzzlePart>();
  for (const part of originalParts) byId.set(part.id, part);
  for (const part of pool) byId.set(part.id, part);

  return snapshot.orderedTiles
    .map((tile) => byId.get(tile.id))
    .filter((part): part is PuzzlePart => !!part);
}

export function logUiFinalSnapshot(snapshot: UiFinalSnapshot): void {
  if (!voiceDebugEnabled()) return;
}
