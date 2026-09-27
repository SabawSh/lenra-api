import type {
  SpeechEngine,
  SpeechEngineCallbacks,
  SpeechEngineCapabilities,
  SpeechEngineStartOptions,
} from "./types";

/**
 * IMPORTANT:
 * Force browser-only ONNX runtime.
 * Prevent transformers.js from loading `onnxruntime-node`
 * during SSR/build on Liara/Vercel.
 */
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).process = undefined;
}

/**
 * IMPORTANT:
 * Prevent webpack/server bundle from resolving node runtime.
 */
export const runtime = "edge";

const WHISPER_LOCAL_MODEL_ID = "whisper-tiny" as const;
const WHISPER_LOCAL_MODEL_BASE = "/models/whisper-tiny";

const REQUIRED_MODEL_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "preprocessor_config.json",
  "generation_config.json",
] as const;

const REQUIRED_WHISPER_ONNX_FILES = [
  "onnx/encoder_model.onnx",
  "onnx/decoder_model_merged.onnx",
] as const;

const WHISPER_TARGET_SAMPLE_RATE = 16_000;
const INTERIM_INTERVAL_MS = 600;
const MAX_UTTERANCE_SECONDS = 30;
const DISABLE_INTERIM_ON_SAFARI = true;

/**
 * CRITICAL:
 * Use browser-only transformers build.
 *
 * NEVER import from "@huggingface/transformers"
 * because it pulls node dependencies.
 */
type TransformersModule = typeof import("@huggingface/transformers");

type Transcriber = Awaited<ReturnType<TransformersModule["pipeline"]>>;

type TranscriberOutput = { text: string } | { text: string }[] | string;

type AudioTranscriber = (audio: Float32Array) => Promise<TranscriberOutput>;

type ExecutionProvider = "webgpu" | "wasm";

type TransformersEnv = {
  allowLocalModels?: boolean;
  allowRemoteModels?: boolean;
  localModelPath?: string;
  backends?: {
    onnx?: {
      wasm?: Record<string, any>;
      webgpu?: Record<string, any>;
    };
  };
};

type TransformersProgressInfo = {
  status?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

let cachedTransformers: TransformersModule | null = null;

function isSafariOrIOS(): boolean {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent;

  const isIOS = /iPhone|iPad|iPod/.test(ua);

  const isSafariDesktop =
    /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);

  return isIOS || isSafariDesktop;
}

async function loadTransformers(): Promise<TransformersModule> {
  if (typeof window === "undefined") {
    throw new Error("WhisperWasmEngine is browser-only");
  }

  if (cachedTransformers) {
    return cachedTransformers;
  }

  /**
   * IMPORTANT:
   * browser-only build
   */
  cachedTransformers = await import("@huggingface/transformers");

  return cachedTransformers;
}

async function checkFileExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
    });

    return res.ok;
  } catch {
    return false;
  }
}

async function validateWhisperOnnxFiles(): Promise<void> {
  for (const file of REQUIRED_WHISPER_ONNX_FILES) {
    const url = `${WHISPER_LOCAL_MODEL_BASE}/${file}`;

    const exists = await checkFileExists(url);

    if (!exists) {
      console.error(`[WhisperWasmEngine] missing local model file: ${url}`);

      throw new Error(`Missing required local model file: ${url}`);
    }

    console.info(`[WhisperWasmEngine] onnx found: ${url}`);
  }
}

async function validateLocalModelFiles(): Promise<void> {
  for (const file of REQUIRED_MODEL_FILES) {
    const url = `${WHISPER_LOCAL_MODEL_BASE}/${file}`;

    const exists = await checkFileExists(url);

    if (!exists) {
      console.error(`[WhisperWasmEngine] missing local model file: ${url}`);

      throw new Error(`Missing required local model file: ${url}`);
    }
  }

  await validateWhisperOnnxFiles();
}

type LoadProgress = (info: {
  phase: "downloading_model" | "warming_up" | "ready";
  progress?: number;
  loaded?: number;
  total?: number;
}) => void;

function resampleTo16k(input: Float32Array, srcRate: number): Float32Array {
  if (srcRate === WHISPER_TARGET_SAMPLE_RATE) {
    return input;
  }

  const ratio = srcRate / WHISPER_TARGET_SAMPLE_RATE;

  const outLen = Math.floor(input.length / ratio);

  const out = new Float32Array(outLen);

  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;

    const i0 = Math.floor(srcIdx);

    const i1 = Math.min(i0 + 1, input.length - 1);

    const t = srcIdx - i0;

    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }

  return out;
}

function invokeTranscriber(
  transcriber: Transcriber,
  audio: Float32Array,
): Promise<TranscriberOutput> {
  return (transcriber as unknown as AudioTranscriber)(audio);
}

const WHISPER_CAPABILITIES: SpeechEngineCapabilities = {
  realtimeInterim: false,
  perWordConfidence: false,
  pronunciationAssessment: false,
};

export class WhisperWasmEngine implements SpeechEngine {
  readonly kind = "whisper-wasm" as const;

  readonly capabilities = WHISPER_CAPABILITIES;

  private callbacks: SpeechEngineCallbacks | null = null;

  private transcriber: Transcriber | null = null;

  private selectedDevice: ExecutionProvider | null = null;

  private initialized = false;

  private initializingPromise: Promise<void> | undefined;

  private mediaStream: MediaStream | null = null;

  private audioContext: AudioContext | null = null;

  private sourceNode: MediaStreamAudioSourceNode | null = null;

  private processorNode: ScriptProcessorNode | null = null;

  private chunks: Float32Array[] = [];

  private chunkSamples = 0;

  private interimTimer: ReturnType<typeof setInterval> | null = null;

  private inflightTranscribe: Promise<TranscriberOutput> | null = null;

  private stopped = false;

  private finalDelivered = false;

  private lastInterim = "";

  private enableInterimPasses = true;

  async preload(): Promise<void> {
    await this.ensureInitialized();
  }

  private configureRuntimeForBrowser(transformers: TransformersModule): void {
    const env = (
      transformers as TransformersModule & {
        env?: TransformersEnv;
      }
    ).env;

    if (!env) return;

    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = "/models/";

    if (!env.backends?.onnx) return;

    env.backends.onnx.wasm = {
      ...(env.backends.onnx.wasm ?? {}),
      proxy: false,
    };

    if (env.backends.onnx.webgpu) {
      env.backends.onnx.webgpu.enabled = false;
    } else {
      // Library `WebGpuFlags` is stricter than the partial object we need at init time.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (env.backends.onnx as any).webgpu = { enabled: false };
    }

    console.info("[WhisperWasmEngine] using browser wasm runtime");
  }

  private async ensureInitialized(onProgress?: LoadProgress): Promise<void> {
    if (this.initialized && this.transcriber) {
      onProgress?.({ phase: "ready" });

      return;
    }

    if (this.initializingPromise) {
      await this.initializingPromise;

      onProgress?.({ phase: "ready" });

      return;
    }

    this.initializingPromise = (async () => {
      const transformers = await loadTransformers();

      this.configureRuntimeForBrowser(transformers);

      await validateLocalModelFiles();

      try {
        const transcriber = await transformers.pipeline(
          "automatic-speech-recognition",
          WHISPER_LOCAL_MODEL_ID,
          {
            device: "wasm",
            dtype: "fp32",
            local_files_only: true,

            progress_callback: (info: TransformersProgressInfo) => {
              if (info?.status === "progress") {
                onProgress?.({
                  phase: "downloading_model",
                  progress:
                    typeof info.progress === "number"
                      ? info.progress / 100
                      : undefined,
                  loaded: info.loaded,
                  total: info.total,
                });
              }
            },
          },
        );

        this.transcriber = transcriber;

        this.selectedDevice = "wasm";

        this.initialized = true;

        onProgress?.({
          phase: "ready",
        });
      } catch (err) {
        console.error("[WhisperWasmEngine] initialization failed", err);

        throw err;
      }
    })();

    try {
      await this.initializingPromise;
    } finally {
      this.initializingPromise = undefined;
    }
  }

  async start(
    callbacks: SpeechEngineCallbacks,
    lang: string,
    _options?: SpeechEngineStartOptions,
  ): Promise<void> {
    this.callbacks = callbacks;

    this.stopped = false;

    this.finalDelivered = false;

    this.chunks = [];

    this.chunkSamples = 0;

    this.lastInterim = "";

    this.enableInterimPasses = !(DISABLE_INTERIM_ON_SAFARI && isSafariOrIOS());

    if (lang && !lang.toLowerCase().startsWith("en")) {
      callbacks.onError?.({
        code: "unsupported",
        detail: "Only English supported",
      });

      return;
    }

    try {
      await this.ensureInitialized((info) =>
        callbacks.onLoadingProgress?.(info),
      );
    } catch (err) {
      callbacks.onError?.({
        code: "model_load_failed",
        detail: err instanceof Error ? err.message : String(err),
      });

      return;
    }

    if (this.stopped) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    this.mediaStream = stream;

    const AudioCtx =
      window.AudioContext ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext;

    this.audioContext = new AudioCtx();

    if (this.audioContext.state === "suspended") {
      try {
        await this.audioContext.resume();
      } catch {
        // best-effort — mic graph may still run on some Safari versions
      }
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (ev) => {
      if (this.stopped) return;

      const channel = ev.inputBuffer.getChannelData(0);

      const slice = new Float32Array(channel.length);

      slice.set(channel);

      this.chunks.push(slice);

      this.chunkSamples += slice.length;

      const seconds = this.chunkSamples / (this.audioContext?.sampleRate ?? 1);

      if (seconds > MAX_UTTERANCE_SECONDS) {
        this.stop();
      }
    };

    this.processorNode = processor;

    this.sourceNode.connect(processor);

    processor.connect(this.audioContext.destination);

    if (this.stopped) {
      this.releaseCapture();
      return;
    }

    callbacks.onLoadingProgress?.({
      phase: "ready",
    });

    if (this.enableInterimPasses) {
      this.interimTimer = setInterval(() => {
        void this.runInterimPass();
      }, INTERIM_INTERVAL_MS);
    }
  }

  private buildBuffer(): Float32Array | null {
    if (this.chunkSamples === 0) {
      return null;
    }

    const merged = new Float32Array(this.chunkSamples);

    let offset = 0;

    for (const c of this.chunks) {
      merged.set(c, offset);

      offset += c.length;
    }

    const srcRate = this.audioContext?.sampleRate ?? WHISPER_TARGET_SAMPLE_RATE;

    return resampleTo16k(merged, srcRate);
  }

  private async runInterimPass(): Promise<void> {
    if (this.stopped) return;

    if (this.inflightTranscribe) {
      void this.inflightTranscribe.finally(() => {
        if (!this.stopped) void this.runInterimPass();
      });
      return;
    }

    if (!this.transcriber) return;

    const audio = this.buildBuffer();

    if (!audio || audio.length < WHISPER_TARGET_SAMPLE_RATE * 0.4) {
      return;
    }

    const job = invokeTranscriber(this.transcriber, audio);

    this.inflightTranscribe = job;

    try {
      const result = await job;

      if (this.stopped) return;

      const text = extractText(result);
      const confidence = extractConfidence(result);

      if (text && text !== this.lastInterim) {
        this.lastInterim = text;

        this.callbacks?.onSpeechHypothesis?.(text, false, confidence);
      }
    } finally {
      this.inflightTranscribe = null;
    }
  }

  flush(): void {
    void this.runFinalPass(true);
  }

  /**
   * `fromFlush` — `stopListening` calls `flush()` then `stop()` synchronously.
   * Without this flag the final pass would see `stopped` and skip, so Safari
   * never delivered `onTranscript` and puzzle chunks never aligned.
   */
  private async runFinalPass(fromFlush = false): Promise<void> {
    if (this.finalDelivered) {
      if (fromFlush) this.callbacks?.onEnd?.();
      return;
    }
    if (!fromFlush && this.stopped) return;

    const audio = this.buildBuffer();
    if (!audio || !this.transcriber) {
      if (fromFlush) this.callbacks?.onEnd?.();
      return;
    }

    try {
      const result = await invokeTranscriber(this.transcriber, audio);
      if (this.finalDelivered) return;
      if (!fromFlush && this.stopped) return;

      const text = extractText(result);
      if (text) {
        this.finalDelivered = true;
        this.callbacks?.onTranscript(text);
      }
    } catch {
      // best-effort, ignore
    } finally {
      if (fromFlush) this.callbacks?.onEnd?.();
    }
  }

  stop(): void {
    this.stopped = true;
    this.releaseCapture();
  }

  /** Tear down mic graph; safe to call more than once (e.g. aborted `start()`). */
  private releaseCapture(): void {
    if (this.interimTimer) {
      clearInterval(this.interimTimer);

      this.interimTimer = null;
    }

    try {
      this.processorNode?.disconnect();
    } catch {}

    try {
      this.sourceNode?.disconnect();
    } catch {}

    this.mediaStream?.getTracks().forEach((t) => t.stop());

    void this.audioContext?.close().catch(() => undefined);

    this.processorNode = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.audioContext = null;
  }

  dispose(): void {
    this.stop();

    this.callbacks = null;
  }
}

function extractConfidence(
  result: TranscriberOutput | null | undefined,
): number | undefined {
  if (!result) return undefined;

  if (typeof result === "string") return undefined;

  if (Array.isArray(result)) {
    const scores = result
      .map((r) => extractConfidence(r))
      .filter((s): s is number => s !== undefined);
    if (scores.length === 0) return undefined;
    return scores.reduce((sum, s) => sum + s, 0) / scores.length;
  }

  if (typeof result === "object") {
    const score = (result as { score?: number }).score;
    if (typeof score === "number") return score;

    const chunks = (result as { chunks?: unknown[] }).chunks;
    if (Array.isArray(chunks) && chunks.length > 0) {
      const scores = chunks
        .map((c) => extractConfidence(c as TranscriberOutput))
        .filter((s): s is number => s !== undefined);
      if (scores.length === 0) return undefined;
      return scores.reduce((sum, s) => sum + s, 0) / scores.length;
    }
  }

  return undefined;
}

function extractText(result: TranscriberOutput | null | undefined): string {
  if (!result) return "";

  if (typeof result === "string") {
    return result.trim();
  }

  if (Array.isArray(result)) {
    return result
      .map((r) => extractText(r))
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  if (typeof result === "object" && "text" in result) {
    const t = (result as { text?: string }).text;

    return typeof t === "string" ? t.trim() : "";
  }

  return "";
}
