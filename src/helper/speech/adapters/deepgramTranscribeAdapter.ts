import { fromDeepgramResult } from "@/helper/speech/speechRecognitionResult";
import type { SpeechRecognitionResult } from "@/helper/speech/speechRecognitionResult";
import { logSpeechContextHintsDebug } from "@/helper/speech/speechContextHints";

export type DeepgramTranscribeOptions = {
  lang?: string;
  filename?: string;
  expectedPhrases?: readonly string[];
};

export type DeepgramTranscribeResponse = {
  transcript: string;
  confidence?: number;
};

/**
 * Prerecorded Deepgram transcription for STT fallback retries.
 * Not wired into live Safari streaming — call only from the retry orchestrator.
 */
export async function transcribeAudio(
  audioBlob: Blob,
  options: DeepgramTranscribeOptions = {},
): Promise<SpeechRecognitionResult> {
  const formData = new FormData();
  formData.append("audio", audioBlob, options.filename ?? "recording.webm");
  const mimeType = audioBlob.type || "audio/webm";
  formData.append("mimetype", mimeType);
  if (options.lang) {
    formData.append("lang", options.lang);
  }
  if (options.expectedPhrases?.length) {
    formData.append(
      "expectedPhrases",
      JSON.stringify([...options.expectedPhrases]),
    );
    logSpeechContextHintsDebug(
      { expectedPhrases: [...options.expectedPhrases] },
      options.expectedPhrases,
    );
  }

  const response = await fetch("/api/speech/deepgram/transcribe", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Deepgram transcribe failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const payload = (await response.json()) as DeepgramTranscribeResponse;
  const transcript = payload.transcript?.trim() ?? "";

  return fromDeepgramResult(transcript, true, payload.confidence);
}
