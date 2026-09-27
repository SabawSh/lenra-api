/**
 * Headless voice-session state shared by production (sentenceBuilder) and
 * speech replay. Owns transcript accumulation + sticky placement only —
 * not matching/normalization/placement algorithms (those stay in their modules).
 */
import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import type { CaptionVocabularyEntry } from "@/helper/voiceMatching/captionAwareRecovery";
import type {
  MatchVoiceTilesResult,
} from "@/helper/voiceMatching/types";
import type {
  SessionPlacementState,
} from "@/helper/puzzel/sessionPlacementState";
import {
  createEmptySessionPlacementState,
} from "@/helper/puzzel/sessionPlacementState";
import type { UiFinalSnapshot } from "@/helper/puzzel/uiFinalSnapshot";
import type { PuzzlePart } from "@/types/puzzle";
import type { ShouldRetryWithDeepgramResult } from "@/helper/speech/sttDecision";

/** Production Web Speech → app entry event (mirrors useRealtimeSpeech callbacks). */
export type SpeechHypothesisEvent = {
  /** Event time offset ms within the voice session (0 = mic start). */
  t: number;
  type: "hypothesis";
  /** Raw engine transcript string (pre-normalize). */
  transcript: string;
  /**
   * Engine-final hypothesis flag — production `onSpeechHypothesis(..., isFinal)`.
   * When true, chunk is merged into sessionTranscript (same as live path).
   */
  isFinal: boolean;
  confidence?: number;
};

/** Authoritative final chunk — production `onTranscript(raw)`. */
export type SpeechTranscriptEvent = {
  t: number;
  type: "transcript";
  transcript: string;
  confidence?: number;
};

/**
 * Mic release — production `finalizeListening` retry gate.
 * Does not place tiles by itself; may be paired with `retry_transcript`.
 */
export type SpeechMicReleaseEvent = {
  t: number;
  type: "mic_release";
  /** Optional confidence for shouldRetryWithDeepgram. */
  confidence?: number;
};

/**
 * Simulated Deepgram prerecorded result after a retry decision.
 * Mirrors maybeRetryWithDeepgramAfterFinal when result.source === "deepgram".
 */
export type SpeechRetryTranscriptEvent = {
  t: number;
  type: "retry_transcript";
  transcript: string;
};

/** Explicit pause marker (ordering only; no pipeline work). */
export type SpeechPauseEvent = {
  t: number;
  type: "pause";
  durationMs?: number;
};

export type SpeechReplayEvent =
  | SpeechHypothesisEvent
  | SpeechTranscriptEvent
  | SpeechMicReleaseEvent
  | SpeechRetryTranscriptEvent
  | SpeechPauseEvent;

export type VoiceSessionCoreState = {
  sessionStamp: number;
  sessionTranscript: string;
  placement: SessionPlacementState;
  lastInterimCommitNorm: string;
  lastCommittedFinalKey: string;
  rapidFinal: { norm: string; sessionStamp: number; t: number };
  /** Latest UI snapshot after preview or final commit. */
  snapshot: UiFinalSnapshot | null;
  matchResult: MatchVoiceTilesResult | null;
  /** Whether a Deepgram retry has already been applied this session. */
  retried: boolean;
  /** Last rewritten transcript (traced only — not used for matching). */
  lastRewritten: string;
  lastNormalized: string;
};

export type VoiceSessionPuzzle = {
  voicePool: readonly PuzzlePart[];
  originalParts: readonly PuzzlePart[];
  /** Caption tokens for caption-aware merge (same as production). */
  captionTokens: readonly string[];
  /**
   * Caption vocabulary for CaptionAwareRecovery (pre-matcher).
   * Built once per exercise from caption ∩ tile phrases.
   */
  captionVocabulary?: readonly CaptionVocabularyEntry[];
  tokenMatchLexicon?: VoiceMatchLexicon;
};

export type VoiceSessionStepKind =
  | "hypothesis_preview"
  | "hypothesis_skipped"
  | "transcript_final"
  | "transcript_skipped"
  | "retry_final"
  | "retry_skipped"
  | "mic_release"
  | "pause";

export type VoiceSessionStepResult = {
  kind: VoiceSessionStepKind;
  state: VoiceSessionCoreState;
  snapshot: UiFinalSnapshot | null;
  matchResult: MatchVoiceTilesResult | null;
  normalized: string;
  rewritten: string;
  /** Full transcript string fed into the latest placement (preview merge or final). */
  placementTranscript: string;
  retryDecision?: ShouldRetryWithDeepgramResult;
  note?: string;
};

export function createInitialVoiceSessionState(
  sessionStamp = 1,
): VoiceSessionCoreState {
  return {
    sessionStamp,
    sessionTranscript: "",
    placement: createEmptySessionPlacementState(),
    lastInterimCommitNorm: "",
    lastCommittedFinalKey: "",
    rapidFinal: { norm: "", sessionStamp: 0, t: 0 },
    snapshot: null,
    matchResult: null,
    retried: false,
    lastRewritten: "",
    lastNormalized: "",
  };
}
