import type { SpeechContextHints } from "@/helper/speech/speechContextHints";

export type SpeechEngineStartOptions = {
  speechContextHints?: SpeechContextHints;
  /**
   * Canonical puzzle caption tokens for session-level merge elsewhere.
   * Web Speech hypothesis rebuild must NOT use these — transcript order is
   * engine emission order only (see {@link buildWebSpeechHypothesisFromResults}).
   */
  captionTokens?: readonly string[];
};

/**
 * Engine-agnostic speech recognition contract.
 *
 * Every adapter (Web Speech, Whisper-WASM, Deepgram, Azure) implements this
 * exact shape so `useRealtimeSpeech` and `sentenceBuilder` never learn which
 * engine is running. Phase 2 / Phase 3 swaps are pure adapter additions.
 */

export type SpeechEngineCallbacks = {
  /** Stable final chunk recognized as the learner's "try". */
  onTranscript: (transcript: string) => void;
  /** Live hypothesis for instant UI updates. `isFinal` true on stable chunks. */
  onSpeechHypothesis?: (
    text: string,
    isFinal: boolean,
    confidence?: number,
  ) => void;
  onEnd?: () => void;
  onError?: (err: SpeechEngineError) => void;
  /** Whisper-style engines surface model download / warm-up progress here. */
  onLoadingProgress?: (info: SpeechEngineLoadingInfo) => void;
};

/**
 * Stable error codes so the hook can react without sniffing engine-specific
 * shapes. Adapters translate their native errors into these.
 */
export type SpeechEngineErrorCode =
  | "unsupported"
  | "mic_denied"
  | "not_allowed"
  | "network"
  | "audio_capture"
  | "model_load_failed"
  | "aborted"
  | "no_speech"
  | "unknown";

export type SpeechEngineError = {
  code: SpeechEngineErrorCode;
  /** Optional engine-specific message for logs (never user-facing). */
  detail?: string;
};

export type SpeechEngineLoadingPhase =
  | "idle"
  | "downloading_model"
  | "warming_up"
  | "ready";

export type SpeechEngineLoadingInfo = {
  phase: SpeechEngineLoadingPhase;
  /** 0..1 when `phase === "downloading_model"`, otherwise undefined. */
  progress?: number;
  /** Bytes downloaded so far (Whisper download UX). */
  loaded?: number;
  /** Total bytes to download (Whisper download UX). */
  total?: number;
};

export type SpeechEngineKind =
  | "web-speech"
  | "whisper-wasm"
  | "deepgram"
  | "azure";

export type SpeechEngineCapabilities = {
  /**
   * True when the engine streams interim results suitable for sub-second
   * tile placement (Web Speech, Deepgram, Azure). False for chunk-based
   * engines (Whisper WASM): UI should debounce more aggressively.
   */
  realtimeInterim: boolean;
  /**
   * True when the engine returns calibrated per-word confidence we can fold
   * into scoring. Web Speech's "confidence" is unreliable so it's false.
   */
  perWordConfidence: boolean;
  /**
   * True when the engine produces phoneme-level pronunciation scores. Only
   * Azure Pronunciation Assessment ticks this in our roadmap.
   */
  pronunciationAssessment: boolean;
};

export type SpeechEngineLifecycle =
  | "idle"
  | "loading"
  | "listening"
  | "stopped";

export interface SpeechEngine {
  readonly kind: SpeechEngineKind;
  readonly capabilities: SpeechEngineCapabilities;

  /**
   * Begin capturing and streaming results to the supplied callbacks.
   * For chunk-based engines this also triggers (cached) model load.
   */
  start(
    callbacks: SpeechEngineCallbacks,
    lang: string,
    options?: SpeechEngineStartOptions,
  ): Promise<void> | void;

  /** Tear down recognition; safe to call when already stopped. */
  stop(): void;

  /**
   * Deliver any pending debounced finals (e.g. Web Speech coalescer).
   * No-op for engines that don't buffer.
   */
  flush?(): void;

  /** Warm up model/worker ahead of first `start()` when supported. */
  preload?(): Promise<void> | void;

  /** Optional hard teardown for full engine reset. */
  dispose?(): void;
}
