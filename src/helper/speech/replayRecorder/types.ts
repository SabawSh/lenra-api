/**
 * Production speech flight recorder — observes only.
 * Does not drive matching, placement, or normalization.
 */
import type { PlacementCommitmentLevel } from "@/helper/voiceMatching/types";
import type { SpeechRecognitionSource } from "@/helper/speech/speechRecognitionResult";
import type { SttRetryReason } from "@/helper/speech/sttDecision";

export type ReplayRecorderEngine = SpeechRecognitionSource | "whisper" | "unknown";

export type ProductionSpeechSessionMeta = {
  sessionId: string;
  createdFrom: "production";
  browser: string;
  platform: string;
  locale: string;
  engine: ReplayRecorderEngine;
  /** ISO start time */
  startedAt: string;
  appVersion: string;
  exerciseId?: string;
  captionId?: string;
  caption: string;
  expectedSentence: string;
  tiles: readonly { id: string; text: string }[];
  movie?: string;
  notes?: string;
};

export type RecordedCommitmentLevel = PlacementCommitmentLevel | "none";

/**
 * One observed production event after the speech pipeline handled it.
 * Timestamps are ms relative to session start (mic arm).
 */
export type ProductionSpeechRecordedEvent = {
  t: number;
  type:
    | "hypothesis"
    | "transcript"
    | "pause"
    | "mic_release"
    | "retry_transcript"
    | "session_end";
  transcript?: string;
  isFinal?: boolean;
  engine?: ReplayRecorderEngine;
  confidence?: number;
  durationMs?: number;
  /** Accepted tile ids after this event (from UI snapshot). */
  acceptedTileIds: string[];
  /** Ordered tile texts after this event. */
  orderedTileTexts: string[];
  snapshotUtteranceKey?: string;
  commitmentLevel: RecordedCommitmentLevel;
  sessionTranscript: string;
  retryTriggered?: boolean;
  retryReason?: SttRetryReason | null;
  /** Optional note (skip reasons, etc.). */
  note?: string;
};

export type ProductionSpeechFailureFlags = {
  zeroAcceptedTiles: boolean;
  retryTriggered: boolean;
  lowConfidence: boolean;
  matcherRejectedTranscript: boolean;
  userAbandoned: boolean;
  incompleteVsExpected: boolean;
};

export type ProductionSpeechRecording = {
  meta: ProductionSpeechSessionMeta;
  events: ProductionSpeechRecordedEvent[];
  failure: ProductionSpeechFailureFlags;
  /** Absolute wall-clock ms at session start (for debugging). */
  wallClockStartMs: number;
  endedAt?: string;
  /** Final accepted tile ids at session_end. */
  finalAcceptedTileIds: string[];
  finalSentence: string;
};
