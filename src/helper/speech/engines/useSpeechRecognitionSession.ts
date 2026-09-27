"use client";

import type { SpeechContextHints } from "@/helper/speech/speechContextHints";
import { pushSpeechChainTrace } from "@/helper/speech/speechChainTrace";
import type {
  SpeechEngine,
  SpeechEngineError,
  SpeechEngineKind,
  SpeechEngineLoadingInfo,
  SpeechEngineStartOptions,
} from "./types";
import type React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type VoiceAvailabilityError =
  | "unsupported"
  | "mic_denied"
  | "not_allowed"
  | "network"
  | "model_load_failed";

export type UseSpeechRecognitionSessionReturn = {
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  listeningEnabledRef: React.MutableRefObject<boolean>;
  voiceAvailabilityError: VoiceAvailabilityError | null;
  engineKind: SpeechEngineKind | null;
  loadingInfo: SpeechEngineLoadingInfo | null;
};

export type UseSpeechRecognitionSessionParams = {
  disabled?: boolean;
  lang?: string;
  onTranscript: (raw: string) => void;
  onSpeechHypothesis?: (
    text: string,
    isFinal: boolean,
    confidence?: number,
  ) => void;
  onAccessAttemptFailed?: () => void;
  /** Resolve the engine for this browser path (Chrome vs Safari). */
  resolveEngine: () => SpeechEngine;
  /** Unsolved-tile phrase hints read on each recognition arm. */
  speechContextHintsRef?: React.MutableRefObject<SpeechContextHints | null>;
  /**
   * Canonical caption tokens (normalized/tokenized) read on each recognition
   * arm. Passed to the engine so its final/interim overlap merge stays
   * caption-aware and never collapses legitimate caption duplicates.
   */
  captionTokensRef?: React.RefObject<readonly string[] | null>;
  /** Optional warm-up before first hold (Whisper preload only). */
  preloadEngine?: (engine: SpeechEngine) => void;
  /**
   * After a fatal error, swap engines once (Safari: Deepgram → Whisper).
   * Return null to surface the error to the user.
   */
  fallbackEngineOnError?: (
    err: SpeechEngineError,
    currentKind: SpeechEngineKind | null,
  ) => SpeechEngine | null;
};

function isFatalEngineError(err: SpeechEngineError): boolean {
  switch (err.code) {
    case "no_speech":
    case "aborted":
      return false;
    default:
      return true;
  }
}

function mapToAvailabilityError(
  err: SpeechEngineError,
): VoiceAvailabilityError | null {
  switch (err.code) {
    case "unsupported":
      return "unsupported";
    case "mic_denied":
    case "audio_capture":
      return "mic_denied";
    case "not_allowed":
      return "not_allowed";
    case "network":
      return "network";
    case "model_load_failed":
      return "model_load_failed";
    default:
      return null;
  }
}

export function useSpeechRecognitionSession({
  disabled = false,
  lang = "en-US",
  onTranscript,
  onSpeechHypothesis,
  onAccessAttemptFailed,
  resolveEngine,
  speechContextHintsRef,
  captionTokensRef,
  preloadEngine,
  fallbackEngineOnError,
}: UseSpeechRecognitionSessionParams): UseSpeechRecognitionSessionReturn {
  const onTranscriptRef = useRef(onTranscript);
  const onSpeechHypothesisRef = useRef(onSpeechHypothesis);
  const onAccessAttemptFailedRef = useRef(onAccessAttemptFailed);

  useLayoutEffect(() => {
    onTranscriptRef.current = onTranscript;
    onSpeechHypothesisRef.current = onSpeechHypothesis;
    onAccessAttemptFailedRef.current = onAccessAttemptFailed;
  }, [onTranscript, onSpeechHypothesis, onAccessAttemptFailed]);

  const notifyAccessFailed = useCallback(() => {
    onAccessAttemptFailedRef.current?.();
  }, []);

  const engineRef = useRef<SpeechEngine | null>(null);
  const engineKindRef = useRef<SpeechEngineKind | null>(null);
  const listeningEnabledRef = useRef(false);
  const acceptingWhisperFinalRef = useRef(false);
  const usedFallbackRef = useRef(false);
  /** After first `ready`, hide reconnect warm-up UI (Deepgram opens a socket per hold). */
  const engineReadyOnceRef = useRef(false);
  const armRecognitionRef = useRef<() => void>(() => {});
  const [isListening, setIsListening] = useState(false);
  const [voiceAvailabilityError, setVoiceAvailabilityError] =
    useState<VoiceAvailabilityError | null>(null);
  const [engineKind, setEngineKind] = useState<SpeechEngineKind | null>(null);
  const [loadingInfo, setLoadingInfo] =
    useState<SpeechEngineLoadingInfo | null>(null);

  const ensureEngine = useCallback(
    (publishKind = true): SpeechEngine => {
      if (engineRef.current) {
        if (publishKind) setEngineKind(engineRef.current.kind);
        return engineRef.current;
      }
      const engine = resolveEngine();
      engineRef.current = engine;
      engineKindRef.current = engine.kind;
      if (publishKind) setEngineKind(engine.kind);
      return engine;
    },
    [resolveEngine],
  );

  useEffect(() => {
    if (disabled) return;
    const engine = ensureEngine(false);
    preloadEngine?.(engine);
  }, [disabled, ensureEngine, preloadEngine]);

  const stopListening = useCallback(() => {
    const engine = engineRef.current;
    engine?.flush?.();

    if (engineKindRef.current === "whisper-wasm") {
      acceptingWhisperFinalRef.current = true;
      engine?.stop();
      setIsListening(false);
      setLoadingInfo(null);
      return;
    }

    listeningEnabledRef.current = false;
    engine?.stop();
    setIsListening(false);
    setLoadingInfo(null);
  }, []);

  const armRecognition = useCallback(() => {
    if (disabled || !listeningEnabledRef.current) return;

    const engine = ensureEngine();

    const hints = speechContextHintsRef?.current ?? undefined;
    const passHintsToEngine =
      hints && engineKindRef.current !== "web-speech";
    const captionTokens = captionTokensRef?.current ?? undefined;
    const passCaptionTokens = !!captionTokens && captionTokens.length > 0;
    const startOptions: SpeechEngineStartOptions | undefined =
      passHintsToEngine || passCaptionTokens
        ? {
            ...(passHintsToEngine ? { speechContextHints: hints } : {}),
            ...(passCaptionTokens ? { captionTokens } : {}),
          }
        : undefined;

    void engine.start(
      {
        onSpeechHypothesis: (text, isFinalHyp, confidence) => {
          if (!listeningEnabledRef.current) {
            pushSpeechChainTrace(
              "session_gate_dropped",
              {
                kind: "hypothesis",
                reason: "listeningEnabled=false",
                text,
                isFinal: isFinalHyp,
                confidence,
              },
              [
                "Dropped because listeningEnabled=false",
                `Dropped hypothesis:\n${JSON.stringify(text)}`,
                `isFinal=${isFinalHyp}`,
              ],
            );
            return;
          }
          pushSpeechChainTrace(
            "session_gate_kept",
            {
              kind: "hypothesis",
              text,
              isFinal: isFinalHyp,
              confidence,
            },
            [
              "Session gate KEPT hypothesis",
              JSON.stringify(text),
              `isFinal=${isFinalHyp}`,
            ],
          );
          onSpeechHypothesisRef.current?.(text, isFinalHyp, confidence);
        },
        onTranscript: (raw) => {
          if (
            !listeningEnabledRef.current &&
            !acceptingWhisperFinalRef.current
          ) {
            pushSpeechChainTrace(
              "session_gate_dropped",
              {
                kind: "transcript",
                reason: "listeningEnabled=false",
                text: raw,
              },
              [
                "Dropped because listeningEnabled=false",
                `Dropped transcript:\n${JSON.stringify(raw)}`,
              ],
            );
            return;
          }
          pushSpeechChainTrace(
            "session_gate_kept",
            {
              kind: "transcript",
              text: raw,
            },
            ["Session gate KEPT transcript", JSON.stringify(raw)],
          );
          onTranscriptRef.current(raw);
        },
        onLoadingProgress: (info) => {
          if (info.phase === "ready") {
            engineReadyOnceRef.current = true;
            setLoadingInfo(null);
            return;
          }
          if (
            info.phase === "warming_up" &&
            engineReadyOnceRef.current
          ) {
            return;
          }
          setLoadingInfo(info);
        },
        onEnd: () => {
          if (!listeningEnabledRef.current) return;

          if (engineKindRef.current === "whisper-wasm") {
            if (acceptingWhisperFinalRef.current) {
              acceptingWhisperFinalRef.current = false;
              listeningEnabledRef.current = false;
              setIsListening(false);
              setLoadingInfo(null);
            }
            return;
          }

          if (engineKindRef.current === "web-speech") {
            queueMicrotask(() => {
              if (!listeningEnabledRef.current) return;
              armRecognitionRef.current();
            });
          }
        },
        onError: (err) => {
          if (!listeningEnabledRef.current) return;

          if (!isFatalEngineError(err)) {
            queueMicrotask(() => {
              if (listeningEnabledRef.current) armRecognitionRef.current();
            });
            return;
          }

          const fallback =
            !usedFallbackRef.current && fallbackEngineOnError
              ? fallbackEngineOnError(err, engineKindRef.current)
              : null;

          if (fallback) {
            usedFallbackRef.current = true;
            engineReadyOnceRef.current = false;
            engineRef.current?.stop();
            engineRef.current = fallback;
            engineKindRef.current = fallback.kind;
            setEngineKind(fallback.kind);
            preloadEngine?.(fallback);
            queueMicrotask(() => {
              if (listeningEnabledRef.current) armRecognitionRef.current();
            });
            return;
          }

          const availability = mapToAvailabilityError(err);
          if (availability) setVoiceAvailabilityError(availability);
          notifyAccessFailed();
          stopListening();
        },
      },
      lang,
      startOptions,
    );
  }, [
    disabled,
    ensureEngine,
    lang,
    notifyAccessFailed,
    stopListening,
    preloadEngine,
    fallbackEngineOnError,
    speechContextHintsRef,
    captionTokensRef,
  ]);

  useLayoutEffect(() => {
    armRecognitionRef.current = armRecognition;
  }, [armRecognition]);

  const startListening = useCallback(() => {
    if (disabled || isListening) return;

    listeningEnabledRef.current = true;
    setIsListening(true);
    setVoiceAvailabilityError(null);
    armRecognition();
  }, [disabled, isListening, armRecognition]);

  useEffect(() => {
    return () => {
      listeningEnabledRef.current = false;
      acceptingWhisperFinalRef.current = false;
      engineReadyOnceRef.current = false;
      engineRef.current?.stop();
      setIsListening(false);
      setLoadingInfo(null);
    };
  }, []);

  return {
    isListening: disabled ? false : isListening,
    startListening,
    stopListening,
    listeningEnabledRef,
    voiceAvailabilityError: disabled ? null : voiceAvailabilityError,
    engineKind: disabled ? null : engineKind,
    loadingInfo: disabled ? null : loadingInfo,
  };
}
