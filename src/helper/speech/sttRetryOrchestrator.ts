import { transcribeAudio } from "@/helper/speech/adapters/deepgramTranscribeAdapter";
import { buildSpeechContextHints } from "@/helper/speech/speechContextHints";
import type { SpeechRecognitionResult } from "@/helper/speech/speechRecognitionResult";
import { resolveSttFallbackConfig, type SttFallbackConfig } from "@/helper/speech/sttConfig";
import {
  shouldRetryWithDeepgram,
  type SttRetryReason,
} from "@/helper/speech/sttDecision";
import {
  logSttRecognitionDiagnostics,
  type SttRecognitionDiagnostics,
  type SttRetryTriggerSource,
} from "@/helper/speech/sttDiagnostics";
import { recordRetry } from "@/helper/speech/sttAnalytics";
import { matchVoiceTiles } from "@/helper/voiceMatching/matchVoiceTiles";
import type { ConsumedSpan, VoiceTile } from "@/helper/voiceMatching/types";
import { normalizeText } from "@/helper/speech/normalizer";
import { tokenize } from "@/helper/speech/tokenizer";

export type ResolveTranscriptWithFallbackInput = {
  webSpeechResult: SpeechRecognitionResult;
  audioBlob?: Blob | null;
  expectedTiles: readonly VoiceTile[];
  transcriptTokens?: readonly string[];
  consumedSpans?: readonly ConsumedSpan[];
  lang?: string;
  config?: Partial<SttFallbackConfig>;
  retryTriggerSource?: SttRetryTriggerSource;
  reusedExistingRetry?: boolean;
  uploadedAudioBytes?: number;
  uploadedAudioDurationMs?: number;
  expectedPhrases?: readonly string[];
};

export type ResolveTranscriptWithFallbackOutput = {
  result: SpeechRecognitionResult;
  diagnostics: SttRecognitionDiagnostics;
};

function matcherAcceptedTileIds(
  result: SpeechRecognitionResult,
  expectedTiles: readonly VoiceTile[],
  transcriptTokens: readonly string[],
  consumedSpans?: readonly ConsumedSpan[],
): string[] {
  if (!result.isFinal || expectedTiles.length === 0) return [];

  const tokens =
    transcriptTokens.length > 0
      ? transcriptTokens
      : tokenize(normalizeText(result.transcript));

  if (tokens.length === 0) return [];

  const matcherResult = matchVoiceTiles({
    transcript: tokens,
    unsolvedTiles: expectedTiles,
    consumedSpans,
  });

  return matcherResult.acceptedTiles.map((tile) => tile.tileId);
}

/**
 * Web Speech → decision → optional Deepgram retry.
 * Returns a normalized result; downstream voice matching only sees `result.transcript`.
 */
export async function resolveTranscriptWithFallback(
  input: ResolveTranscriptWithFallbackInput,
): Promise<ResolveTranscriptWithFallbackOutput> {
  const config = resolveSttFallbackConfig(input.config);
  const retryStartedAt = performance.now();
  const webTranscript = input.webSpeechResult.transcript;

  const transcriptTokens =
    input.transcriptTokens ??
    tokenize(normalizeText(input.webSpeechResult.transcript));

  const acceptedBeforeRetry = matcherAcceptedTileIds(
    input.webSpeechResult,
    input.expectedTiles,
    transcriptTokens,
    input.consumedSpans,
  );

  const decision = shouldRetryWithDeepgram({
    transcript: input.webSpeechResult.transcript,
    confidence: input.webSpeechResult.confidence,
    isFinal: input.webSpeechResult.isFinal,
    expectedTiles: input.expectedTiles,
    transcriptTokens: input.transcriptTokens,
    consumedSpans: input.consumedSpans,
    config,
  });

  const infrastructureFields = {
    retryTriggerSource: input.retryTriggerSource,
    reusedExistingRetry: input.reusedExistingRetry,
    utteranceTranscript: webTranscript,
    uploadedAudioBytes: input.uploadedAudioBytes,
    uploadedAudioDurationMs: input.uploadedAudioDurationMs,
  };

  const baseDiagnostics: SttRecognitionDiagnostics = {
    engineUsed: input.webSpeechResult.source,
    confidence: input.webSpeechResult.confidence,
    retryDecision: decision.retry,
    retryReason: decision.reason,
    webTranscript,
    matcherAcceptedTileIdsBeforeRetry: acceptedBeforeRetry,
    retryDurationMs: performance.now() - retryStartedAt,
    ...infrastructureFields,
  };

  const expectedPhrases =
    input.expectedPhrases ??
    buildSpeechContextHints(input.expectedTiles).expectedPhrases;

  const retryAnalyticsBase = {
    webTranscript,
    confidence: input.webSpeechResult.confidence,
    expectedTiles: input.expectedTiles.map((tile) => ({
      id: tile.id,
      text: tile.text,
    })),
    speechContextHints: [...expectedPhrases],
    language: input.lang ?? "en-US",
    durationMs: input.uploadedAudioDurationMs,
  };

  if (!decision.retry) {
    recordRetry({
      ...retryAnalyticsBase,
      retryTriggered: false,
      retryReason: decision.reason,
    });
    logSttRecognitionDiagnostics(baseDiagnostics);
    return { result: input.webSpeechResult, diagnostics: baseDiagnostics };
  }

  if (!input.audioBlob) {
    recordRetry({
      ...retryAnalyticsBase,
      retryTriggered: true,
      retryReason: decision.reason,
    });
    logSttRecognitionDiagnostics({
      ...baseDiagnostics,
      retryDurationMs: performance.now() - retryStartedAt,
    });
    return { result: input.webSpeechResult, diagnostics: baseDiagnostics };
  }

  const deepgramStartedAt = performance.now();
  let deepgramResult: SpeechRecognitionResult;

  try {
    deepgramResult = await transcribeAudio(input.audioBlob, {
      lang: input.lang,
      expectedPhrases,
    });
  } catch {
    recordRetry({
      ...retryAnalyticsBase,
      retryTriggered: true,
      retryReason: decision.reason,
    });
    logSttRecognitionDiagnostics({
      ...baseDiagnostics,
      retryDurationMs: performance.now() - retryStartedAt,
    });
    return { result: input.webSpeechResult, diagnostics: baseDiagnostics };
  }

  const deepgramDurationMs = performance.now() - deepgramStartedAt;
  const deepgramTokens = tokenize(normalizeText(deepgramResult.transcript));
  const acceptedAfterRetry = matcherAcceptedTileIds(
    deepgramResult,
    input.expectedTiles,
    deepgramTokens,
    input.consumedSpans,
  );

  const diagnostics: SttRecognitionDiagnostics = {
    engineUsed: "deepgram",
    confidence: deepgramResult.confidence,
    retryDecision: true,
    retryReason: decision.reason as SttRetryReason,
    webTranscript,
    deepgramTranscript: deepgramResult.transcript,
    matcherAcceptedTileIdsBeforeRetry: acceptedBeforeRetry,
    matcherAcceptedTileIdsAfterRetry: acceptedAfterRetry,
    retryDurationMs: performance.now() - retryStartedAt,
    deepgramDurationMs,
    ...infrastructureFields,
  };

  logSttRecognitionDiagnostics(diagnostics);
  recordRetry({
    ...retryAnalyticsBase,
    deepgramTranscript: deepgramResult.transcript,
    retryTriggered: true,
    retryReason: decision.reason,
    confidence: deepgramResult.confidence,
  });
  return { result: deepgramResult, diagnostics };
}
