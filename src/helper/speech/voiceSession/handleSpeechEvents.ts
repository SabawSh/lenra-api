/**
 * Shared speech-event → placement pipeline.
 *
 * Production (sentenceBuilder) and speech replay MUST call these handlers so
 * there is a single code path after an engine event enters the system.
 *
 * Does not reimplement normalize / match / place — only orchestrates the same
 * calls production already makes.
 */
import { normalizeText } from "@/helper/speech/normalizer";
import { rewriteSpeechTextWithKnownNames } from "@/helper/speech/specificNames";
import { tokenize } from "@/helper/speech/tokenizer";
import { mergeTranscriptWithOverlap } from "@/helper/speech/mergeTranscriptWithOverlap";
import {
  shouldRetryWithDeepgram,
  type ShouldRetryWithDeepgramResult,
} from "@/helper/speech/sttDecision";
import { buildUiFinalSnapshot } from "@/helper/puzzel/uiFinalSnapshot";
import {
  recoverCaptionVocabulary,
} from "@/helper/voiceMatching/captionAwareRecovery";
import type {
  VoiceSessionCoreState,
  VoiceSessionPuzzle,
  VoiceSessionStepResult,
} from "./types";

/** Shared with pipeline fingerprint — do not change without bumping config digest. */
export const RAPID_FINAL_DEDUPE_MS = 480;

function mergeWithCaption(
  previous: string,
  next: string,
  captionTokens: readonly string[],
): string {
  return mergeTranscriptWithOverlap(previous, next, { captionTokens });
}

/**
 * Normalizer → CaptionAwareRecovery → tokens for Matcher.
 * Matcher never sees the raw unrecovered transcript.
 */
function recoverTranscriptForMatcher(
  puzzle: VoiceSessionPuzzle,
  normalizedTranscript: string,
): string {
  const vocabulary = puzzle.captionVocabulary;
  if (!vocabulary || vocabulary.length === 0) {
    return normalizedTranscript.trim();
  }
  const { recoveredTranscript } = recoverCaptionVocabulary({
    transcript: normalizedTranscript,
    captionVocabulary: vocabulary,
    captionTokens: puzzle.captionTokens,
  });
  return recoveredTranscript.trim();
}

function mergeSessionTranscript(
  state: VoiceSessionCoreState,
  puzzle: VoiceSessionPuzzle,
  normalizedRaw: string,
): VoiceSessionCoreState {
  const chunk = normalizedRaw.trim();
  if (!chunk) return state;
  const prevAccum = state.sessionTranscript;
  const sessionTranscript = prevAccum
    ? mergeWithCaption(prevAccum, chunk, puzzle.captionTokens)
    : chunk;
  return { ...state, sessionTranscript };
}

/** Exported for production sentenceBuilder sync (same merge as live path). */
export { mergeSessionTranscript as mergeVoiceSessionTranscript };

function tileTextByIdMap(puzzle: VoiceSessionPuzzle): Map<string, string> {
  return new Map(puzzle.voicePool.map((part) => [part.id, part.text]));
}

/**
 * Production `previewVoiceSnapshot` — commitmentLevel "preview", sticky prior.
 */
export function previewVoiceSnapshot(
  state: VoiceSessionCoreState,
  puzzle: VoiceSessionPuzzle,
  interimNormalized: string,
  matchDiffMeta?: {
    hypothesisFinal?: boolean;
    confidence?: number;
    rawEngineTranscript?: string;
  },
): VoiceSessionCoreState {
  const original = puzzle.originalParts;
  if (original.length === 0) return state;

  const base = state.sessionTranscript;
  const previewTranscript = base
    ? mergeWithCaption(base, interimNormalized, puzzle.captionTokens)
    : interimNormalized;
  const recovered = recoverTranscriptForMatcher(puzzle, previewTranscript);
  const tokens = tokenize(recovered);
  if (!tokens.length) return state;

  const { snapshot, placementState, matchResult } = buildUiFinalSnapshot({
    sessionId: state.sessionStamp,
    utteranceKey: `preview:${recovered}`,
    transcriptTokens: tokens,
    voicePool: puzzle.voicePool,
    originalParts: original,
    tileTextById: tileTextByIdMap(puzzle),
    priorPlacement: state.placement,
    tokenMatchLexicon: puzzle.tokenMatchLexicon,
    commitmentLevel: "preview",
    matchDiffMeta: {
      hypothesisFinal: matchDiffMeta?.hypothesisFinal ?? false,
      confidence: matchDiffMeta?.confidence,
      rawEngineTranscript: matchDiffMeta?.rawEngineTranscript,
      afterNormalize: interimNormalized,
      afterRecovery: recovered,
    },
  });

  return {
    ...state,
    placement: placementState,
    snapshot,
    matchResult,
  };
}

/**
 * Production `commitVoiceFinalSnapshot` — commitmentLevel "final", sticky prior.
 * Omits React/analytics side effects; callers may record analytics separately.
 */
export function commitVoiceFinalSnapshot(
  state: VoiceSessionCoreState,
  puzzle: VoiceSessionPuzzle,
  normalizedRaw: string,
): VoiceSessionCoreState {
  const normalizedTranscript = normalizedRaw.trim();
  if (!normalizedTranscript) return state;

  const recovered = recoverTranscriptForMatcher(puzzle, normalizedTranscript);
  const utteranceKey = `${state.sessionStamp}:${recovered}`;
  if (state.lastCommittedFinalKey === utteranceKey) return state;

  const tokens = tokenize(recovered);
  if (!tokens.length) return state;

  const original = puzzle.originalParts;
  if (original.length === 0) return state;

  const { snapshot, matchResult, placementState } = buildUiFinalSnapshot({
    sessionId: state.sessionStamp,
    utteranceKey: recovered,
    transcriptTokens: tokens,
    voicePool: puzzle.voicePool,
    originalParts: original,
    tileTextById: tileTextByIdMap(puzzle),
    priorPlacement: state.placement,
    tokenMatchLexicon: puzzle.tokenMatchLexicon,
    commitmentLevel: "final",
    matchDiffMeta: {
      hypothesisFinal: true,
      afterNormalize: normalizedTranscript,
      afterRecovery: recovered,
    },
  });

  return {
    ...state,
    lastCommittedFinalKey: utteranceKey,
    placement: placementState,
    snapshot,
    matchResult,
  };
}

function stepResult(
  kind: VoiceSessionStepResult["kind"],
  state: VoiceSessionCoreState,
  extras: Partial<VoiceSessionStepResult> = {},
): VoiceSessionStepResult {
  return {
    kind,
    state,
    snapshot: state.snapshot,
    matchResult: state.matchResult,
    normalized: state.lastNormalized,
    rewritten: state.lastRewritten,
    placementTranscript: state.sessionTranscript,
    ...extras,
  };
}

/**
 * Production `onSpeechHypothesis` core (after UI-only gates).
 * normalize → rewrite(traced) → merge key → optional session merge → preview.
 */
export function handleSpeechHypothesis(
  state: VoiceSessionCoreState,
  puzzle: VoiceSessionPuzzle,
  input: {
    text: string;
    hypothesisFinal: boolean;
    /** Speak-through mode skips preview placement (production behavior). */
    skipPreview?: boolean;
    confidence?: number;
  },
): VoiceSessionStepResult {
  const normalized = normalizeText(input.text).trim();
  const rewritten = rewriteSpeechTextWithKnownNames(normalized);
  let next: VoiceSessionCoreState = {
    ...state,
    lastNormalized: normalized,
    lastRewritten: rewritten,
  };

  if (!normalized) {
    return stepResult("hypothesis_skipped", next, {
      note: "empty after normalize",
      normalized,
      rewritten,
    });
  }

  const prevAccum = next.sessionTranscript;
  const fullText = prevAccum
    ? mergeWithCaption(prevAccum, normalized, puzzle.captionTokens)
    : normalized;

  if (fullText === next.lastInterimCommitNorm) {
    return stepResult("hypothesis_skipped", next, {
      note: "duplicate interim merge key",
      normalized,
      rewritten,
      placementTranscript: fullText,
    });
  }

  next = { ...next, lastInterimCommitNorm: fullText };

  if (input.hypothesisFinal) {
    next = mergeSessionTranscript(next, puzzle, normalized);
  }

  if (input.skipPreview) {
    return stepResult("hypothesis_skipped", next, {
      note: "preview skipped by caller",
      normalized,
      rewritten,
      placementTranscript: fullText,
    });
  }

  next = previewVoiceSnapshot(next, puzzle, normalized, {
    hypothesisFinal: input.hypothesisFinal,
    confidence: input.confidence,
    rawEngineTranscript: input.text,
  });

  return stepResult("hypothesis_preview", next, {
    normalized,
    rewritten,
    placementTranscript: fullText,
  });
}

/**
 * Production `onTranscript` core (after speak-through / blob side effects).
 * rapid-dedupe → merge sessionTranscript → commit final snapshot.
 */
export function handleSpeechTranscript(
  state: VoiceSessionCoreState,
  puzzle: VoiceSessionPuzzle,
  input: {
    raw: string;
    /** Injected clock — production Date.now(); replay uses event.t */
    nowMs: number;
    /** Speak-through merges but does not commit placement. */
    skipCommit?: boolean;
  },
): VoiceSessionStepResult {
  let next: VoiceSessionCoreState = {
    ...state,
    lastInterimCommitNorm: "",
  };

  const normalizedRaw = normalizeText(input.raw).trim();
  const rewritten = rewriteSpeechTextWithKnownNames(normalizedRaw);
  next = {
    ...next,
    lastNormalized: normalizedRaw,
    lastRewritten: rewritten,
  };

  const prev = next.rapidFinal;
  const isRapidEngineDuplicate =
    prev.norm === normalizedRaw &&
    prev.sessionStamp === next.sessionStamp &&
    input.nowMs - prev.t < RAPID_FINAL_DEDUPE_MS;

  if (isRapidEngineDuplicate) {
    return stepResult("transcript_skipped", next, {
      note: "rapid engine duplicate final",
      normalized: normalizedRaw,
      rewritten,
    });
  }

  next = {
    ...next,
    rapidFinal: {
      norm: normalizedRaw,
      sessionStamp: next.sessionStamp,
      t: input.nowMs,
    },
  };

  if (!normalizedRaw) {
    return stepResult("transcript_skipped", next, {
      note: "empty after normalize",
      normalized: normalizedRaw,
      rewritten,
    });
  }

  next = mergeSessionTranscript(next, puzzle, normalizedRaw);

  if (input.skipCommit) {
    return stepResult("transcript_skipped", next, {
      note: "commit skipped by caller",
      normalized: normalizedRaw,
      rewritten,
      placementTranscript: next.sessionTranscript,
    });
  }

  next = commitVoiceFinalSnapshot(next, puzzle, next.sessionTranscript);

  return stepResult("transcript_final", next, {
    normalized: normalizedRaw,
    rewritten,
    placementTranscript: next.sessionTranscript,
  });
}

/**
 * Production mic-release retry decision (shouldRetryWithDeepgram only).
 * Does not call Deepgram — replay supplies retry_transcript separately.
 */
export function evaluateSpeechRetry(
  state: VoiceSessionCoreState,
  puzzle: VoiceSessionPuzzle,
  confidence?: number,
): ShouldRetryWithDeepgramResult {
  if (state.retried) {
    return { retry: false, reason: null };
  }

  const transcriptForRetry = state.sessionTranscript.trim();
  const expectedTiles = puzzle.voicePool.map((part) => ({
    id: part.id,
    text: part.text,
  }));
  const consumedSpans = state.snapshot?.spans ?? [];
  const recovered = recoverTranscriptForMatcher(puzzle, transcriptForRetry);
  const tokens = tokenize(normalizeText(recovered));

  return shouldRetryWithDeepgram({
    transcript: recovered,
    confidence,
    isFinal: true,
    expectedTiles,
    transcriptTokens: tokens,
    consumedSpans,
  });
}

/**
 * Production Deepgram retry apply path:
 * mergeSessionTranscript(deepgramNorm) → commitVoiceFinalSnapshot(sessionTranscript).
 */
export function handleRetryTranscript(
  state: VoiceSessionCoreState,
  puzzle: VoiceSessionPuzzle,
  deepgramRaw: string,
): VoiceSessionStepResult {
  if (state.retried) {
    return stepResult("retry_skipped", state, {
      note: "already retried this session",
    });
  }

  const deepgramNorm = normalizeText(deepgramRaw).trim();
  const rewritten = rewriteSpeechTextWithKnownNames(deepgramNorm);
  let next: VoiceSessionCoreState = {
    ...state,
    lastNormalized: deepgramNorm,
    lastRewritten: rewritten,
  };

  if (!deepgramNorm) {
    return stepResult("retry_skipped", next, {
      note: "empty deepgram transcript",
      normalized: deepgramNorm,
      rewritten,
    });
  }

  next = { ...next, retried: true };
  next = mergeSessionTranscript(next, puzzle, deepgramNorm);
  next = commitVoiceFinalSnapshot(next, puzzle, next.sessionTranscript);

  return stepResult("retry_final", next, {
    normalized: deepgramNorm,
    rewritten,
    placementTranscript: next.sessionTranscript,
  });
}

/**
 * Commit an already-accumulated session transcript (production commitVoiceFinalSnapshot).
 * Used when the caller merged separately (legacy) or after speak-through gates.
 */
export function commitAccumulatedTranscript(
  state: VoiceSessionCoreState,
  puzzle: VoiceSessionPuzzle,
  normalizedAccumulated: string,
): VoiceSessionStepResult {
  const next = commitVoiceFinalSnapshot(state, puzzle, normalizedAccumulated);
  return stepResult("transcript_final", next, {
    normalized: state.lastNormalized,
    rewritten: state.lastRewritten,
    placementTranscript: next.sessionTranscript || normalizedAccumulated,
  });
}

export function handleMicRelease(
  state: VoiceSessionCoreState,
  puzzle: VoiceSessionPuzzle,
  confidence?: number,
): VoiceSessionStepResult {
  const decision = evaluateSpeechRetry(state, puzzle, confidence);
  return stepResult("mic_release", state, {
    retryDecision: decision,
    note: decision.retry
      ? `retry recommended: ${decision.reason}`
      : "retry not recommended",
  });
}
