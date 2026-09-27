import {
  createClient,
  LiveTranscriptionEvents,
  SOCKET_STATES,
} from "@deepgram/sdk";
import type { ListenLiveClient, LiveTranscriptionEvent } from "@deepgram/sdk";
import { logSpeechContextHintsDebug } from "@/helper/speech/speechContextHints";
import type {
  SpeechEngine,
  SpeechEngineCallbacks,
  SpeechEngineCapabilities,
  SpeechEngineError,
  SpeechEngineStartOptions,
} from "./types";

/** MediaRecorder slice — balance latency vs chunk overhead. */
const MEDIA_SLICE_MS = 200;

/** Debounce stable finals before puzzle "final" commits. */
const FINAL_STABILIZE_MS = 220;

/** Ignore very low-confidence finals for chunk commits (UI still gets interim). */
const MIN_FINAL_CONFIDENCE = 0.55;

const COALESCE_FINAL_MS = 16;

const KEEPALIVE_MS = 8_000;

type CoalesceHandle = {
  pushMergedFinal: (merged: string) => void;
  flush: () => void;
  dispose: () => void;
};

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

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

function mapLang(lang: string): string {
  const base = lang.split("-")[0]?.toLowerCase() ?? "en";
  return base === "en" ? "en" : base;
}

const DEEPGRAM_CAPABILITIES: SpeechEngineCapabilities = {
  realtimeInterim: true,
  perWordConfidence: true,
  pronunciationAssessment: false,
};

export class DeepgramEngine implements SpeechEngine {
  readonly kind = "deepgram" as const;
  readonly capabilities = DEEPGRAM_CAPABILITIES;

  private callbacks: SpeechEngineCallbacks | null = null;
  private live: ListenLiveClient | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private coalesce: CoalesceHandle | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private stabilizeTimer: ReturnType<typeof setTimeout> | null = null;
  private stabilizePendingText = "";
  private stabilizePendingConfidence: number | undefined;
  private visibilityHandler: (() => void) | null = null;
  private stopped = true;
  private startGeneration = 0;

  async start(
    callbacks: SpeechEngineCallbacks,
    lang: string,
    options?: SpeechEngineStartOptions,
  ): Promise<void> {
    this.callbacks = callbacks;
    this.stopped = false;
    const generation = ++this.startGeneration;

    this.coalesce?.dispose();
    this.coalesce = createFinalCoalescer((text) => {
      this.callbacks?.onTranscript(text);
    });

    callbacks.onLoadingProgress?.({ phase: "warming_up" });

    let accessToken: string;
    try {
      const res = await fetch("/api/speech/deepgram/token", { method: "POST" });
      if (!res.ok) {
        callbacks.onError?.({ code: "network", detail: `token ${res.status}` });
        return;
      }
      const body = (await res.json()) as { access_token?: string };
      if (!body.access_token) {
        callbacks.onError?.({ code: "network", detail: "missing access_token" });
        return;
      }
      accessToken = body.access_token;
    } catch (err) {
      callbacks.onError?.({
        code: "network",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (this.stopped || generation !== this.startGeneration) return;

    if (!lang.toLowerCase().startsWith("en")) {
      callbacks.onError?.({
        code: "unsupported",
        detail: "Only English supported",
      });
      return;
    }

    const deepgram = createClient({ accessToken });
    const keyterms = options?.speechContextHints?.expectedPhrases;
    if (keyterms?.length) {
      logSpeechContextHintsDebug(
        { expectedPhrases: [...keyterms] },
        keyterms,
      );
    }

    const live = deepgram.listen.live({
      model: "nova-3",
      language: mapLang(lang),
      interim_results: true,
      punctuate: true,
      smart_format: true,
      endpointing: 300,
      utterance_end_ms: 1000,
      vad_events: true,
      ...(keyterms?.length ? { keyterm: keyterms } : {}),
    });
    this.live = live;

    const onOpen = () => {
      if (this.stopped || generation !== this.startGeneration) return;
      void this.startMicrophone(live, generation);
    };

    const onTranscript = (data: LiveTranscriptionEvent) => {
      if (this.stopped) return;
      this.handleTranscript(data);
    };

    const onError = (err: unknown) => {
      if (this.stopped) return;
      const detail =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      this.emitError({ code: "network", detail });
    };

    const onClose = () => {
      if (this.stopped) return;
      this.callbacks?.onEnd?.();
    };

    live.on(LiveTranscriptionEvents.Open, onOpen);
    live.on(LiveTranscriptionEvents.Transcript, onTranscript);
    live.on(LiveTranscriptionEvents.Error, onError);
    live.on(LiveTranscriptionEvents.Close, onClose);

    this.attachVisibilityGuard();
  }

  private attachVisibilityGuard(): void {
    if (typeof document === "undefined") return;
    this.detachVisibilityGuard();
    this.visibilityHandler = () => {
      if (document.hidden && !this.stopped) this.stop();
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private detachVisibilityGuard(): void {
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.visibilityHandler = null;
  }

  private async startMicrophone(
    live: ListenLiveClient,
    generation: number,
  ): Promise<void> {
    if (this.stopped || generation !== this.startGeneration) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.stopped || generation !== this.startGeneration) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      this.mediaStream = stream;
      const mimeType = pickRecorderMime();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (ev: BlobEvent) => {
        if (this.stopped || !ev.data.size) return;
        if (live.getReadyState() !== SOCKET_STATES.open) return;
        live.send(ev.data);
      };

      recorder.onerror = () => {
        this.emitError({ code: "audio_capture" });
      };

      this.mediaRecorder = recorder;
      recorder.start(MEDIA_SLICE_MS);

      this.keepAliveTimer = setInterval(() => {
        if (this.stopped) return;
        if (live.getReadyState() === SOCKET_STATES.open) {
          live.keepAlive();
        }
      }, KEEPALIVE_MS);

      this.callbacks?.onLoadingProgress?.({ phase: "ready" });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        this.emitError({ code: "mic_denied" });
      } else if (name === "NotFoundError") {
        this.emitError({ code: "audio_capture" });
      } else {
        this.emitError({
          code: "unknown",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private handleTranscript(data: LiveTranscriptionEvent): void {
    const alt = data.channel?.alternatives?.[0];
    const text = (alt?.transcript ?? "").trim();
    if (!text) return;

    const confidence =
      typeof alt?.confidence === "number" ? alt.confidence : undefined;

    this.callbacks?.onSpeechHypothesis?.(text, false, confidence);

    if (!data.is_final) return;

    if (
      confidence != null &&
      confidence < MIN_FINAL_CONFIDENCE
    ) {
      return;
    }

    this.scheduleStableFinal(text, confidence);
  }

  private scheduleStableFinal(text: string, confidence?: number): void {
    this.stabilizePendingText = text;
    this.stabilizePendingConfidence = confidence;

    if (this.stabilizeTimer != null) clearTimeout(this.stabilizeTimer);

    this.stabilizeTimer = setTimeout(() => {
      this.stabilizeTimer = null;
      if (this.stopped) return;

      const out = this.stabilizePendingText.trim();
      const conf = this.stabilizePendingConfidence;
      this.stabilizePendingText = "";
      this.stabilizePendingConfidence = undefined;

      if (!out) return;

      this.callbacks?.onSpeechHypothesis?.(out, true, conf);
      this.coalesce?.pushMergedFinal(out);
    }, FINAL_STABILIZE_MS);
  }

  private emitError(err: SpeechEngineError): void {
    this.callbacks?.onError?.(err);
  }

  private releaseCapture(): void {
    if (this.keepAliveTimer != null) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }

    if (this.stabilizeTimer != null) {
      clearTimeout(this.stabilizeTimer);
      this.stabilizeTimer = null;
    }
    this.stabilizePendingText = "";
    this.stabilizePendingConfidence = undefined;

    try {
      if (this.mediaRecorder?.state !== "inactive") {
        this.mediaRecorder?.stop();
      }
    } catch {
      /* ignore */
    }
    this.mediaRecorder = null;

    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;
  }

  private closeSocket(): void {
    const live = this.live;
    if (!live) return;

    try {
      if (live.getReadyState() === SOCKET_STATES.open) {
        live.finalize();
        live.requestClose();
      }
    } catch {
      /* ignore */
    }

    try {
      live.disconnect();
    } catch {
      /* ignore */
    }

    this.live = null;
  }

  stop(): void {
    this.stopped = true;
    this.startGeneration += 1;

    this.coalesce?.flush();
    this.releaseCapture();
    this.closeSocket();
    this.coalesce?.dispose();
    this.coalesce = null;
    this.detachVisibilityGuard();
  }

  flush(): void {
    if (this.stabilizeTimer != null) {
      clearTimeout(this.stabilizeTimer);
      this.stabilizeTimer = null;
      const out = this.stabilizePendingText.trim();
      const conf = this.stabilizePendingConfidence;
      this.stabilizePendingText = "";
      this.stabilizePendingConfidence = undefined;
      if (out && !this.stopped) {
        this.callbacks?.onSpeechHypothesis?.(out, true, conf);
        this.coalesce?.pushMergedFinal(out);
      }
    }
    this.coalesce?.flush();
    const live = this.live;
    if (live?.getReadyState() === SOCKET_STATES.open) {
      try {
        live.finalize();
      } catch {
        /* ignore */
      }
    }
  }

  dispose(): void {
    this.stop();
    this.callbacks = null;
  }
}
