/**
 * Normalized STT output for the Web Speech → decision → Deepgram retry layer.
 * Existing `SpeechEngine` callbacks stay unchanged; adapters map into this shape.
 */
export type SpeechRecognitionSource = "webspeech" | "deepgram";

export interface SpeechRecognitionResult {
  transcript: string;
  confidence?: number;
  source: SpeechRecognitionSource;
  isFinal: boolean;
}

export function speechRecognitionTranscript(
  result: SpeechRecognitionResult,
): string {
  return result.transcript;
}

export function fromWebSpeechResult(
  transcript: string,
  isFinal: boolean,
  confidence?: number,
): SpeechRecognitionResult {
  return {
    transcript,
    confidence,
    source: "webspeech",
    isFinal,
  };
}

export function fromDeepgramResult(
  transcript: string,
  isFinal: boolean,
  confidence?: number,
): SpeechRecognitionResult {
  return {
    transcript,
    confidence,
    source: "deepgram",
    isFinal,
  };
}
