import type { SpeechRecognitionResult } from "./speechRecognitionResult";
import { resolveSttFallbackConfig } from "./sttConfig";
import type { SttRetryReason } from "./sttDecision";

export type SttRetryTriggerSource = "onTranscript" | "finalizeListening";

export type SttRecognitionDiagnostics = {
  engineUsed: SpeechRecognitionResult["source"];
  confidence?: number;
  retryDecision: boolean;
  retryReason: SttRetryReason | null;
  webTranscript: string;
  deepgramTranscript?: string;
  matcherAcceptedTileIdsBeforeRetry: string[];
  matcherAcceptedTileIdsAfterRetry?: string[];
  retryDurationMs?: number;
  deepgramDurationMs?: number;
  retryTriggerSource?: SttRetryTriggerSource;
  reusedExistingRetry?: boolean;
  utteranceTranscript?: string;
  uploadedAudioBytes?: number;
  uploadedAudioDurationMs?: number;
};

export type SttRetryInfrastructureLog = {
  retryTriggerSource: SttRetryTriggerSource;
  reusedExistingRetry: boolean;
  utteranceTranscript: string;
  uploadedAudioBytes?: number;
  uploadedAudioDurationMs?: number;
  deepgramTranscript?: string;
};

export function logSttRetryInfrastructure(log: SttRetryInfrastructureLog): void {
}

export function logSttRecognitionDiagnostics(
  diagnostics: SttRecognitionDiagnostics,
): void {
  const config = resolveSttFallbackConfig();
  if (!config.debug) return;

}
