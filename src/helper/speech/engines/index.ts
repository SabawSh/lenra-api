import type { SpeechEngine, SpeechEngineKind } from "./types";
import { DeepgramEngine } from "./deepgramEngine";
import { isWebSpeechSupported, WebSpeechEngine } from "./webSpeechEngine";
import { WhisperWasmEngine } from "./whisperWasmEngine";

/**
 * Engine selection lives in one place: browser hooks pick Chrome vs Safari
 * paths; this factory supports tests and explicit overrides.
 */

export type SpeechEnginePreference = "auto" | SpeechEngineKind;

export type SpeechEngineSelection = {
  engine: SpeechEngine;
  /** Why this engine was picked — useful for debug/analytics. */
  reason:
    | "web-speech-supported"
    | "web-speech-forced"
    | "deepgram-safari"
    | "deepgram-forced"
    | "whisper-wasm-fallback"
    | "whisper-wasm-forced";
};

let whisperSingleton: WhisperWasmEngine | null = null;
let webSpeechSingleton: WebSpeechEngine | null = null;
let deepgramSingleton: DeepgramEngine | null = null;

export function getWhisperEngine(): WhisperWasmEngine {
  if (!whisperSingleton) {
    whisperSingleton = new WhisperWasmEngine();
  }
  return whisperSingleton;
}

export function getWebSpeechEngine(): WebSpeechEngine {
  if (!webSpeechSingleton) {
    webSpeechSingleton = new WebSpeechEngine();
  }
  return webSpeechSingleton;
}

export function getDeepgramEngine(): DeepgramEngine {
  if (!deepgramSingleton) {
    deepgramSingleton = new DeepgramEngine();
  }
  return deepgramSingleton;
}

/**
 * Client-safe: true when the Safari Deepgram path should run.
 * Chrome on iOS (CriOS) keeps Web Speech when supported.
 */
export function detectIsSafariClient(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isChromeOnIOS = isIOS && /CriOS/.test(ua);
  if (isChromeOnIOS && isWebSpeechSupported()) return false;
  const isSafariDesktop =
    /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
  return isIOS || isSafariDesktop;
}

/**
 * Default routing:
 *   - Web Speech (Chrome / Edge / Firefox desktop) → WebSpeechEngine
 *   - Safari / iOS → DeepgramEngine (hooks may fall back to Whisper)
 *   - no Web Speech on non-Safari → WhisperWasmEngine
 */
export function selectSpeechEngine(
  preference: SpeechEnginePreference = "auto",
): SpeechEngineSelection {
  if (preference === "web-speech") {
    return { engine: getWebSpeechEngine(), reason: "web-speech-forced" };
  }
  if (preference === "whisper-wasm") {
    return { engine: getWhisperEngine(), reason: "whisper-wasm-forced" };
  }
  if (preference === "deepgram") {
    return { engine: getDeepgramEngine(), reason: "deepgram-forced" };
  }

  if (isWebSpeechSupported() && !detectIsSafariClient()) {
    return { engine: getWebSpeechEngine(), reason: "web-speech-supported" };
  }
  if (detectIsSafariClient()) {
    return { engine: getDeepgramEngine(), reason: "deepgram-safari" };
  }
  return { engine: getWhisperEngine(), reason: "whisper-wasm-fallback" };
}

export type {
  SpeechEngine,
  SpeechEngineCallbacks,
  SpeechEngineCapabilities,
  SpeechEngineError,
  SpeechEngineErrorCode,
  SpeechEngineKind,
  SpeechEngineLifecycle,
  SpeechEngineLoadingInfo,
  SpeechEngineLoadingPhase,
} from "./types";
export { DeepgramEngine } from "./deepgramEngine";
export { isWebSpeechSupported, WebSpeechEngine } from "./webSpeechEngine";
export { WhisperWasmEngine } from "./whisperWasmEngine";
