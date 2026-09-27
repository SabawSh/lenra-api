import { buildWebSpeechHypothesisFromResults } from "@/helper/speech/mergeTranscriptWithOverlap";
import {
  beginSpeechChainEvent,
  endSpeechChainEvent,
  pushSpeechChainTrace,
} from "@/helper/speech/speechChainTrace";
import { resolveSttFallbackConfig } from "@/helper/speech/sttConfig";
import type {
  SpeechEngine,
  SpeechEngineCallbacks,
  SpeechEngineCapabilities,
  SpeechEngineError,
  SpeechEngineErrorCode,
  SpeechEngineStartOptions,
} from "./types";

/**
 * Web Speech adapter — preserves every behavior of the previous
 * `realtimeRecognizer.ts` (final coalescer, prior-instance dispose,
 * per-result final/interim split). Only the shape changes so the hook can
 * swap engines without learning who is running.
 */

type CoalesceHandle = {
  pushMergedFinal: (merged: string) => void;
  flush: () => void;
  dispose: () => void;
};

/**
 * Tiny trailing window only to merge bursts in the same event-loop turn.
 * Larger values feel like noticeable lag between speaking and tile updates.
 */
const COALESCE_FINAL_MS = 16; // one frame — imperceptible, prevents flush race

function sttAcquisitionDebugEnabled(): boolean {
  return (
    resolveSttFallbackConfig().debug ||
    process.env.NEXT_PUBLIC_STT_FALLBACK_DEBUG === "1" ||
    process.env.VOICE_MATCH_DEBUG === "1"
  );
}

/** Dump Chrome's SpeechRecognitionResultList exactly as delivered (index 0..n-1). */
function logRawBrowserSpeechResults(
  event: SpeechRecognitionEvent,
  builtHypothesis: string,
): void {
  if (!sttAcquisitionDebugEnabled()) return;

  const results = event.results;
  const len = results?.length ?? 0;
  const resultIndex =
    typeof event.resultIndex === "number" ? event.resultIndex : 0;

  const lines: string[] = [
    "====================================================",
    `[TRANSCRIPT] Raw SpeechRecognitionResultList`,
    `event.resultIndex = ${resultIndex}`,
    `results.length = ${len}`,
  ];

  const indexOrderParts: string[] = [];
  for (let i = 0; i < len; i++) {
    const res = results[i] as SpeechRecognitionResult;
    const transcript = String(res?.[0]?.transcript ?? "");
    const confidence =
      typeof res?.[0]?.confidence === "number" ? res[0].confidence : undefined;
    indexOrderParts.push(transcript.trim());
    lines.push("");
    lines.push(`results[${i}].isFinal = ${!!res?.isFinal}`);
    lines.push(`results[${i}][0].transcript = ${JSON.stringify(transcript)}`);
    lines.push(
      `results[${i}][0].confidence = ${confidence === undefined ? "n/a" : confidence}`,
    );
  }

  const indexOrderJoin = indexOrderParts.filter(Boolean).join(" ");
  lines.push("====================================================");
  lines.push(
    `[TRANSCRIPT] Raw index-order join (results[i][0] for i=0..n-1)`,
  );
  lines.push(indexOrderJoin);
  lines.push("");
  lines.push(`[TRANSCRIPT] buildWebSpeechHypothesisFromResults`);
  lines.push(builtHypothesis);
  lines.push("====================================================");

  // eslint-disable-next-line no-console -- intentional STT acquisition probe
  console.log(lines.join("\n"));
}
function createFinalCoalescer(
  deliver: (text: string) => void,
  delayMs = COALESCE_FINAL_MS,
): CoalesceHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest = "";

  const flush = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    const out = latest.trim();
    latest = "";
    if (out) deliver(out);
  };

  const dispose = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    latest = "";
  };

  const pushMergedFinal = (merged: string) => {
    const t = merged.trim();
    if (!t) return;
    latest = t;
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const out = latest.trim();
      latest = "";
      if (out) deliver(out);
    }, delayMs);
  };

  return { pushMergedFinal, flush, dispose };
}

/** Browsers only support one live recognition; stop the previous instance. */
let activeEngine: WebSpeechEngine | null = null;

function getNativeRecognitionCtor():
  | (new () => SpeechRecognition)
  | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function isWebSpeechSupported(): boolean {
  return getNativeRecognitionCtor() !== null;
}

function mapNativeErrorCode(raw: SpeechRecognitionErrorEvent | Event | string | null): SpeechEngineErrorCode {
  const code =
    typeof raw === "string"
      ? raw
      : raw && typeof (raw as SpeechRecognitionErrorEvent).error === "string"
        ? (raw as SpeechRecognitionErrorEvent).error
        : null;
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "not_allowed";
    case "audio-capture":
      return "audio_capture";
    case "network":
      return "network";
    case "no-speech":
      return "no_speech";
    case "aborted":
      return "aborted";
    case "SpeechRecognition not supported":
      return "unsupported";
    default:
      return "unknown";
  }
}

const WEB_SPEECH_CAPABILITIES: SpeechEngineCapabilities = {
  realtimeInterim: true,
  perWordConfidence: false,
  pronunciationAssessment: false,
};

export class WebSpeechEngine implements SpeechEngine {
  readonly kind = "web-speech" as const;
  readonly capabilities = WEB_SPEECH_CAPABILITIES;

  private recognition: SpeechRecognition | null = null;
  private coalesce: CoalesceHandle | null = null;
  private callbacks: SpeechEngineCallbacks | null = null;
  private lang = "en-US";

  start(
    callbacks: SpeechEngineCallbacks,
    lang: string,
    _options?: SpeechEngineStartOptions,
  ): void {
    const Ctor = getNativeRecognitionCtor();
    if (!Ctor) {
      callbacks.onError?.({ code: "unsupported" });
      return;
    }

    if (activeEngine && activeEngine !== this) {
      activeEngine.stop();
    }
    activeEngine = this;

    this.callbacks = callbacks;
    this.lang = lang;

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    // Web Speech API grammars / speechContextHints are intentionally NOT set —
    // Chrome's webkitSpeechRecognition ignores SpeechGrammarList in practice,
    // and useSpeechRecognitionSession withholds hints for engine kind web-speech.
    // Caption tokens must never reshape the live hypothesis — speech order only.

    const coalesce = createFinalCoalescer((text) => {
      if (sttAcquisitionDebugEnabled()) {
      }
      const eventId = beginSpeechChainEvent("transcript");
      pushSpeechChainTrace(
        "merged_hypothesis",
        {
          mergedHypothesis: text,
          finalsOnly: text,
          lastFinal: true,
          coalescedFinal: true,
        },
        [
          `\ncoalesced final → onTranscript:\n${JSON.stringify(text)}`,
        ],
        eventId,
      );
      this.callbacks?.onTranscript(text);
      endSpeechChainEvent();
    });
    this.coalesce = coalesce;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const len = event.results?.length ?? 0;
      if (!len) return;

      const eventId = beginSpeechChainEvent("hypothesis");

      // Full list from index 0 — not only event.resultIndex..end.
      for (let i = 0; i < len; i++) {
        const res = event.results[i] as SpeechRecognitionResult;
        const alternatives: string[] = [];
        for (let a = 0; a < (res.length ?? 0); a++) {
          const alt = res[a]?.transcript;
          if (alt != null) alternatives.push(String(alt));
        }
        const conf =
          typeof res[0]?.confidence === "number" ? res[0].confidence : undefined;
        const lines = [
          `\n[result #${i}]`,
          ...alternatives.map(
            (alt, a) => `alternative[${a}] = ${JSON.stringify(alt)}`,
          ),
          `confidence=${conf ?? "n/a"}`,
          `isFinal=${!!res.isFinal}`,
        ];
        pushSpeechChainTrace(
          "chrome_raw",
          {
            resultIndex: i,
            isFinal: !!res.isFinal,
            confidence: conf,
            alternatives,
            alternative0: alternatives[0] ?? "",
          },
          lines,
          eventId,
        );
      }

      const { hypothesis: hypothesisLine, finalsOnly, lastFinal } =
        buildWebSpeechHypothesisFromResults(event.results);

      logRawBrowserSpeechResults(event, hypothesisLine);

      pushSpeechChainTrace(
        "merged_hypothesis",
        {
          mergedHypothesis: hypothesisLine,
          finalsOnly,
          lastFinal,
        },
        [
          `\nmergedHypothesis:\n${JSON.stringify(hypothesisLine)}`,
          `finalsOnly=${JSON.stringify(finalsOnly)}`,
          `lastFinal=${lastFinal}`,
        ],
        eventId,
      );

      let interimConfidence: number | undefined;
      for (let i = len - 1; i >= 0; i--) {
        const res = event.results[i] as SpeechRecognitionResult;
        if (!res.isFinal) {
          interimConfidence =
            typeof res[0]?.confidence === "number"
              ? res[0].confidence
              : undefined;
          break;
        }
      }

      if (hypothesisLine) {
        this.callbacks?.onSpeechHypothesis?.(
          hypothesisLine,
          lastFinal,
          interimConfidence,
        );
      }

      endSpeechChainEvent();

      if (!lastFinal) return;

      if (finalsOnly) coalesce.pushMergedFinal(finalsOnly);
    };

    recognition.onerror = (ev: SpeechRecognitionErrorEvent) => {
      const error: SpeechEngineError = {
        code: mapNativeErrorCode(ev),
        detail: ev.error,
      };
      this.callbacks?.onError?.(error);
    };

    recognition.onend = () => {
      this.callbacks?.onEnd?.();
    };

    this.recognition = recognition;

    try {
      recognition.start();
    } catch (err) {
      coalesce.dispose();
      this.coalesce = null;
      this.recognition = null;
      this.callbacks?.onError?.({
        code: "unknown",
        detail: err instanceof Error ? err.message : String(err),
      });
      if (activeEngine === this) activeEngine = null;
    }
  }

  stop(): void {
    this.coalesce?.flush();
    const reco = this.recognition;
    if (reco) {
      reco.onend = () => undefined;
      reco.onerror = () => undefined;
      try {
        reco.stop();
      } catch {
        /* ignore */
      }
    }
    this.recognition = null;
    this.coalesce?.dispose();
    this.coalesce = null;
    if (activeEngine === this) activeEngine = null;
  }

  flush(): void {
    this.coalesce?.flush();
  }

  dispose(): void {
    this.stop();
    this.callbacks = null;
  }
}
