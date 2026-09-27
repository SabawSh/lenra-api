import { resolveSttFallbackConfig } from "@/helper/speech/sttConfig";
import { buildAnalyticsTokenAlignment } from "./sttAnalytics/alignment";
import {
  createEventId,
  createInMemorySttAnalyticsStore,
  type InMemorySttAnalyticsStore,
} from "./sttAnalytics/memoryStore";
import type {
  PhraseObservationStats,
  RecordAcceptedInput,
  RecordRejectedInput,
  RecordRetryInput,
  RecordSttAttemptInput,
  SttAnalyticsSnapshot,
  SttAnalyticsStore,
  SttAttemptEvent,
  SttBrowserStats,
  SttEngineStats,
  SttRetryEvent,
  TokenAlignmentRecord,
  TokenObservationInput,
  TokenObservationStats,
} from "./sttAnalytics/types";

export type {
  PhraseObservationStats,
  PhraseObservationVariant,
  RecordAcceptedInput,
  RecordRejectedInput,
  RecordRetryInput,
  RecordSttAttemptInput,
  SttAnalyticsSnapshot,
  SttAnalyticsStore,
  SttAttemptEvent,
  SttBrowserStats,
  SttEngineStats,
  SttRejectedTileSnapshot,
  SttRetryEvent,
  SttTileSnapshot,
  TokenAlignmentPair,
  TokenAlignmentRecord,
  TokenObservationInput,
  TokenObservationStats,
  TokenObservationVariant,
} from "./sttAnalytics/types";

export { collectMatcherTokenObservationPairs } from "./sttAnalytics/matcherTokenObservations";
export { InMemorySttAnalyticsStore } from "./sttAnalytics/memoryStore";

let activeStore: SttAnalyticsStore = createInMemorySttAnalyticsStore();

/** Replace the analytics backend (e.g. Supabase, Postgres) without touching the matcher. */
export function setSttAnalyticsStore(store: SttAnalyticsStore): void {
  activeStore = store;
}

export function getSttAnalyticsStore(): SttAnalyticsStore {
  return activeStore;
}

/** @deprecated Use exportSnapshot() — kept for existing callers. */
export function getSttAnalyticsSnapshot(): SttAnalyticsSnapshot {
  return exportSnapshot();
}

export function exportSnapshot(): SttAnalyticsSnapshot {
  return activeStore.exportSnapshot();
}

export function getPhraseObservationStats(
  expectedPhrase: string,
): PhraseObservationStats | undefined {
  return activeStore.getPhraseObservationStats(expectedPhrase);
}

export function getTokenObservationStats(
  expectedToken: string,
): TokenObservationStats | undefined {
  return activeStore.getTokenObservationStats(expectedToken);
}

export function getEngineStats(): SttEngineStats[] {
  return activeStore.getEngineStats();
}

export function getBrowserStats(): SttBrowserStats[] {
  return activeStore.getBrowserStats();
}

/** Client-safe browser label for analytics dimensions. */
export function detectSttBrowserLabel(): string {
  if (typeof navigator === "undefined") return "unknown";

  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "edge";
  if (/CriOS/.test(ua)) return "chrome-ios";
  if (/Chrome\//.test(ua)) return "chrome";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

function emptyAlignment(): TokenAlignmentRecord {
  return {
    expectedTokens: [],
    observedTokens: [],
    alignedPairs: [],
  };
}

function recordPhraseObservationsForUnsolved(
  unsolvedTiles: readonly { text: string }[],
  observedTranscript: string,
  engine: SttAttemptEvent["engineUsed"],
  browser: string,
  language: string,
  confidence?: number,
): void {
  for (const tile of unsolvedTiles) {
    activeStore.recordPhraseObservation({
      expectedPhrase: tile.text,
      observedTranscript,
      engine,
      browser,
      language,
      confidence,
    });

  }
}

function recordMatcherTokenObservations(
  pairs: readonly { expectedToken: string; observedToken: string }[],
  engine: SttAttemptEvent["engineUsed"],
  browser: string,
  language: string,
  confidence?: number,
): void {
  for (const pair of pairs) {
    activeStore.recordTokenObservation({
      expectedToken: pair.expectedToken,
      observedToken: pair.observedToken,
      engine,
      browser,
      language,
      confidence,
    });
  }
}

export function logSttAnalyticsDebug(event: SttAttemptEvent): void {
  if (!resolveSttFallbackConfig().debug) return;

}

function logSttRetryAnalyticsDebug(event: SttRetryEvent): void {
  if (!resolveSttFallbackConfig().debug) return;

}

/**
 * Record a full speech attempt after final transcript + placement.
 * Write-only — never read by matching logic.
 */
export function recordSttAttempt(input: RecordSttAttemptInput): SttAttemptEvent {
  const attemptId = createEventId("attempt");
  const browser = input.browser ?? detectSttBrowserLabel();
  const event: SttAttemptEvent = {
    id: attemptId,
    timestamp: Date.now(),
    expectedTiles: [...input.expectedTiles],
    unsolvedTiles: [...input.unsolvedTiles],
    webTranscript: input.webTranscript,
    deepgramTranscript: input.deepgramTranscript,
    engineUsed: input.engineUsed,
    confidence: input.confidence,
    acceptedTiles: [...input.acceptedTiles],
    rejectedTiles: [...input.rejectedTiles],
    retryTriggered: input.retryTriggered,
    retryReason: input.retryReason,
    speechContextHints: [...input.speechContextHints],
    browser,
    durationMs: input.durationMs,
    language: input.language,
    observedTranscript: input.observedTranscript,
  };

  activeStore.saveAttempt(event);

  for (const tile of input.acceptedTiles) {
    recordAccepted({
      tile,
      attemptId,
      observedTranscript: input.observedTranscript,
    });
  }

  for (const tile of input.rejectedTiles) {
    recordRejected({
      tile,
      attemptId,
      observedTranscript: input.observedTranscript,
    });
  }

  recordPhraseObservationsForUnsolved(
    input.unsolvedTiles,
    input.observedTranscript,
    input.engineUsed,
    browser,
    input.language,
    input.confidence,
  );

  if (input.matcherTokenObservations && input.matcherTokenObservations.length > 0) {
    recordMatcherTokenObservations(
      input.matcherTokenObservations,
      input.engineUsed,
      browser,
      input.language,
      input.confidence,
    );
  }

  logSttAnalyticsDebug(event);
  return event;
}

/** Record a Deepgram retry decision (or non-retry outcome). Write-only. */
export function recordRetry(input: RecordRetryInput): SttRetryEvent {
  const event: SttRetryEvent = {
    id: createEventId("retry"),
    timestamp: Date.now(),
    webTranscript: input.webTranscript,
    deepgramTranscript: input.deepgramTranscript,
    retryTriggered: input.retryTriggered,
    retryReason: input.retryReason,
    confidence: input.confidence,
    expectedTiles: [...input.expectedTiles],
    speechContextHints: [...input.speechContextHints],
    browser: input.browser ?? detectSttBrowserLabel(),
    language: input.language,
    durationMs: input.durationMs,
  };

  activeStore.saveRetry(event);
  logSttRetryAnalyticsDebug(event);
  return event;
}

/** Record a single accepted tile. Write-only. */
export function recordAccepted(input: RecordAcceptedInput): void {
  const alignment = input.observedTranscript
    ? buildAnalyticsTokenAlignment(input.tile.text, input.observedTranscript)
    : emptyAlignment();

  activeStore.saveAccepted({
    id: createEventId("accepted"),
    timestamp: Date.now(),
    tile: input.tile,
    attemptId: input.attemptId,
    alignment,
  });
}

/** Record a single rejected tile. Write-only. */
export function recordRejected(input: RecordRejectedInput): void {
  const alignment = input.observedTranscript
    ? buildAnalyticsTokenAlignment(input.tile.text, input.observedTranscript)
    : emptyAlignment();

  activeStore.saveRejected({
    id: createEventId("rejected"),
    timestamp: Date.now(),
    tile: input.tile,
    attemptId: input.attemptId,
    alignment,
  });
}
