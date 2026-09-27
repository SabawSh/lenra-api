export type {
  SpeechRecognitionResult,
  SpeechRecognitionSource,
} from "@/helper/speech/speechRecognitionResult";
export {
  fromDeepgramResult,
  fromWebSpeechResult,
  speechRecognitionTranscript,
} from "@/helper/speech/speechRecognitionResult";

export type { SttFallbackConfig } from "@/helper/speech/sttConfig";
export { resolveSttFallbackConfig } from "@/helper/speech/sttConfig";

export type {
  ShouldRetryWithDeepgramInput,
  ShouldRetryWithDeepgramResult,
  SttRetryReason,
} from "@/helper/speech/sttDecision";
export { shouldRetryWithDeepgram } from "@/helper/speech/sttDecision";

export type { SttRecognitionDiagnostics } from "@/helper/speech/sttDiagnostics";
export { logSttRecognitionDiagnostics } from "@/helper/speech/sttDiagnostics";

export type {
  ResolveTranscriptWithFallbackInput,
  ResolveTranscriptWithFallbackOutput,
} from "@/helper/speech/sttRetryOrchestrator";
export { resolveTranscriptWithFallback } from "@/helper/speech/sttRetryOrchestrator";

export type { DeepgramTranscribeOptions } from "@/helper/speech/adapters/deepgramTranscribeAdapter";
export { transcribeAudio } from "@/helper/speech/adapters/deepgramTranscribeAdapter";

export type {
  PhraseObservationStats,
  PhraseObservationVariant,
  RecordSttAttemptInput,
  SttAnalyticsSnapshot,
  SttAnalyticsStore,
  SttAttemptEvent,
  SttBrowserStats,
  SttEngineStats,
  SttTileSnapshot,
  TokenAlignmentRecord,
} from "@/helper/speech/sttAnalytics";
export {
  detectSttBrowserLabel,
  exportSnapshot,
  getBrowserStats,
  getEngineStats,
  getPhraseObservationStats,
  getSttAnalyticsSnapshot,
  getSttAnalyticsStore,
  recordAccepted,
  recordRejected,
  recordRetry,
  recordSttAttempt,
  setSttAnalyticsStore,
} from "@/helper/speech/sttAnalytics";
