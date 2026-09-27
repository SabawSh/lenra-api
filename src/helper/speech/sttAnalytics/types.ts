import type { SpeechRecognitionSource } from "@/helper/speech/speechRecognitionResult";
import type { SttRetryReason } from "@/helper/speech/sttDecision";

export type SttTileSnapshot = {
  id: string;
  text: string;
};

export type SttRejectedTileSnapshot = SttTileSnapshot & {
  reason: string;
};

export type TokenAlignmentPair = {
  expected: string;
  observed: string;
  expectedIndex: number;
  observedIndex: number;
};

export type TokenAlignmentRecord = {
  expectedTokens: string[];
  observedTokens: string[];
  alignedPairs: TokenAlignmentPair[];
};

/** Full speech attempt — one record per final transcript + placement pass. */
export type SttAttemptEvent = {
  id: string;
  timestamp: number;
  expectedTiles: SttTileSnapshot[];
  unsolvedTiles: SttTileSnapshot[];
  webTranscript: string;
  deepgramTranscript?: string;
  engineUsed: SpeechRecognitionSource;
  confidence?: number;
  acceptedTiles: SttTileSnapshot[];
  rejectedTiles: SttRejectedTileSnapshot[];
  retryTriggered: boolean;
  retryReason?: SttRetryReason | null;
  speechContextHints: string[];
  browser: string;
  durationMs?: number;
  language: string;
  /** Normalized transcript that was tokenized for matching. */
  observedTranscript: string;
};

export type SttRetryEvent = {
  id: string;
  timestamp: number;
  webTranscript: string;
  deepgramTranscript?: string;
  retryTriggered: boolean;
  retryReason?: SttRetryReason | null;
  confidence?: number;
  expectedTiles: SttTileSnapshot[];
  speechContextHints: string[];
  browser: string;
  language: string;
  durationMs?: number;
};

export type SttAcceptedEvent = {
  id: string;
  timestamp: number;
  tile: SttTileSnapshot;
  attemptId?: string;
  alignment: TokenAlignmentRecord;
};

export type SttRejectedEvent = {
  id: string;
  timestamp: number;
  tile: SttRejectedTileSnapshot;
  attemptId?: string;
  alignment: TokenAlignmentRecord;
};

export type PhraseObservationConfidenceStats = {
  averageConfidence: number | null;
  minConfidence: number | null;
  maxConfidence: number | null;
};

/** Internal bucket — aggregated by (expectedPhrase, observedTranscript, engine, browser, language). */
export type PhraseObservationBucket = {
  observedTranscript: string;
  engine: SpeechRecognitionSource;
  browser: string;
  language: string;
  count: number;
} & PhraseObservationConfidenceStats;

/** Internal bucket — aggregated by (expectedToken, observedToken, engine, browser, language). */
export type TokenObservationBucket = {
  observedToken: string;
  engine: SpeechRecognitionSource;
  browser: string;
  language: string;
  count: number;
} & PhraseObservationConfidenceStats;

export type PhraseObservationVariant = {
  observedTranscript: string;
  probability: number;
  count: number;
  engine: SpeechRecognitionSource;
  browser: string;
  language: string;
  averageConfidence: number | null;
  minConfidence: number | null;
  maxConfidence: number | null;
};

export type PhraseObservationStats = {
  expectedPhrase: string;
  totalObservations: number;
  variants: PhraseObservationVariant[];
};

export type TokenObservationVariant = {
  observedToken: string;
  probability: number;
  count: number;
  engine: SpeechRecognitionSource;
  browser: string;
  language: string;
  averageConfidence: number | null;
  minConfidence: number | null;
  maxConfidence: number | null;
};

export type TokenObservationStats = {
  expectedToken: string;
  totalObservations: number;
  variants: TokenObservationVariant[];
};

export type TokenObservationInput = {
  expectedToken: string;
  observedToken: string;
  engine: SpeechRecognitionSource;
  browser: string;
  language: string;
  confidence?: number;
};

export type SttEngineStats = {
  engine: SpeechRecognitionSource;
  attempts: number;
  acceptances: number;
  rejections: number;
  phraseObservations: number;
};

export type SttBrowserStats = {
  browser: string;
  attempts: number;
  acceptances: number;
  rejections: number;
  phraseObservations: number;
};

export type SttAnalyticsSnapshot = {
  attempts: readonly SttAttemptEvent[];
  retries: readonly SttRetryEvent[];
  accepted: readonly SttAcceptedEvent[];
  rejected: readonly SttRejectedEvent[];
  phraseStats: readonly PhraseObservationStats[];
  tokenStats: readonly TokenObservationStats[];
  engineStats: readonly SttEngineStats[];
  browserStats: readonly SttBrowserStats[];
};

export type PhraseObservationInput = {
  expectedPhrase: string;
  observedTranscript: string;
  engine: SpeechRecognitionSource;
  browser: string;
  language: string;
  confidence?: number;
};

/**
 * Storage backend for STT analytics.
 * Swap for Supabase, Postgres, ClickHouse, etc. without touching the matcher.
 */
export interface SttAnalyticsStore {
  saveAttempt(event: SttAttemptEvent): void;
  saveRetry(event: SttRetryEvent): void;
  saveAccepted(event: SttAcceptedEvent): void;
  saveRejected(event: SttRejectedEvent): void;
  recordPhraseObservation(input: PhraseObservationInput): void;
  recordTokenObservation(input: TokenObservationInput): void;
  getPhraseObservationStats(expectedPhrase: string): PhraseObservationStats | undefined;
  getTokenObservationStats(expectedToken: string): TokenObservationStats | undefined;
  getEngineStats(): SttEngineStats[];
  getBrowserStats(): SttBrowserStats[];
  exportSnapshot(): SttAnalyticsSnapshot;
}

export type MatcherTokenObservationPair = {
  expectedToken: string;
  observedToken: string;
};

export type RecordSttAttemptInput = {
  expectedTiles: readonly SttTileSnapshot[];
  unsolvedTiles: readonly SttTileSnapshot[];
  webTranscript: string;
  deepgramTranscript?: string;
  engineUsed: SpeechRecognitionSource;
  confidence?: number;
  acceptedTiles: readonly SttTileSnapshot[];
  rejectedTiles: readonly SttRejectedTileSnapshot[];
  /** Matcher-confirmed token mismatches — the only source for token learning. */
  matcherTokenObservations?: readonly MatcherTokenObservationPair[];
  retryTriggered: boolean;
  retryReason?: SttRetryReason | null;
  speechContextHints: readonly string[];
  browser?: string;
  durationMs?: number;
  language: string;
  observedTranscript: string;
};

export type RecordRetryInput = {
  webTranscript: string;
  deepgramTranscript?: string;
  retryTriggered: boolean;
  retryReason?: SttRetryReason | null;
  confidence?: number;
  expectedTiles: readonly SttTileSnapshot[];
  speechContextHints: readonly string[];
  browser?: string;
  language: string;
  durationMs?: number;
};

export type RecordAcceptedInput = {
  tile: SttTileSnapshot;
  attemptId?: string;
  observedTranscript?: string;
};

export type RecordRejectedInput = {
  tile: SttRejectedTileSnapshot;
  attemptId?: string;
  observedTranscript?: string;
};
